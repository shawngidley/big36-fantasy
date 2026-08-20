import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseRest: vi.fn() }));

vi.mock("./supabase", () => ({
  q: { eq: (value: string | boolean) => `eq.${String(value)}`, isNull: "is.null" },
  supabaseRest: mocks.supabaseRest,
}));

import { completedScheduleNormalization, getOwnerDraftBoard, getDraftResearchCatalog, getLeagueSnapshot, getScoringRulesForEvent, overallRankAtEvent, publicDraftResearchUnit } from "./league-data";

describe("Big 36 public live-results snapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calculates an affected program's overall rank before and after a scoring update", () => {
    const owners = [{ id: "alpha", teamName: "Alpha" }, { id: "bravo", teamName: "Bravo" }, { id: "charlie", teamName: "Charlie" }];
    const totals = new Map<string, number>([["alpha", 10], ["bravo", 8], ["charlie", 6]]);
    expect(overallRankAtEvent("bravo", owners, totals)).toBe(2);
    totals.set("bravo", 14);
    expect(overallRankAtEvent("bravo", owners, totals)).toBe(1);
  });

  it("normalizes a completed regular season with fewer than twelve games and leaves unfinished schedules raw", () => {
    const completedEleven = Array.from({ length: 11 }, (_, index) => ({ season: 2026, season_type: "regular", completed: true, home_team: "Hawaii", away_team: `Opponent ${index}` }));
    expect(completedScheduleNormalization("Hawaii", completedEleven)).toBeCloseTo(12 / 11);
    expect(completedScheduleNormalization("Hawaii", [...completedEleven, { season: 2026, season_type: "regular", completed: false, home_team: "Hawaii", away_team: "Future Opponent" }])).toBe(1);
  });

  it("suppresses point totals for a research unit held pending historical event reconciliation", () => {
    const unit = publicDraftResearchUnit({ season: 2025, school_name: "Utah State", position: "QB", official_points: 255, eligible_games: 12, normalization_factor: 1, normalized_points: 255, event_counts: {}, stat_summary: { historical_points_hold: true }, source_note: "Held", calculated_at: "2026-08-19T00:00:00.000Z" });
    expect(unit).toMatchObject({ schoolName: "Utah State", officialPoints: null, normalizedPoints: null });
  });

  it("returns no usable point total through the public research query for a held record", async () => {
    mocks.supabaseRest.mockResolvedValueOnce([{ season: 2025, school_name: "Utah State", position: "QB", official_points: 255, eligible_games: 12, normalization_factor: 1, normalized_points: 255, event_counts: {}, stat_summary: { historical_points_hold: true }, source_note: "Held", calculated_at: "2026-08-19T00:00:00.000Z" }]);
    await expect(getDraftResearchCatalog("QB")).resolves.toMatchObject([{ schoolName: "Utah State", officialPoints: null, normalizedPoints: null }]);
  });

	it("returns no usable K/ST point total through the public research query when a component remains held", async () => {
	  mocks.supabaseRest.mockResolvedValueOnce([{ season: 2025, school_name: "Georgia Tech", position: "K_ST", official_points: 174, eligible_games: 12, normalization_factor: 1, normalized_points: 174, event_counts: { BLOCK: 1 }, stat_summary: { historical_points_hold: true, historical_points_hold_reason: "Block cross-check incomplete" }, source_note: "Held", calculated_at: "2026-08-19T00:00:00.000Z" }]);
	  await expect(getDraftResearchCatalog("K_ST")).resolves.toMatchObject([{ schoolName: "Georgia Tech", officialPoints: null, normalizedPoints: null }]);
	});

  it("builds a private filtered board that hides drafted units and carries 2025 research values into queued entries", async () => {
    const certified = { season: 2025, school_name: "Ohio State", position: "QB", official_points: 244, eligible_games: 12, normalization_factor: 1, normalized_points: 244, event_counts: {}, stat_summary: {}, source_note: "Certified", calculated_at: "2026-08-19T00:00:00.000Z" };
    const held = { season: 2025, school_name: "Texas", position: "RB", official_points: 210, eligible_games: 12, normalization_factor: 1, normalized_points: 210, event_counts: {}, stat_summary: { historical_points_hold: true }, source_note: "Held", calculated_at: "2026-08-19T00:00:00.000Z" };
    mocks.supabaseRest
      .mockResolvedValueOnce([certified, held])
      .mockResolvedValueOnce([{ school_name: "Ohio State", position: "QB" }])
      .mockResolvedValueOnce([{ school_name: null, position: "QB" }])
      .mockResolvedValueOnce([{ id: "queue-1", owner_id: "owner-1", school_name: "Texas", position: "RB", priority: 1, created_at: "2026-08-19T00:00:00.000Z", updated_at: "2026-08-19T00:00:00.000Z" }]);

    const board = await getOwnerDraftBoard("owner-1", "RB");

    expect(board.availableUnits).toEqual([expect.objectContaining({ schoolName: "Texas", position: "RB", normalizedPoints: null, isQueued: true, canQueue: true })]);
    expect(board.queue).toEqual([expect.objectContaining({ schoolName: "Texas", priority: 1, isAvailable: true, unit: expect.objectContaining({ normalizedPoints: null }) })]);
  });

	it("exposes a clearly labeled provisional DEF value without treating it as a certified historical total", () => {
		  const unit = publicDraftResearchUnit({ season: 2025, school_name: "Air Force", position: "DEF", official_points: 48, eligible_games: 12, normalization_factor: 1, normalized_points: 48, event_counts: { SACK: 15, INTERCEPTION: 7 }, stat_summary: { historical_points_certified: false, historical_points_hold: false, historical_points_provisional: true, provisional_def_estimated_td_count: 2 }, source_note: "Provisional estimate", calculated_at: "2026-08-19T00:00:00.000Z" });
		  expect(unit).toMatchObject({ schoolName: "Air Force", officialPoints: 48, normalizedPoints: 48, statSummary: { historical_points_provisional: true, historical_points_certified: false, provisional_def_estimated_td_count: 2 } });
	});

  it("uses authoritative Year 1 touchdown rules when the database rule table is empty", async () => {
    mocks.supabaseRest.mockResolvedValueOnce([]);
    const rules = await getScoringRulesForEvent("TOUCHDOWN");
    expect(rules.filter(rule => rule.positionScope === "TE").map(rule => rule.flatPoints)).toEqual([12, 12, 12, 12]);
    expect(rules.filter(rule => rule.positionScope === "QB").map(rule => rule.flatPoints)).toEqual([6, 8, 10, 12]);
  });

  it("shows a negative live source correction as a public before-and-after ledger change with restored standings", async () => {
    mocks.supabaseRest.mockImplementation(async (table: string) => {
      if (table === "b36_divisions") return [{ id: "division-1", name: "Atlantic", sort_order: 1 }];
      if (table === "b36_owners") return [
        { id: "owner-a", manus_open_id: null, display_name: "Alpha Owner", team_name: "Alpha", email: "alpha@example.com", division_id: "division-1", is_commissioner: false },
        { id: "owner-b", manus_open_id: null, display_name: "Bravo Owner", team_name: "Bravo", email: "bravo@example.com", division_id: "division-1", is_commissioner: false },
      ];
      if (table === "b36_draft_slots") return [
        { id: "slot-a", owner_id: "owner-a", position: "QB", draft_position: 1, school_name: "Ohio State", selected_at: null, selected_by_open_id: null },
        { id: "slot-b", owner_id: "owner-b", position: "QB", draft_position: 2, school_name: "Texas", selected_at: null, selected_by_open_id: null },
      ];
      if (table === "b36_scoring_weeks") return [{ id: "week-1", week_number: 1, label: "Week 1", status: "FINAL" }];
      if (table === "b36_scoring_events") return [
        { id: "source-turnover", week_id: "week-1", draft_slot_id: "slot-a", event_type: "INTERCEPTION_THROWN", stat_value: 1, yard_distance: null, computed_points: -3, note: "Provisional CFBD turnover", audit_action: "ENTRY", correction_of_event_id: null, recorded_by_open_id: "cfbd-live-refresh", created_at: "2026-09-05T18:00:00.000Z" },
        { id: "source-correction", week_id: "week-1", draft_slot_id: "slot-a", event_type: "INTERCEPTION_THROWN", stat_value: 1, yard_distance: null, computed_points: 3, note: "Official CFBD final correction", audit_action: "CORRECTION", correction_of_event_id: "source-turnover", recorded_by_open_id: "cfbd-final-reconciliation", created_at: "2026-09-05T18:10:00.000Z" },
      ];
      if (table === "b36_automation_config") return [{ season: 2026 }];
      return [];
    });

    const snapshot = await getLeagueSnapshot();
    const correction = snapshot.events.find(event => event.id === "source-correction");

    expect(correction).toMatchObject({ auditAction: "CORRECTION", computedPoints: 3, pointsBefore: -3, pointsAfter: 0, overallRankBefore: 2, overallRankAfter: 1 });
    expect(snapshot.overallStandings.map(owner => ({ teamName: owner.teamName, totalPoints: owner.totalPoints, overallRank: owner.overallRank }))).toEqual([
      { teamName: "Alpha", totalPoints: 0, overallRank: 1 },
      { teamName: "Bravo", totalPoints: 0, overallRank: 2 },
    ]);
  });

  it("builds team totals, standings, weekly scores, and position leaders from Supabase records", async () => {
    mocks.supabaseRest
      .mockResolvedValueOnce([{ id: "division-1", name: "Atlantic", sort_order: 1 }])
      .mockResolvedValueOnce([{ id: "owner-1", manus_open_id: "open-1", display_name: "Jordan Owner", team_name: "North Stars", email: "owner@example.com", division_id: "division-1", is_commissioner: false }])
      .mockResolvedValueOnce([{ id: "slot-1", owner_id: "owner-1", position: "QB", draft_position: 4, school_name: "Ohio State", selected_at: null, selected_by_open_id: "open-1" }])
      .mockResolvedValueOnce([{ id: "week-1", week_number: 1, label: "Opening Week", status: "FINAL" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "event-1", week_id: "week-1", draft_slot_id: "slot-1", event_type: "TOUCHDOWN", stat_value: 1, yard_distance: 18, computed_points: 9, note: "Official box score", audit_action: "ENTRY", correction_of_event_id: null, recorded_by_open_id: "open-1", created_at: "2026-08-16T12:00:00.000Z" }])
      .mockResolvedValueOnce([{ status: "PAUSED", active_position: null, updated_at: "2026-08-16T12:00:00.000Z" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ season: 2026 }]);

    const snapshot = await getLeagueSnapshot();

    expect(snapshot.overallStandings).toHaveLength(1);
    expect(snapshot.overallStandings[0]).toMatchObject({ teamName: "North Stars", totalPoints: 9, overallRank: 1 });
    expect(snapshot.divisions[0]?.owners[0]).toMatchObject({ teamName: "North Stars", divisionRank: 1 });
    expect(snapshot.weeklySummaries[0]?.teams).toEqual([{ ownerId: "owner-1", teamName: "North Stars", points: 9 }]);
    expect(snapshot.leaderboard.find(group => group.position === "QB")?.entries[0]).toMatchObject({ schoolName: "Ohio State", teamName: "North Stars", totalPoints: 9 });
    expect(snapshot.events[0]).toMatchObject({ weekLabel: "Opening Week", schoolName: "Ohio State", computedPoints: 9 });
  });
});
