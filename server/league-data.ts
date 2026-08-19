import type { Position, ScoringEventType } from "../drizzle/schema";
import { rankBySeasonPoints } from "./league-scoring";
import { ownerCanDraft } from "./serpentine-draft";
import { q, supabaseRest } from "./supabase";
import { yearOneRules } from "./year-one-rules";

export const b36Positions = ["QB", "RB", "WR", "TE", "K_ST", "DEF"] as const;
const positionLabel: Record<Position, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K_ST: "K/ST", DEF: "DEF" };

type DivisionRow = { id: string; name: string; sort_order: number; identity?: string | null; logo_url?: string | null };
type OwnerRow = { id: string; manus_open_id: string | null; display_name: string; team_name: string; nickname?: string | null; program_identity?: string | null; logo_url?: string | null; email: string | null; division_id: string | null; is_commissioner: boolean; draft_order?: number | null };
type SlotRow = { id: string; owner_id: string; position: Position; draft_position: number; school_name: string | null; selected_at: string | null; selected_by_open_id: string | null };
type WeekRow = { id: string; week_number: number; label: string; status: "UPCOMING" | "OPEN" | "FINAL" };
type RuleRow = { id: string; label: string; event_type: ScoringEventType; position_scope: "ALL" | Position; min_yards: number | null; max_yards: number | null; flat_points: number | null; points_per_unit: number | null; is_active: boolean };
type EventRow = { id: string; week_id: string; draft_slot_id: string; event_type: ScoringEventType; stat_value: number; yard_distance: number | null; computed_points: number; note: string | null; audit_action: "ENTRY" | "CORRECTION" | "REVERSAL"; correction_of_event_id: string | null; recorded_by_open_id: string; created_at: string };
type DraftStateRow = { status: "SETUP" | "OPEN" | "PAUSED" | "COMPLETE"; active_position: Position | null; updated_at: string };
type DraftTurnRow = { id: string; global_pick: number; round_number: number; owner_id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; expires_at: string | null; skipped_at: string | null; picked_at: string | null; draft_slot_id: string | null };
type ResearchUnitRow = { season: number; school_name: string; position: Position; official_points: number | string | null; eligible_games: number; normalization_factor: number | string; normalized_points: number | string | null; event_counts: Record<string, number>; stat_summary: Record<string, number>; source_note: string; calculated_at: string };
type SourceGameRow = { season: number; season_type: string; completed: boolean; home_team: string; away_team: string };
type AutomationSeasonRow = { season: number };

const ownerPath = "b36_owners";
const slotPath = "b36_draft_slots";

const asNumber = (value: number | string | null) => value === null ? null : Number(value);
const normalizeSchoolName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function fallbackYearOneRules(eventType?: ScoringEventType) {
  return yearOneRules
    .filter(rule => !eventType || rule.eventType === eventType)
    .map((rule, index) => ({
      id: -(index + 1),
      eventType: rule.eventType,
      positionScope: rule.positionScope,
      minYards: rule.minYards,
      maxYards: rule.maxYards,
      flatPoints: rule.flatPoints,
      pointsPerUnit: null,
      isActive: "true" as const,
    }));
}

function tiedLeaders<T extends { totalPoints: number }>(entries: T[]) {
  const topScore = entries[0]?.totalPoints;
  return topScore === undefined ? [] : entries.filter(entry => entry.totalPoints === topScore);
}

function championAward<T extends { totalPoints: number }>(entries: T[], pool: number) {
  const winners = tiedLeaders(entries);
  return { winners, pool, share: winners.length ? Number((pool / winners.length).toFixed(2)) : 0 };
}

export function overallRankAtEvent(ownerId: string, owners: Array<{ id: string; teamName: string }>, totals: Map<string, number>) {
  return [...owners]
    .sort((left, right) => (totals.get(right.id) ?? 0) - (totals.get(left.id) ?? 0) || left.teamName.localeCompare(right.teamName))
    .findIndex(owner => owner.id === ownerId) + 1;
}

export function completedScheduleNormalization(schoolName: string, regularGames: SourceGameRow[]) {
  const schedule = regularGames.filter(game => game.home_team === schoolName || game.away_team === schoolName);
  if (!schedule.length || schedule.length >= 12 || schedule.some(game => !game.completed)) return 1;
  return 12 / schedule.length;
}

function camelOwner(owner: OwnerRow) {
  return { id: owner.id, manusOpenId: owner.manus_open_id, displayName: owner.display_name, teamName: owner.team_name, nickname: owner.nickname ?? null, programIdentity: owner.program_identity ?? null, logoUrl: owner.logo_url ?? null, email: owner.email, divisionId: owner.division_id, isCommissioner: owner.is_commissioner, draftOrder: owner.draft_order ?? null };
}

function camelSlot(slot: SlotRow) {
  return { id: slot.id, ownerId: slot.owner_id, position: slot.position, draftPosition: slot.draft_position, schoolName: slot.school_name, selectedAt: slot.selected_at, selectedByOpenId: slot.selected_by_open_id };
}

export async function getLeagueSnapshot() {
  const [divisionRows, ownerRows, slotRows, weekRows, ruleRows, eventRows, stateRows, turnRows, sourceGameRows, automationRows] = await Promise.all([
    supabaseRest<DivisionRow[]>("b36_divisions", { query: { select: "*", order: "sort_order.asc" } }),
    supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", order: "team_name.asc" } }),
    supabaseRest<SlotRow[]>(slotPath, { query: { select: "*", order: "position.asc,draft_position.asc" } }),
    supabaseRest<WeekRow[]>("b36_scoring_weeks", { query: { select: "*", order: "week_number.asc" } }),
    supabaseRest<RuleRow[]>("b36_scoring_rules", { query: { select: "*", order: "event_type.asc,min_yards.asc" } }),
    supabaseRest<EventRow[]>("b36_scoring_events", { query: { select: "*", order: "created_at.desc" } }),
    supabaseRest<DraftStateRow[]>("b36_draft_state", { query: { select: "*", id: "eq.true" } }),
    supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "*", order: "global_pick.asc" } }),
    supabaseRest<SourceGameRow[]>("b36_source_games", { query: { select: "season,season_type,completed,home_team,away_team" } }),
    supabaseRest<AutomationSeasonRow[]>("b36_automation_config", { query: { select: "season", id: "eq.true" } }),
  ]);

  const pointsBySlot = new Map<string, number>();
  const weeklyPointsBySlot = new Map<string, number>();
  for (const event of eventRows) {
    pointsBySlot.set(event.draft_slot_id, (pointsBySlot.get(event.draft_slot_id) ?? 0) + Number(event.computed_points));
    weeklyPointsBySlot.set(`${event.week_id}::${event.draft_slot_id}`, (weeklyPointsBySlot.get(`${event.week_id}::${event.draft_slot_id}`) ?? 0) + Number(event.computed_points));
  }

  const season = automationRows[0]?.season;
  const regularGames = sourceGameRows.filter(game => game.season === season && game.season_type.toLowerCase() === "regular");
  const normalizationFactorForSchool = (schoolName: string) => completedScheduleNormalization(schoolName, regularGames);

  const owners = ownerRows.map(row => {
    const owner = camelOwner(row);
    const slots = slotRows.filter(slot => slot.owner_id === row.id);
    const picks = slots.filter(slot => slot.school_name).map(slot => ({
      ...camelSlot(slot),
      schoolName: slot.school_name!,
      positionLabel: positionLabel[slot.position],
      rawSeasonPoints: Number((pointsBySlot.get(slot.id) ?? 0).toFixed(2)),
      normalizationFactor: normalizationFactorForSchool(slot.school_name!),
      seasonPoints: Number(((pointsBySlot.get(slot.id) ?? 0) * normalizationFactorForSchool(slot.school_name!)).toFixed(2)),
      weeklyPoints: weekRows.map(week => ({ weekId: week.id, weekNumber: week.week_number, points: Number((weeklyPointsBySlot.get(`${week.id}::${slot.id}`) ?? 0).toFixed(2)) })),
    }));
    return { ...owner, assignments: slots.map(camelSlot), picks, totalPoints: Number(picks.reduce((sum, pick) => sum + pick.seasonPoints, 0).toFixed(2)) };
  });

  const divisions = divisionRows.map(row => ({
    id: row.id, name: row.name, identity: row.identity ?? null, logoUrl: row.logo_url ?? null, sortOrder: row.sort_order,
    owners: rankBySeasonPoints(owners.filter(owner => owner.divisionId === row.id)).map(owner => ({ ...owner, divisionRank: owner.rank })),
  }));
  const overallStandings = rankBySeasonPoints(owners).map(owner => ({ ...owner, overallRank: owner.rank }));
  const leaderboard = b36Positions.map(position => ({
    position, label: positionLabel[position],
    entries: slotRows.filter(slot => slot.position === position && slot.school_name).map(slot => {
      const owner = owners.find(item => item.id === slot.owner_id);
      return { ...camelSlot(slot), schoolName: slot.school_name!, teamName: owner?.teamName ?? "Unassigned team", ownerName: owner?.displayName ?? "Unknown owner", totalPoints: Number((pointsBySlot.get(slot.id) ?? 0).toFixed(2)) };
    }).sort((a, b) => b.totalPoints - a.totalPoints || a.schoolName.localeCompare(b.schoolName)),
  }));
  const weeklySummaries = weekRows.map(week => ({
    id: week.id, weekNumber: week.week_number, label: week.label, status: week.status,
    teams: overallStandings.map(owner => ({ ownerId: owner.id, teamName: owner.teamName, points: Number(owner.picks.reduce((sum, pick) => sum + (pick.weeklyPoints.find(item => item.weekId === week.id)?.points ?? 0), 0).toFixed(2)) })).sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName)),
  }));
  const ownerByOpenId = new Map(ownerRows.filter(row => row.manus_open_id).map(row => [row.manus_open_id!, row]));
  const ownerBySlotId = new Map(slotRows.map(slot => [slot.id, owners.find(owner => owner.id === slot.owner_id)]));
  const runningPointsByOwner = new Map<string, number>();
  const eventImpactById = new Map<string, { teamName: string; pointsBefore: number; pointsAfter: number; overallRankBefore: number; overallRankAfter: number }>();
  for (const event of [...eventRows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())) {
    const affectedOwner = ownerBySlotId.get(event.draft_slot_id);
    if (!affectedOwner) continue;
    const pointsBefore = runningPointsByOwner.get(affectedOwner.id) ?? 0;
    const overallRankBefore = overallRankAtEvent(affectedOwner.id, owners, runningPointsByOwner);
    const pointsAfter = Number((pointsBefore + Number(event.computed_points)).toFixed(2));
    runningPointsByOwner.set(affectedOwner.id, pointsAfter);
    const overallRankAfter = overallRankAtEvent(affectedOwner.id, owners, runningPointsByOwner);
    eventImpactById.set(event.id, { teamName: affectedOwner.teamName, pointsBefore, pointsAfter, overallRankBefore, overallRankAfter });
  }
  const events = eventRows.map(event => {
    const slot = slotRows.find(item => item.id === event.draft_slot_id);
    const author = ownerByOpenId.get(event.recorded_by_open_id);
    const impact = eventImpactById.get(event.id);
    return { id: event.id, weekId: event.week_id, weekNumber: weekRows.find(week => week.id === event.week_id)?.week_number ?? 0, weekLabel: weekRows.find(week => week.id === event.week_id)?.label ?? "Unknown week", schoolName: slot?.school_name ?? "Unassigned", position: slot?.position ?? "QB", positionLabel: positionLabel[slot?.position ?? "QB"], eventType: event.event_type, statValue: Number(event.stat_value), yardDistance: asNumber(event.yard_distance), computedPoints: Number(event.computed_points), note: event.note, auditAction: event.audit_action, correctionOfEventId: event.correction_of_event_id, recordedByName: author?.display_name ?? "Commissioner", teamName: impact?.teamName ?? "Unassigned team", pointsBefore: impact?.pointsBefore ?? 0, pointsAfter: impact?.pointsAfter ?? 0, overallRankBefore: impact?.overallRankBefore ?? 0, overallRankAfter: impact?.overallRankAfter ?? 0, createdAt: event.created_at };
  });
  const state = stateRows[0] ?? { status: "SETUP" as const, active_position: null, updated_at: new Date(0).toISOString() };
  const activeTurn = (turnRows ?? []).find(turn => turn.status === "ACTIVE");
  const turnOwner = activeTurn ? owners.find(owner => owner.id === activeTurn.owner_id) : undefined;
  const champions = {
    national: championAward(overallStandings, 1200),
    conferences: divisions.map(division => ({ conferenceId: division.id, conferenceName: division.name, ...championAward(division.owners, 200) })),
    positions: leaderboard.map(board => ({ position: board.position, label: board.label, ...championAward(board.entries, 200) })),
  };
  const draftTurns = turnRows.map(turn => ({
    id: turn.id,
    globalPick: turn.global_pick,
    roundNumber: turn.round_number,
    ownerId: turn.owner_id,
    teamName: owners.find(owner => owner.id === turn.owner_id)?.teamName ?? "Unassigned program",
    status: turn.status,
    expiresAt: turn.expires_at,
    skippedAt: turn.skipped_at,
    pickedAt: turn.picked_at,
    draftSlotId: turn.draft_slot_id,
  }));

  const rules = ruleRows.length
    ? ruleRows.map(rule => ({ id: rule.id, label: rule.label, eventType: rule.event_type, positionScope: rule.position_scope, minYards: asNumber(rule.min_yards), maxYards: asNumber(rule.max_yards), flatPoints: asNumber(rule.flat_points), pointsPerUnit: asNumber(rule.points_per_unit), isActive: rule.is_active ? "true" : "false" }))
    : yearOneRules.map((rule, index) => ({ id: `fallback-${index + 1}`, label: rule.label, eventType: rule.eventType, positionScope: rule.positionScope, minYards: rule.minYards, maxYards: rule.maxYards, flatPoints: rule.flatPoints, pointsPerUnit: null, isActive: "true" as const }));
  return { divisions, owners, overallStandings, weeks: weekRows.map(week => ({ id: week.id, weekNumber: week.week_number, label: week.label, status: week.status })), weeklySummaries, rules, leaderboard, events, champions, draftTurns, draftState: { status: state.status, activePosition: null, updatedAt: state.updated_at, currentTurn: activeTurn ? { id: activeTurn.id, ownerId: activeTurn.owner_id, teamName: turnOwner?.teamName ?? "Unassigned team", draftPosition: activeTurn.global_pick, roundNumber: activeTurn.round_number, expiresAt: activeTurn.expires_at } : null }, totals: { ownerCount: owners.length, divisionCount: divisions.length, draftPickCount: slotRows.filter(slot => slot.school_name).length, scoringEventCount: events.length } };
}

export function publicDraftResearchUnit(row: ResearchUnitRow) {
  const historicalPointHold = (row.stat_summary as Record<string, unknown> | null)?.historical_points_hold === true;
  return {
    season: row.season,
    schoolName: row.school_name,
    position: row.position,
    officialPoints: historicalPointHold ? null : Number(row.official_points),
    eligibleGames: row.eligible_games,
    normalizationFactor: Number(row.normalization_factor),
    normalizedPoints: historicalPointHold ? null : Number(row.normalized_points),
    eventCounts: row.event_counts ?? {},
    statSummary: row.stat_summary ?? {},
    sourceNote: row.source_note,
    calculatedAt: row.calculated_at,
  };
}

export async function getDraftResearchCatalog(position?: Position) {
  const query: Record<string, string> = { select: "season,school_name,position,official_points,eligible_games,normalization_factor,normalized_points,event_counts,stat_summary,source_note,calculated_at", season: q.eq(2025), order: "normalized_points.desc,school_name.asc" };
  if (position) query.position = q.eq(position);
  const rows = await supabaseRest<ResearchUnitRow[]>("b36_draft_research_units", { query });
  return rows.map(publicDraftResearchUnit);
}

export async function getOrClaimOwner(openId: string, email?: string | null) {
  const existing = await supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", manus_open_id: q.eq(openId) } });
  if (existing[0]) return camelOwner(existing[0]);
  if (!email) return null;
  const candidates = await supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", email: q.eq(email.toLowerCase()) } });
  const candidate = candidates[0];
  if (!candidate) return null;
  const claimed = await supabaseRest<OwnerRow[]>(ownerPath, { method: "PATCH", query: { id: q.eq(candidate.id), email: q.eq(email.toLowerCase()) }, body: { manus_open_id: openId }, prefer: "return=representation" });
  return claimed[0] ? camelOwner(claimed[0]) : null;
}

export async function getDraftOwnerState(openId: string, email?: string | null) {
  const [owner, snapshot, turns] = await Promise.all([getOrClaimOwner(openId, email), getLeagueSnapshot(), supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "*", order: "global_pick.asc" } })]);
  const enrolledOwner = owner ? snapshot.owners.find(item => item.id === owner.id) ?? null : null;
  const availablePositions = enrolledOwner ? b36Positions.filter(position => !enrolledOwner.picks.some(pick => pick.position === position)) : [];
  const skippedTurns = enrolledOwner ? turns.filter(turn => turn.owner_id === enrolledOwner.id && turn.status === "SKIPPED").map(turn => ({ globalPick: turn.global_pick, roundNumber: turn.round_number })) : [];
  const activeIndex = turns.findIndex(turn => turn.status === "ACTIVE");
  const nextOwnerTurnIndex = enrolledOwner ? turns.findIndex((turn, index) => index >= Math.max(activeIndex, 0) && turn.owner_id === enrolledOwner.id && (turn.status === "ACTIVE" || turn.status === "PENDING")) : -1;
  const picksAway = skippedTurns.length ? 0 : activeIndex >= 0 && nextOwnerTurnIndex >= activeIndex ? nextOwnerTurnIndex - activeIndex : null;
  const ownedUnitKeys = new Set(enrolledOwner?.picks.map(pick => `${normalizeSchoolName(pick.schoolName)}::${pick.position}`) ?? []);
  const correctionAlerts = snapshot.events.filter(event => (event.auditAction === "CORRECTION" || event.auditAction === "REVERSAL") && ownedUnitKeys.has(`${normalizeSchoolName(event.schoolName)}::${event.position}`)).slice(0, 5);
  return { owner: enrolledOwner, draftState: snapshot.draftState, availablePositions, skippedTurns, picksAway, correctionAlerts, canPick: Boolean(enrolledOwner && snapshot.draftState.status === "OPEN" && ownerCanDraft(turns.map(turn => ({ globalPick: turn.global_pick, roundNumber: turn.round_number, ownerId: turn.owner_id, status: turn.status, expiresAt: turn.expires_at })), enrolledOwner.id)) };
}

export async function getDraftSlotByGroup(schoolName: string, position: Position) {
  const rows = await supabaseRest<SlotRow[]>(slotPath, { query: { select: "*", school_name: q.eq(schoolName), position: q.eq(position) } });
  if (!rows[0]) throw new Error("Score events may only be recorded for a drafted school-position group.");
  return rows[0];
}

export async function getScoringRulesForEvent(eventType: ScoringEventType) {
  const rows = await supabaseRest<RuleRow[]>("b36_scoring_rules", { query: { select: "*", event_type: q.eq(eventType), is_active: q.eq(true) } });
  return rows.length
    ? rows.map(rule => ({ id: Number.parseInt(rule.id.replace(/-/g, "").slice(0, 8), 16), eventType: rule.event_type, positionScope: rule.position_scope, minYards: asNumber(rule.min_yards), maxYards: asNumber(rule.max_yards), flatPoints: asNumber(rule.flat_points), pointsPerUnit: asNumber(rule.points_per_unit), isActive: "true" as const }))
    : fallbackYearOneRules(eventType);
}

export async function getScoreEvent(eventId: string) {
  const rows = await supabaseRest<EventRow[]>("b36_scoring_events", { query: { select: "*", id: q.eq(eventId) } });
  if (!rows[0]) throw new Error("Scoring event not found.");
  return rows[0];
}

export async function getAllDraftSlots() {
  return supabaseRest<SlotRow[]>(slotPath, { query: { select: "*" } });
}
