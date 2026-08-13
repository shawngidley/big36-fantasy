import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  divisions,
  draftAssignments,
  draftPicks,
  leagueOwners,
  positions,
  scoringEvents,
  scoringRules,
  scoringWeeks,
  users,
  type Position,
} from "../drizzle/schema";
import { getDb } from "./db";
import { rankBySeasonPoints } from "./league-scoring";

const positionLabel: Record<Position, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF_ST: "DEF/ST",
  FLEX: "FLEX",
};

const keyFor = (schoolName: string, position: Position) => `${schoolName.toLowerCase()}::${position}`;

export async function getLeagueSnapshot() {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");

  const [divisionRows, ownerRows, assignmentRows, pickRows, weekRows, ruleRows, eventRows, userRows] = await Promise.all([
    db.select().from(divisions).orderBy(asc(divisions.sortOrder)),
    db.select().from(leagueOwners).orderBy(asc(leagueOwners.teamName)),
    db.select().from(draftAssignments),
    db.select().from(draftPicks),
    db.select().from(scoringWeeks).orderBy(asc(scoringWeeks.weekNumber)),
    db.select().from(scoringRules).orderBy(asc(scoringRules.eventType), asc(scoringRules.minYards)),
    db.select().from(scoringEvents).orderBy(desc(scoringEvents.createdAt)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
  ]);

  const userById = new Map(userRows.map(user => [user.id, user]));

  const pointsByGroup = new Map<string, number>();
  const pointsByGroupWeek = new Map<string, number>();
  for (const event of eventRows) {
    const groupKey = keyFor(event.schoolName, event.position);
    const weekKey = `${event.weekId}::${groupKey}`;
    pointsByGroup.set(groupKey, (pointsByGroup.get(groupKey) ?? 0) + Number(event.computedPoints));
    pointsByGroupWeek.set(weekKey, (pointsByGroupWeek.get(weekKey) ?? 0) + Number(event.computedPoints));
  }

  const assignmentsByOwner = new Map<number, typeof assignmentRows>();
  assignmentRows.forEach(assignment => {
    assignmentsByOwner.set(assignment.ownerId, [...(assignmentsByOwner.get(assignment.ownerId) ?? []), assignment]);
  });
  const picksByOwner = new Map<number, typeof pickRows>();
  pickRows.forEach(pick => {
    picksByOwner.set(pick.ownerId, [...(picksByOwner.get(pick.ownerId) ?? []), pick]);
  });

  const owners = ownerRows.map(owner => {
    const ownerPicks = (picksByOwner.get(owner.id) ?? []).map(pick => ({
      ...pick,
      positionLabel: positionLabel[pick.position],
      seasonPoints: Number((pointsByGroup.get(keyFor(pick.schoolName, pick.position)) ?? 0).toFixed(2)),
      weeklyPoints: weekRows.map(week => ({
        weekId: week.id,
        weekNumber: week.weekNumber,
        points: Number((pointsByGroupWeek.get(`${week.id}::${keyFor(pick.schoolName, pick.position)}`) ?? 0).toFixed(2)),
      })),
    }));
    return {
      ...owner,
      assignments: assignmentsByOwner.get(owner.id) ?? [],
      picks: ownerPicks,
      totalPoints: Number(ownerPicks.reduce((total, pick) => total + pick.seasonPoints, 0).toFixed(2)),
    };
  });

  const divisionsWithStandings = divisionRows.map(division => ({
    ...division,
    owners: rankBySeasonPoints(owners.filter(owner => owner.divisionId === division.id))
      .map(owner => ({ ...owner, divisionRank: owner.rank })),
  }));

  const overallStandings = rankBySeasonPoints(owners).map(owner => ({ ...owner, overallRank: owner.rank }));

  const leaderboard = positions.map(position => ({
    position,
    label: positionLabel[position],
    entries: pickRows
      .filter(pick => pick.position === position)
      .map(pick => {
        const owner = owners.find(candidate => candidate.id === pick.ownerId);
        return {
          ...pick,
          teamName: owner?.teamName ?? "Unassigned team",
          ownerName: owner?.displayName ?? "Unknown owner",
          totalPoints: Number((pointsByGroup.get(keyFor(pick.schoolName, pick.position)) ?? 0).toFixed(2)),
        };
      })
      .sort((a, b) => b.totalPoints - a.totalPoints || a.schoolName.localeCompare(b.schoolName)),
  }));

  const weeklySummaries = weekRows.map(week => ({
    ...week,
    teams: overallStandings.map(owner => ({
      ownerId: owner.id,
      teamName: owner.teamName,
      points: Number(owner.picks.reduce((total, pick) => total + (pick.weeklyPoints.find(item => item.weekId === week.id)?.points ?? 0), 0).toFixed(2)),
    })).sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName)),
  }));

  const eventsWithContext = eventRows.map(event => ({
    ...event,
    weekNumber: weekRows.find(week => week.id === event.weekId)?.weekNumber ?? 0,
    weekLabel: weekRows.find(week => week.id === event.weekId)?.label ?? "Unknown week",
    positionLabel: positionLabel[event.position],
    recordedByName: userById.get(event.recordedByUserId)?.name ?? userById.get(event.recordedByUserId)?.email ?? "Commissioner",
  }));

  return {
    divisions: divisionsWithStandings,
    owners,
    overallStandings,
    weeks: weekRows,
    weeklySummaries,
    rules: ruleRows,
    leaderboard,
    events: eventsWithContext,
    totals: {
      ownerCount: owners.length,
      divisionCount: divisionRows.length,
      draftPickCount: pickRows.length,
      scoringEventCount: eventRows.length,
    },
  };
}

export async function ensureGroupIsDrafted(schoolName: string, position: Position) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  const matches = await db
    .select({ id: draftPicks.id })
    .from(draftPicks)
    .where(and(eq(draftPicks.schoolName, schoolName), eq(draftPicks.position, position)))
    .limit(1);
  if (!matches[0]) throw new Error("Score events may only be recorded for a drafted school-position group.");
}

export async function getScoringRulesForEvent(eventType: (typeof scoringRules.$inferSelect)["eventType"]) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  return db.select().from(scoringRules).where(and(eq(scoringRules.eventType, eventType), eq(scoringRules.isActive, "true")));
}

export async function getScoreEvent(eventId: number) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  const rows = await db.select().from(scoringEvents).where(eq(scoringEvents.id, eventId)).limit(1);
  if (!rows[0]) throw new Error("Scoring event not found.");
  return rows[0];
}

export async function getOwnerDraftAssignments(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  return db.select().from(draftAssignments).where(eq(draftAssignments.ownerId, ownerId));
}

export async function getOwnerById(ownerId: number) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  const rows = await db.select().from(leagueOwners).where(eq(leagueOwners.id, ownerId)).limit(1);
  if (!rows[0]) throw new Error("League owner not found.");
  return rows[0];
}

export async function getPickByOwnerAndPosition(ownerId: number, position: Position) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  const rows = await db.select().from(draftPicks).where(and(eq(draftPicks.ownerId, ownerId), eq(draftPicks.position, position))).limit(1);
  return rows[0];
}

export async function getOpenDraftAssignmentConflict(assignments: Array<{ ownerId: number; position: Position; draftPosition: number }>) {
  const db = await getDb();
  if (!db) throw new Error("The Big 36 database is unavailable.");
  const positionGroups = new Map<Position, number[]>();
  assignments.forEach(assignment => positionGroups.set(assignment.position, [...(positionGroups.get(assignment.position) ?? []), assignment.draftPosition]));
  for (const [position, draftPositions] of Array.from(positionGroups.entries())) {
    const used = await db.select().from(draftAssignments).where(and(eq(draftAssignments.position, position), inArray(draftAssignments.draftPosition, draftPositions)));
    const conflict = used.find(row => row.ownerId !== assignments[0]?.ownerId);
    if (conflict) return conflict;
  }
  return undefined;
}
