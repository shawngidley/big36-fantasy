import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFbsTeams: vi.fn(), getLiveScoreboard: vi.fn(), getRegularSeasonGames: vi.fn(), getRoster: vi.fn(), getWeekPlays: vi.fn(), getWeekPlayStats: vi.fn(), getLivePlays: vi.fn(),
  getLeagueSnapshot: vi.fn(), getScoringRulesForEvent: vi.fn(), calculateEventScore: vi.fn(), mapLivePlayToCandidates: vi.fn(), eligibleGameIdsForSchool: vi.fn(), finalShutoutCandidates: vi.fn(), isSupersededInterceptionPlay: vi.fn(), supabaseRest: vi.fn(),
}));

vi.mock("./cfbd", () => ({
  getFbsTeams: mocks.getFbsTeams, getLiveScoreboard: mocks.getLiveScoreboard, getRegularSeasonGames: mocks.getRegularSeasonGames,
  getRoster: mocks.getRoster, getWeekPlays: mocks.getWeekPlays, getWeekPlayStats: mocks.getWeekPlayStats, getLivePlays: mocks.getLivePlays,
}));
vi.mock("./league-data", () => ({ getLeagueSnapshot: mocks.getLeagueSnapshot, getScoringRulesForEvent: mocks.getScoringRulesForEvent }));
vi.mock("./league-scoring", () => ({ calculateEventScore: mocks.calculateEventScore }));
vi.mock("./live-scoring", () => ({ eligibleGameIdsForSchool: mocks.eligibleGameIdsForSchool, finalShutoutCandidates: mocks.finalShutoutCandidates, isSupersededInterceptionPlay: mocks.isSupersededInterceptionPlay, mapLivePlayToCandidates: mocks.mapLivePlayToCandidates }));
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
    mocks.finalShutoutCandidates.mockReturnValue([]);
    mocks.isSupersededInterceptionPlay.mockReturnValue(false);
    mocks.getScoringRulesForEvent.mockResolvedValue([]);
    mocks.calculateEventScore.mockReturnValue({ points: 9 });
    mocks.getLivePlays.mockResolvedValue({ teams: [], drives: [] });
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

  it("never auto-reverses an already-official entry, even if the current fetch no longer produces a matching candidate (the exact bug that zeroed out Virginia's DEF score)", async () => {
    const officialEntry = { ...original, is_provisional: false };
    const writes = arrange([officialEntry]);
    mocks.mapLivePlayToCandidates.mockReturnValue([]); // this run's fetch didn't reproduce the candidate
    await runGamedayRefresh({ force: true });
    expect(writes.filter(write => write.table === "b36_scoring_events" && write.options.method === "POST" && (write.options.body as Record<string, unknown>).audit_action === "REVERSAL")).toHaveLength(0);
  });

  it("restores points when a final source removes a previously recorded negative turnover", async () => {
    const negativeTurnover = { ...original, event_type: "INTERCEPTION_THROWN", computed_points: -3, yard_distance: null };
    const writes = arrange([negativeTurnover]);
    mocks.mapLivePlayToCandidates.mockReturnValue([]);
    await runGamedayRefresh({ force: true });
    expect(writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST")?.options.body).toMatchObject({ audit_action: "REVERSAL", computed_points: 3, correction_of_event_id: "event-1" });
  });

  it("records an idempotent same-key correction when the official final point value changes", async () => {
    const writes = arrange([original]);
    mocks.mapLivePlayToCandidates.mockReturnValue([candidate]);
    mocks.calculateEventScore.mockReturnValue({ points: 12 });
    await runGamedayRefresh({ force: true });
    expect(writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST")?.options.body).toMatchObject({ audit_action: "CORRECTION", computed_points: 3, correction_of_event_id: "event-1" });
  });

  it("records a signed positive correction when a negative source event is corrected to zero", async () => {
    const negativeTurnover = { ...original, event_type: "INTERCEPTION_THROWN", computed_points: -3, yard_distance: null };
    const writes = arrange([negativeTurnover]);
    mocks.mapLivePlayToCandidates.mockReturnValue([candidate]);
    mocks.calculateEventScore.mockReturnValue({ points: 0 });
    await runGamedayRefresh({ force: true });
    expect(writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST")?.options.body).toMatchObject({ audit_action: "CORRECTION", computed_points: 3, correction_of_event_id: "event-1" });
  });

  it("only counts games with a live 'in_progress' scoreboard status as active, not every game that isn't yet marked completed", async () => {
    const liveGame = { ...game, id: 201, completed: false, status: "in_progress" };
    const scheduledGame = { ...game, id: 202, completed: false, status: "scheduled", homeTeam: "Georgia", awayTeam: "Alabama" };
    mocks.getRegularSeasonGames.mockResolvedValue([liveGame, scheduledGame]);
    mocks.getLiveScoreboard.mockResolvedValue([liveGame, scheduledGame]);
    mocks.getLeagueSnapshot.mockResolvedValue({ owners: [{ picks: [{ id: "slot-qb", schoolName: "Ohio State", position: "QB" }, { id: "slot-rb", schoolName: "Georgia", position: "RB" }] }], weeks: [{ id: "week-1", weekNumber: 1 }] });
    arrange([]);
    mocks.mapLivePlayToCandidates.mockReturnValue([]);

    const result = await runGamedayRefresh({ force: true });

    expect(result.relevantGames).toBe(2);
    expect(result.activeGames).toBe(1);
  });

  it("detects a scoring play from the live-plays feed for an in-progress game and inserts it as a provisional event, without waiting for the game to finish", async () => {
    const liveGame = { ...game, id: 301, completed: false, status: "in_progress" };
    mocks.getRegularSeasonGames.mockResolvedValue([liveGame]);
    mocks.getLiveScoreboard.mockResolvedValue([liveGame]);
    mocks.getLivePlays.mockResolvedValue({
      teams: [{ team: "Ohio State", homeAway: "home", points: 7 }, { team: "Texas", homeAway: "away", points: 0 }],
      drives: [{ id: "d1", offense: "Ohio State", defense: "Texas", plays: [
        { id: "9001", homeScore: 0, awayScore: 0, period: 1, clock: "10:00", teamId: 1, team: "Ohio State", playType: "Rush", playText: "First down run", yardsGained: 5 },
        { id: "9002", homeScore: 7, awayScore: 0, period: 1, clock: "8:30", teamId: 1, team: "Ohio State", playType: "Passing Touchdown", playText: "22 Yd pass, TOUCHDOWN", yardsGained: 22 },
      ] }],
    });
    const writes = arrange([]);
    mocks.mapLivePlayToCandidates.mockImplementation(({ play }: { play: { scoring: boolean } }) => play.scoring ? [{ ...candidate, sourceGameId: 301 }] : []);

    const result = await runGamedayRefresh({ force: true });

    expect(result.insertedEvents).toBeGreaterThan(0);
    const liveWrite = writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST" && (write.options.body as Record<string, unknown>).recorded_by_open_id === "cfbd-live-detection");
    expect(liveWrite?.options.body).toMatchObject({ audit_action: "ENTRY", is_provisional: true, source_game_id: 301 });
  });

  it("automatically creates the scoring week if it doesn't exist yet, instead of silently skipping every event (the real bug found in production)", async () => {
    const liveGame = { ...game, id: 401, week: 1, completed: false, status: "in_progress" };
    mocks.getRegularSeasonGames.mockResolvedValue([liveGame]);
    mocks.getLiveScoreboard.mockResolvedValue([liveGame]);
    mocks.getLeagueSnapshot.mockResolvedValue({ owners: [{ picks: [{ id: "slot-qb", schoolName: "Ohio State", position: "QB" }] }], weeks: [] }); // <-- no weeks exist at all
    mocks.getLivePlays.mockResolvedValue({
      teams: [{ team: "Ohio State", homeAway: "home", points: 7 }, { team: "Texas", homeAway: "away", points: 0 }],
      drives: [{ id: "d1", offense: "Ohio State", defense: "Texas", plays: [
        { id: "5001", homeScore: 7, awayScore: 0, period: 1, clock: "9:00", teamId: 1, team: "Ohio State", playType: "Rushing Touchdown", playText: "5 Yd run, TOUCHDOWN", yardsGained: 5 },
      ] }],
    });
    const writes: Array<{ table: string; options: Record<string, unknown> }> = [];
    mocks.supabaseRest.mockImplementation(async (table: string, options: Record<string, unknown> = {}) => {
      if (table === "b36_automation_config" && options.method !== "PATCH") return [{ season: 2026, enabled: true, last_refresh_at: null, schedule_cron_task_uid: null }];
      if (table === "b36_scoring_events" && options.query) return [];
      if (table === "b36_scoring_weeks" && !options.method) return []; // fresh DB check: doesn't exist yet
      if (table === "b36_scoring_weeks" && options.method === "POST") { writes.push({ table, options }); return [{ id: "week-created-1", week_number: 1 }]; }
      if (options.method) writes.push({ table, options });
      return [];
    });
    mocks.mapLivePlayToCandidates.mockImplementation(({ play }: { play: { scoring: boolean } }) => play.scoring ? [{ ...candidate, sourceGameId: 401 }] : []);

    const result = await runGamedayRefresh({ force: true });

    expect(writes.some(write => write.table === "b36_scoring_weeks" && write.options.method === "POST")).toBe(true);
    expect(result.insertedEvents).toBeGreaterThan(0);
    const eventWrite = writes.find(write => write.table === "b36_scoring_events" && write.options.method === "POST");
    expect(eventWrite?.options.body).toMatchObject({ week_id: "week-created-1" });
  });

  it("completely skips a week marked FINAL, making no writes at all even when a scoring event would otherwise be detected - this is the actual fix for tonight's regression, where a detection code change retroactively altered already-settled data", async () => {
    const liveGame = { ...game, id: 501, week: 1, completed: false, status: "in_progress" };
    mocks.getRegularSeasonGames.mockResolvedValue([liveGame]);
    mocks.getLiveScoreboard.mockResolvedValue([liveGame]);
    mocks.getLeagueSnapshot.mockResolvedValue({ owners: [{ picks: [{ id: "slot-qb", schoolName: "Ohio State", position: "QB" }] }], weeks: [{ id: "week-1", weekNumber: 1, status: "FINAL" }] });
    mocks.getLivePlays.mockResolvedValue({
      teams: [{ team: "Ohio State", homeAway: "home", points: 7 }, { team: "Texas", homeAway: "away", points: 0 }],
      drives: [{ id: "d1", offense: "Ohio State", defense: "Texas", plays: [{ id: "9001", homeScore: 7, awayScore: 0, period: 1, clock: "9:00", teamId: 1, team: "Ohio State", playType: "Rushing Touchdown", playText: "TOUCHDOWN", yardsGained: 5 }] }],
    });
    const writes = arrange([]);
    mocks.mapLivePlayToCandidates.mockImplementation(({ play }: { play: { scoring: boolean } }) => play.scoring ? [{ ...candidate, sourceGameId: 501 }] : []);

    const result = await runGamedayRefresh({ force: true });

    expect(writes.filter(write => write.table === "b36_scoring_events")).toHaveLength(0);
    expect(result.insertedEvents).toBe(0);
    expect(result.relevantGames).toBe(0);
  });

  it("skips a run entirely if another run is already in progress (running_since set recently) - the actual fix for tonight's overlapping-runs regression, where continuous automation caused two runs to interfere with each other while a single isolated run did not", async () => {
    const writes: Array<{ table: string; options: Record<string, unknown> }> = [];
    mocks.supabaseRest.mockImplementation(async (table: string, options: Record<string, unknown> = {}) => {
      if (table === "b36_automation_config" && options.method !== "PATCH") return [{ season: 2026, enabled: true, last_refresh_at: null, schedule_cron_task_uid: null, running_since: new Date(Date.now() - 30_000).toISOString() }];
      if (options.method) writes.push({ table, options });
      return [];
    });

    const result = await runGamedayRefresh({ force: true });

    expect(result).toMatchObject({ skipped: "already-running", insertedEvents: 0, activeGames: 0 });
    expect(writes).toHaveLength(0);
  });

  it("treats a stale lock (older than 5 minutes, implying a crashed prior run) as abandoned and proceeds normally, rather than permanently blocking all future runs", async () => {
    const writes: Array<{ table: string; options: Record<string, unknown> }> = [];
    mocks.supabaseRest.mockImplementation(async (table: string, options: Record<string, unknown> = {}) => {
      if (table === "b36_automation_config" && options.method !== "PATCH") return [{ season: 2026, enabled: true, last_refresh_at: null, schedule_cron_task_uid: null, running_since: new Date(Date.now() - 10 * 60_000).toISOString() }];
      if (table === "b36_scoring_events" && options.query) return [];
      if (options.method) writes.push({ table, options });
      return [];
    });
    mocks.getRegularSeasonGames.mockResolvedValue([]);
    mocks.getLiveScoreboard.mockResolvedValue([]);

    const result = await runGamedayRefresh({ force: true });

    expect(result).not.toMatchObject({ skipped: "already-running" });
    expect(writes.some(write => write.table === "b36_automation_config" && (write.options.body as Record<string, unknown>).running_since === null)).toBe(true);
  });
});
