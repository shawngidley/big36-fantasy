// The inaugural draft is six rounds of 36 programs, serpentine: odd rounds run 1 -> 36 and even
// rounds 36 -> 1. A selection is stored only as its global position in that order
// (b36_draft_slots.draft_position, 1-216), so round and pick-within-round are derived here rather
// than stored. The within-round number is SEQUENTIAL WITHIN THE ROUND - the Nth selection made in
// that round - which is how the draft board already frames a round ("Picks 37-72 · 36 -> 1"), and
// not the program's lottery slot: in an even round, pick 1 of the round belongs to the program
// that drew slot 36.
//
// This lived inline in DraftBoard only, so Team and UnitDetail showed a bare global number ("Pick
// 41") that an owner could not place in a round. One home for it now, so a fourth view does not
// re-derive it.
export const DRAFT_PROGRAM_COUNT = 36;
export const DRAFT_ROUND_COUNT = 6;
export const DRAFT_PICK_COUNT = DRAFT_PROGRAM_COUNT * DRAFT_ROUND_COUNT;

export const firstPickOfRound = (roundNumber: number) => (roundNumber - 1) * DRAFT_PROGRAM_COUNT + 1;
export const lastPickOfRound = (roundNumber: number) => firstPickOfRound(roundNumber) + DRAFT_PROGRAM_COUNT - 1;
export const roundRunsForward = (roundNumber: number) => roundNumber % 2 === 1;

export function draftPickBreakdown(globalPick: number | null | undefined) {
  if (globalPick == null || !Number.isFinite(globalPick) || globalPick < 1) return null;
  const pick = Math.trunc(globalPick);
  return { globalPick: pick, roundNumber: Math.ceil(pick / DRAFT_PROGRAM_COUNT), pickInRound: ((pick - 1) % DRAFT_PROGRAM_COUNT) + 1 };
}

// "Round 2, Pick 5 (41 overall)". A selection with no recorded position - some were entered
// without a linked draft turn - keeps showing an em dash instead of an invented round.
export function formatDraftPick(globalPick: number | null | undefined) {
  const breakdown = draftPickBreakdown(globalPick);
  return breakdown ? `Round ${breakdown.roundNumber}, Pick ${breakdown.pickInRound} (${breakdown.globalPick} overall)` : "—";
}
