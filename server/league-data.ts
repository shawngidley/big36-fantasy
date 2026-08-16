import type { Position, ScoringEventType } from "../drizzle/schema";
import { rankBySeasonPoints } from "./league-scoring";
import { q, supabaseRest } from "./supabase";

export const b36Positions = ["QB", "RB", "WR", "TE", "DEF_ST", "FLEX"] as const;
const positionLabel: Record<Position, string> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", DEF_ST: "DEF/ST", FLEX: "FLEX" };

type DivisionRow = { id: string; name: string; sort_order: number };
type OwnerRow = { id: string; manus_open_id: string | null; display_name: string; team_name: string; email: string | null; division_id: string | null; is_commissioner: boolean };
type SlotRow = { id: string; owner_id: string; position: Position; draft_position: number; school_name: string | null; selected_at: string | null; selected_by_open_id: string | null };
type WeekRow = { id: string; week_number: number; label: string; status: "UPCOMING" | "OPEN" | "FINAL" };
type RuleRow = { id: string; label: string; event_type: ScoringEventType; position_scope: "ALL" | Position; min_yards: number | null; max_yards: number | null; flat_points: number | null; points_per_unit: number | null; is_active: boolean };
type EventRow = { id: string; week_id: string; draft_slot_id: string; event_type: ScoringEventType; stat_value: number; yard_distance: number | null; computed_points: number; note: string | null; audit_action: "ENTRY" | "CORRECTION" | "REVERSAL"; correction_of_event_id: string | null; recorded_by_open_id: string; created_at: string };
type DraftStateRow = { status: "SETUP" | "OPEN" | "PAUSED" | "COMPLETE"; active_position: Position | null; updated_at: string };

const ownerPath = "b36_owners";
const slotPath = "b36_draft_slots";

const asNumber = (value: number | string | null) => value === null ? null : Number(value);

function camelOwner(owner: OwnerRow) {
  return { id: owner.id, manusOpenId: owner.manus_open_id, displayName: owner.display_name, teamName: owner.team_name, email: owner.email, divisionId: owner.division_id, isCommissioner: owner.is_commissioner };
}

function camelSlot(slot: SlotRow) {
  return { id: slot.id, ownerId: slot.owner_id, position: slot.position, draftPosition: slot.draft_position, schoolName: slot.school_name, selectedAt: slot.selected_at, selectedByOpenId: slot.selected_by_open_id };
}

export async function getLeagueSnapshot() {
  const [divisionRows, ownerRows, slotRows, weekRows, ruleRows, eventRows, stateRows] = await Promise.all([
    supabaseRest<DivisionRow[]>("b36_divisions", { query: { select: "*", order: "sort_order.asc" } }),
    supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", order: "team_name.asc" } }),
    supabaseRest<SlotRow[]>(slotPath, { query: { select: "*", order: "position.asc,draft_position.asc" } }),
    supabaseRest<WeekRow[]>("b36_scoring_weeks", { query: { select: "*", order: "week_number.asc" } }),
    supabaseRest<RuleRow[]>("b36_scoring_rules", { query: { select: "*", order: "event_type.asc,min_yards.asc" } }),
    supabaseRest<EventRow[]>("b36_scoring_events", { query: { select: "*", order: "created_at.desc" } }),
    supabaseRest<DraftStateRow[]>("b36_draft_state", { query: { select: "*", id: "eq.true" } }),
  ]);

  const pointsBySlot = new Map<string, number>();
  const weeklyPointsBySlot = new Map<string, number>();
  for (const event of eventRows) {
    pointsBySlot.set(event.draft_slot_id, (pointsBySlot.get(event.draft_slot_id) ?? 0) + Number(event.computed_points));
    weeklyPointsBySlot.set(`${event.week_id}::${event.draft_slot_id}`, (weeklyPointsBySlot.get(`${event.week_id}::${event.draft_slot_id}`) ?? 0) + Number(event.computed_points));
  }

  const owners = ownerRows.map(row => {
    const owner = camelOwner(row);
    const slots = slotRows.filter(slot => slot.owner_id === row.id);
    const picks = slots.filter(slot => slot.school_name).map(slot => ({
      ...camelSlot(slot),
      schoolName: slot.school_name!,
      positionLabel: positionLabel[slot.position],
      seasonPoints: Number((pointsBySlot.get(slot.id) ?? 0).toFixed(2)),
      weeklyPoints: weekRows.map(week => ({ weekId: week.id, weekNumber: week.week_number, points: Number((weeklyPointsBySlot.get(`${week.id}::${slot.id}`) ?? 0).toFixed(2)) })),
    }));
    return { ...owner, assignments: slots.map(camelSlot), picks, totalPoints: Number(picks.reduce((sum, pick) => sum + pick.seasonPoints, 0).toFixed(2)) };
  });

  const divisions = divisionRows.map(row => ({
    id: row.id, name: row.name, sortOrder: row.sort_order,
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
  const events = eventRows.map(event => {
    const slot = slotRows.find(item => item.id === event.draft_slot_id);
    const author = ownerByOpenId.get(event.recorded_by_open_id);
    return { id: event.id, weekId: event.week_id, weekNumber: weekRows.find(week => week.id === event.week_id)?.week_number ?? 0, weekLabel: weekRows.find(week => week.id === event.week_id)?.label ?? "Unknown week", schoolName: slot?.school_name ?? "Unassigned", position: slot?.position ?? "QB", positionLabel: positionLabel[slot?.position ?? "QB"], eventType: event.event_type, statValue: Number(event.stat_value), yardDistance: asNumber(event.yard_distance), computedPoints: Number(event.computed_points), note: event.note, auditAction: event.audit_action, correctionOfEventId: event.correction_of_event_id, recordedByName: author?.display_name ?? "Commissioner", createdAt: event.created_at };
  });
  const state = stateRows[0] ?? { status: "SETUP" as const, active_position: null, updated_at: new Date(0).toISOString() };
  const currentTurn = state.active_position ? slotRows.filter(slot => slot.position === state.active_position && !slot.school_name).sort((a, b) => a.draft_position - b.draft_position)[0] : undefined;
  const turnOwner = currentTurn ? owners.find(owner => owner.id === currentTurn.owner_id) : undefined;

  return { divisions, owners, overallStandings, weeks: weekRows.map(week => ({ id: week.id, weekNumber: week.week_number, label: week.label, status: week.status })), weeklySummaries, rules: ruleRows.map(rule => ({ id: rule.id, label: rule.label, eventType: rule.event_type, positionScope: rule.position_scope, minYards: asNumber(rule.min_yards), maxYards: asNumber(rule.max_yards), flatPoints: asNumber(rule.flat_points), pointsPerUnit: asNumber(rule.points_per_unit), isActive: rule.is_active ? "true" : "false" })), leaderboard, events, draftState: { status: state.status, activePosition: state.active_position, updatedAt: state.updated_at, currentTurn: currentTurn ? { ...camelSlot(currentTurn), schoolName: null, ownerId: currentTurn.owner_id, teamName: turnOwner?.teamName ?? "Unassigned team" } : null }, totals: { ownerCount: owners.length, divisionCount: divisions.length, draftPickCount: slotRows.filter(slot => slot.school_name).length, scoringEventCount: events.length } };
}

export async function getOrClaimOwner(openId: string, email?: string | null) {
  const existing = await supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", manus_open_id: q.eq(openId) } });
  if (existing[0]) return camelOwner(existing[0]);
  if (!email) return null;
  const candidates = await supabaseRest<OwnerRow[]>(ownerPath, { query: { select: "*", email: q.eq(email.toLowerCase()), manus_open_id: q.isNull } });
  const candidate = candidates[0];
  if (!candidate) return null;
  const claimed = await supabaseRest<OwnerRow[]>(ownerPath, { method: "PATCH", query: { id: q.eq(candidate.id), manus_open_id: q.isNull }, body: { manus_open_id: openId }, prefer: "return=representation" });
  return claimed[0] ? camelOwner(claimed[0]) : null;
}

export async function getDraftOwnerState(openId: string, email?: string | null) {
  const [owner, snapshot] = await Promise.all([getOrClaimOwner(openId, email), getLeagueSnapshot()]);
  const enrolledOwner = owner ? snapshot.owners.find(item => item.id === owner.id) ?? null : null;
  const activePosition = snapshot.draftState.activePosition;
  const assignedSlot = enrolledOwner && activePosition ? enrolledOwner.assignments.find(slot => slot.position === activePosition) : undefined;
  return { owner: enrolledOwner, draftState: snapshot.draftState, assignedSlot, canPick: Boolean(enrolledOwner && assignedSlot && snapshot.draftState.status === "OPEN" && snapshot.draftState.currentTurn?.ownerId === enrolledOwner.id) };
}

export async function getDraftSlotByGroup(schoolName: string, position: Position) {
  const rows = await supabaseRest<SlotRow[]>(slotPath, { query: { select: "*", school_name: q.eq(schoolName), position: q.eq(position) } });
  if (!rows[0]) throw new Error("Score events may only be recorded for a drafted school-position group.");
  return rows[0];
}

export async function getScoringRulesForEvent(eventType: ScoringEventType) {
  const rows = await supabaseRest<RuleRow[]>("b36_scoring_rules", { query: { select: "*", event_type: q.eq(eventType), is_active: q.eq(true) } });
  return rows.map(rule => ({ id: Number.parseInt(rule.id.replace(/-/g, "").slice(0, 8), 16), eventType: rule.event_type, positionScope: rule.position_scope, minYards: asNumber(rule.min_yards), maxYards: asNumber(rule.max_yards), flatPoints: asNumber(rule.flat_points), pointsPerUnit: asNumber(rule.points_per_unit), isActive: "true" as const }));
}

export async function getScoreEvent(eventId: string) {
  const rows = await supabaseRest<EventRow[]>("b36_scoring_events", { query: { select: "*", id: q.eq(eventId) } });
  if (!rows[0]) throw new Error("Scoring event not found.");
  return rows[0];
}

export async function getAllDraftSlots() {
  return supabaseRest<SlotRow[]>(slotPath, { query: { select: "*" } });
}
