import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFbsTeams: vi.fn(), getLiveScoreboard: vi.fn(), getRegularSeasonGames: vi.fn(), getRoster: vi.fn(), getWeekPlays: vi.fn(), getWeekPlayStats: vi.fn(),
  getLeagueSnapshot: vi.fn(), getScoringRulesForEvent: vi.fn(), calculateEventScore: vi.fn(), mapLivePlayToCandidates: vi.fn(), eligibleGameIdsForSchool: vi.fn(), supabaseRest: vi.fn(),
}));

vi.mock("./cfbd", () => ({
  getFbsTeams: mocks.getFbsTeams, getLiveScoreboard: mocks.getLiveScoreboard, getRegularSeasonGames: mocks.getRegularSeasonGames,
  getRoster: mocks.getRoster, getWeekPlays: mocks.getWeekPlays, getWeekPlayStats: mocks.getWeekPlayStats,
}));
vi.mock("./league-data", () => ({ getLeagueSnapshot: mocks.getLeagueSnapshot, getScoringRulesForEvent: mocks.getScoringRulesForEvent }));
vi.mock("./league-scoring", () => ({ calculateEventScore: mocks.calculateEventScore }));
vi.mock("./live-scoring", () => ({ eligibleGameIdsForSchool: mocks.eligibleGameIdsForSchool, mapLivePlayToCandidates: mocks.mapLivePlayToCandidates }));
vi.mock("./supabase", () => ({ supabaseRest: mocks.supabaseRest }));

import { runGamedayRefresh } from "./gameday-refresh";

const game = { id: 101, season: 2026, week: 1, seasonType: "regular", startDate: "2026-09-05T16:00:00Z", completed: true, homeTeam: "Ohio State", awayTeam: "Texas", homeClassification: "fbs", awayClassification: "fbs", homePoints: 21, awayPoints: 14 };
const candidate = { sourceEventKey: "101:55:qb", sourceGameId: 101, schoolName: "Ohio State", position: "QB", eventType: "TOUCHDOWN", statValue: 1, yardDistance: 35, note: "Passing touchdown" };
const snapshot = { owners: [{ picks: [{ id: "slot-qb", schoolName: "Ohio State", position: "QB" }] }], weeks: [{ id: "week-1", weekNumber: 1 }] };
const original = { id: "event-1", source_event_key: "101:55:qb", source_game_id: 101, audit_action: "ENTRY", week_id: "week-1", draft_slot_id: "slot-qb", event_type: "TOUCHDOWN", stat_value: 1, yard_distance: 35, computed_points: 9, is_provisional: true };

function arrange(existingEvents: unknown[]) {
  const writes: Array<{ table: string; options: Record<string, unknown> }> = [];
  mocks.supabaseRest.mockImplementation(async (table: string, options: Record<string, unknown> = {}) => {
    if (table === "b36_automation_config" && options.method !== "PATCH") return [{ season: 2026, enabled: true, last_refresh_at: null, schedule_cron_task_uid: null }];
    if (table === "b36_scoring_events" && options.query) return existingEvents;
    if (options.method) writes.push({ table, options });
    return [];
  });
  return writes;
}

describe("36 Football gameday source reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFbsTeams.mockResolvedValue(Array.from({ length: 136 }, (_, index) => ({ id: index + 1, school: `School ${index + 1}`, conference: "FBS" })));
    mocks.getRegularSeasonGames.mockResolvedValue([game]);
    mocks.getLeagueSnapshot.mockResolvedValue(snapshot);
    mocks.getLiveScoreboard.mockResolvedValue([game]);
    mocks.getWeekPlays.mockResolvedValue([{ id: 55, gameId: 101, offense: "Ohio State" }]);
    mocks.getWeekPlayStats.mockResolvedValue([]);
    mocks.getRoster.mockResolvedValue([]);
    mocks.eligibleGameIdsForSchool.mockReturnValue([101]);
    mocks.getScoringRulesForEvent.mockResolvedValue([]);
    mocks.calculateEventScore.mockReturnValue({ points: 9 });
  });

  it("keeps an unchanged final source event without a duplicate correction or reversal", async () => {
    const writes = arrange([original]);
    mocks.mapLivePlayToCandidates.mockReturnValue([candidate]);
    await runGamedayRefresh({ force: true });
    expect(writes.filter(write => write.table === "b36_scoring_events" && write.options.method === "POST")).toHaveLength(0);
  });

  it("records an idempotent reversal when a final source event is removed", async () => {
    const writes = arrange([original]);
    mocks.mapLivePlayToCandidates.mockReturnValue([]);
    await runGamedayRefresh({ force: true });
    expect(writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST")?.options.body).toMatchObject({ audit_action: "REVERSAL", computed_points: -9, correction_of_event_id: "event-1" });
  });

  it("records an idempotent same-key correction when the official final point value changes", async () => {
    const writes = arrange([original]);
    mocks.mapLivePlayToCandidates.mockReturnValue([candidate]);
    mocks.calculateEventScore.mockReturnValue({ points: 12 });
    await runGamedayRefresh({ force: true });
    expect(writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST")?.options.body).toMatchObject({ audit_action: "CORRECTION", computed_points: 3, correction_of_event_id: "event-1" });
  });
});
