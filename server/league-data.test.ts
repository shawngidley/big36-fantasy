import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseRest: vi.fn() }));

vi.mock("./supabase", () => ({
  q: { eq: (value: string | boolean) => `eq.${String(value)}`, isNull: "is.null" },
  supabaseRest: mocks.supabaseRest,
}));

import { completedScheduleNormalization, getLeagueSnapshot, overallRankAtEvent } from "./league-data";

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
