import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// fullScoringAudit previously issued TWO sequential Supabase round trips PER DRAFTED SLOT inside its
// results loop - one refetching that slot's full event history, and one re-fetching the exact same
// b36_scoring_weeks row (for the requested week) on every single iteration, despite it never changing
// across iterations. With 100+ drafted slots in a normal week, that's 200+ sequential HTTP calls before
// the endpoint could return - confirmed live: a plain week-2 call 504'd against Vercel's 60-second
// function timeout. This test drives the real router handler (not a reimplementation) with multiple
// relevant slots and asserts both that the fix collapses this to a fixed, small number of Supabase
// calls (independent of slot count) AND that the per-slot mismatch computation itself is unchanged.

const mocks = vi.hoisted(() => ({
  getRegularSeasonGames: vi.fn(),
  getWeekPlays: vi.fn(),
  getWeekPlayStats: vi.fn(),
  getRoster: vi.fn(),
  getLeagueSnapshot: vi.fn(),
  getScoringRulesForEvent: vi.fn(),
  calculateEventScore: vi.fn(),
  mapLivePlayToCandidates: vi.fn(),
  isSupersededInterceptionPlay: vi.fn(),
  supabaseRest: vi.fn(),
}));

vi.mock("./cfbd", () => ({
  getRegularSeasonGames: mocks.getRegularSeasonGames, getWeekPlays: mocks.getWeekPlays, getWeekPlayStats: mocks.getWeekPlayStats, getRoster: mocks.getRoster,
  getLiveScoreboard: vi.fn(), getLivePlays: vi.fn(), getFbsTeams: vi.fn(), getGamePlayerStats: vi.fn(),
}));
vi.mock("./league-data", () => ({ getLeagueSnapshot: mocks.getLeagueSnapshot, getScoringRulesForEvent: mocks.getScoringRulesForEvent }));
vi.mock("./league-scoring", () => ({ calculateEventScore: mocks.calculateEventScore }));
vi.mock("./live-scoring", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./live-scoring")>();
  return {
    mapLivePlayToCandidates: mocks.mapLivePlayToCandidates,
    isSupersededInterceptionPlay: mocks.isSupersededInterceptionPlay,
    normalizeSchoolForComparison: (value: string) => value.trim().toLowerCase().replace(/\s+/g, " "),
    boxScoreFumbleCandidates: vi.fn(),
    finalShutoutCandidates: vi.fn(() => []),
    eligibleGameIdsForSchool: vi.fn(() => []),
    matchBoxAthleteToRoster: vi.fn(),
    // Pure helpers - use the real ones so the audit's stats-lookup path is actually exercised.
    indexPlayStatsByPlayId: actual.indexPlayStatsByPlayId,
    statsForPlay: actual.statsForPlay,
  };
});
vi.mock("./supabase", () => ({
  q: { eq: (value: unknown) => `eq.${String(value)}`, isNull: "is.null" },
  supabaseRest: mocks.supabaseRest,
  supabaseRestAll: vi.fn().mockResolvedValue([]),
  supabaseRpc: vi.fn(),
}));

import { appRouter } from "./routers";

function adminContext(): TrpcContext {
  return {
    user: { id: 1, openId: "admin-open-id", name: "Admin", email: "admin@example.com", loginMethod: "email", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const game = { id: 101, season: 2026, week: 2, seasonType: "regular", startDate: "2026-09-12T19:00:00Z", completed: true, homeTeam: "School X", awayTeam: "School Y", homeClassification: "fbs", awayClassification: "fbs", homePoints: 21, awayPoints: 14 };

// A minimal fake b36_scoring_events table that actually respects the query filters real Postgrest
// would apply (draft_slot_id eq.<id> or in.(<id>,<id>,...), and week_id eq.<id> when present) - so a
// test comparing "old per-slot eq query" behavior against "new batched in.() query" behavior is a
// genuine apples-to-apples check, not an artifact of a mock that ignores filters entirely.
function fakeScoringEventsTable(rows: Array<{ computed_points: number; week_id: string; draft_slot_id: string }>) {
  return (query: Record<string, string> = {}) => {
    let filtered = rows;
    const slotFilter = query.draft_slot_id;
    if (slotFilter) {
      const ids = slotFilter.startsWith("in.(") ? slotFilter.slice(4, -1).split(",") : [slotFilter.replace(/^eq\./, "")];
      filtered = filtered.filter(row => ids.includes(row.draft_slot_id));
    }
    const weekFilter = query.week_id;
    if (weekFilter) filtered = filtered.filter(row => row.week_id === weekFilter.replace(/^eq\./, ""));
    return filtered;
  };
}

describe("league.admin.fullScoringAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRegularSeasonGames.mockResolvedValue([game]);
    mocks.getWeekPlays.mockResolvedValue([{ id: 1, gameId: 101, offense: "School X" }, { id: 2, gameId: 101, offense: "School Y" }]);
    mocks.getWeekPlayStats.mockResolvedValue([]);
    mocks.getRoster.mockResolvedValue([]);
    mocks.isSupersededInterceptionPlay.mockReturnValue(false);
    mocks.getScoringRulesForEvent.mockResolvedValue([]);
    // Three drafted slots across the one relevant game, so a fixed (not slot-count-scaling) number
    // of Supabase calls is the whole point being tested here.
    mocks.getLeagueSnapshot.mockResolvedValue({
      owners: [
        { teamName: "Owner A", picks: [{ id: "slot-1", schoolName: "School X", position: "QB" }] },
        { teamName: "Owner B", picks: [{ id: "slot-2", schoolName: "School Y", position: "RB" }] },
        { teamName: "Owner C", picks: [{ id: "slot-3", schoolName: "School Y", position: "DST" }] },
      ],
    });
    mocks.mapLivePlayToCandidates.mockImplementation(({ play }: { play: { offense: string } }) => {
      if (play.offense === "School X") return [{ sourceEventKey: "1:qb", sourceGameId: 101, schoolName: "School X", position: "QB", eventType: "TOUCHDOWN", statValue: 1, yardDistance: 10, note: "" }];
      return [{ sourceEventKey: "2:rb", sourceGameId: 101, schoolName: "School Y", position: "RB", eventType: "TOUCHDOWN", statValue: 1, yardDistance: 10, note: "" }];
    });
    mocks.calculateEventScore.mockImplementation((_rules: unknown, candidate: { position: string }) => ({ points: candidate.position === "QB" ? 9 : 6 }));
    // slot-1 (QB) stored correctly at 9; slot-2 (RB) stored at a stale 3 (should mismatch against the
    // official 6); slot-3 (DST) never scored anything this week (should mismatch 0 vs 0 = no mismatch).
    const eventsTable = fakeScoringEventsTable([
      { computed_points: 9, week_id: "week-2-id", draft_slot_id: "slot-1" },
      { computed_points: 3, week_id: "week-2-id", draft_slot_id: "slot-2" },
    ]);
    mocks.supabaseRest.mockImplementation(async (table: string, options: { query?: Record<string, string> } = {}) => {
      if (table === "b36_automation_config") return [{ season: 2026 }];
      if (table === "b36_scoring_weeks") return [{ id: "week-2-id" }];
      if (table === "b36_scoring_events") return eventsTable(options.query);
      return [];
    });
  });

  it("batches the per-slot stored-events lookup into one call and the week lookup into one call, regardless of how many drafted slots are in play", async () => {
    const caller = appRouter.createCaller(adminContext());
    await caller.league.admin.fullScoringAudit({ week: 2 });

    const weekCalls = mocks.supabaseRest.mock.calls.filter(call => call[0] === "b36_scoring_weeks");
    const eventCalls = mocks.supabaseRest.mock.calls.filter(call => call[0] === "b36_scoring_events");
    expect(weekCalls).toHaveLength(1);
    expect(eventCalls).toHaveLength(1);
    // The single batched events query covers every relevant slot in one `in.(...)` filter, not one
    // request per slot.
    const eventsQuery = eventCalls[0][1] as { query: { draft_slot_id: string } };
    expect(eventsQuery.query.draft_slot_id).toBe("in.(slot-1,slot-2,slot-3)");
  });

  it("fetches every distinct school's roster in parallel rather than one at a time - a second, separate 504 cause left over after the Supabase batching fix alone", async () => {
    // Deduping which schools need a roster fetch was never the problem (the old code already cached
    // by school with a plain Map). The problem was SEQUENCING: `for (const school of ...) { ...
    // await getRoster(...) ... }` awaited each call before starting the next, so with N distinct
    // schools this endpoint made N sequential CFBD round trips - confirmed live: the audit still
    // 504'd even after the Supabase per-slot batching fix landed on its own. A call-count assertion
    // alone can't tell parallel from sequential-with-dedup (both make exactly one call per school),
    // so this holds every getRoster call unresolved and checks that BOTH distinct schools (School X,
    // School Y) were already requested before either one resolves - which only happens if they were
    // kicked off together (Promise.all), not one after the other.
    const pendingResolvers: Array<() => void> = [];
    mocks.getRoster.mockImplementation(() => new Promise(resolve => { pendingResolvers.push(() => resolve([])); }));
    const caller = appRouter.createCaller(adminContext());
    const resultPromise = caller.league.admin.fullScoringAudit({ week: 2 });
    // Flush the microtask queue enough times for every synchronous-until-first-real-await step ahead
    // of the roster fetch (the automation-config lookup, the Promise.all of schedule/plays/stats/
    // snapshot) to settle, without ever resolving a getRoster call ourselves.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(mocks.getRoster.mock.calls.map(call => call[0]).sort()).toEqual(["School X", "School Y"]);
    pendingResolvers.forEach(resolve => resolve());
    await resultPromise;
  });

  it("still reports the exact same mismatches the old per-slot loop would have (behavior preserved, not just faster)", async () => {
    const caller = appRouter.createCaller(adminContext());
    const result = await caller.league.admin.fullScoringAudit({ week: 2 });

    expect(result.checkedSlots).toBe(3);
    expect(result.gamesChecked).toBe(1);
    // slot-1 (QB): official 9, stored 9 -> no mismatch.
    expect(result.mismatches.find((m: { position: string }) => m.position === "QB")).toBeUndefined();
    // slot-2 (RB): official 6, stored 3 -> mismatch of +3.
    expect(result.mismatches).toContainEqual(expect.objectContaining({ owner: "Owner B", school: "School Y", position: "RB", officialPoints: 6, storedPoints: 3, difference: 3 }));
    // slot-3 (DST): official 0 (no candidates map to it), stored 0 (no rows) -> no mismatch.
    expect(result.mismatches.find((m: { position: string }) => m.position === "DST")).toBeUndefined();
  });

  it("paginates by game with a stable id order and a nextOffset chain, checking only the page's slots on each call", async () => {
    // A second relevant game (higher id) with a third drafted school on it. With limit 1 the first
    // call must cover only game 101's slots and report nextOffset 1; the second call covers only game
    // 202's slot and reports nextOffset null. Slot totals never straddle pages because each slot's
    // school plays exactly one game a week and both sides of a game are processed together.
    const game2 = { ...game, id: 202, homeTeam: "School Z", awayTeam: "School W" };
    mocks.getRegularSeasonGames.mockResolvedValue([game2, game]); // deliberately out of id order
    mocks.getWeekPlays.mockResolvedValue([{ id: 1, gameId: 101, offense: "School X" }, { id: 2, gameId: 101, offense: "School Y" }, { id: 3, gameId: 202, offense: "School Z" }]);
    mocks.getLeagueSnapshot.mockResolvedValue({
      owners: [
        { teamName: "Owner A", picks: [{ id: "slot-1", schoolName: "School X", position: "QB" }] },
        { teamName: "Owner B", picks: [{ id: "slot-2", schoolName: "School Y", position: "RB" }] },
        { teamName: "Owner D", picks: [{ id: "slot-4", schoolName: "School Z", position: "QB" }] },
      ],
    });
    mocks.mapLivePlayToCandidates.mockImplementation(({ play }: { play: { offense: string } }) => {
      if (play.offense === "School X") return [{ sourceEventKey: "1:qb", sourceGameId: 101, schoolName: "School X", position: "QB", eventType: "TOUCHDOWN", statValue: 1, yardDistance: 10, note: "" }];
      if (play.offense === "School Z") return [{ sourceEventKey: "3:qb", sourceGameId: 202, schoolName: "School Z", position: "QB", eventType: "TOUCHDOWN", statValue: 1, yardDistance: 10, note: "" }];
      return [];
    });
    const eventsTable = fakeScoringEventsTable([
      { computed_points: 9, week_id: "week-2-id", draft_slot_id: "slot-1" },
      { computed_points: 3, week_id: "week-2-id", draft_slot_id: "slot-4" }, // School Z QB stale: official 9, stored 3
    ]);
    mocks.supabaseRest.mockImplementation(async (table: string, options: { query?: Record<string, string> } = {}) => {
      if (table === "b36_automation_config") return [{ season: 2026 }];
      if (table === "b36_scoring_weeks") return [{ id: "week-2-id" }];
      if (table === "b36_scoring_events") return eventsTable(options.query);
      return [];
    });
    const caller = appRouter.createCaller(adminContext());

    const page1 = await caller.league.admin.fullScoringAudit({ week: 2, offset: 0, limit: 1 });
    expect(page1.gamesTotal).toBe(2);
    expect(page1.gamesChecked).toBe(1);
    expect(page1.gameTeamNames.map(g => g.gameId)).toEqual([101]); // lowest id first, regardless of schedule order
    expect(page1.checkedSlots).toBe(2); // slot-1 and slot-2 only
    expect(page1.nextOffset).toBe(1);
    // School X QB: official 9 vs stored 9. School Y RB: no candidates and no rows, 0 vs 0. Clean page.
    expect(page1.mismatches).toEqual([]);

    const page2 = await caller.league.admin.fullScoringAudit({ week: 2, offset: page1.nextOffset!, limit: 1 });
    expect(page2.gameTeamNames.map(g => g.gameId)).toEqual([202]);
    expect(page2.checkedSlots).toBe(1); // slot-4 only
    expect(page2.nextOffset).toBeNull();
    expect(page2.mismatches).toEqual([expect.objectContaining({ owner: "Owner D", school: "School Z", position: "QB", officialPoints: 9, storedPoints: 3, difference: 6 })]);
  });

  it("falls back to a slot's full (all-weeks) history when the requested week's row doesn't exist yet, matching the original per-slot fallback", async () => {
    const eventsTable = fakeScoringEventsTable([{ computed_points: 9, week_id: "some-other-week", draft_slot_id: "slot-1" }]);
    mocks.supabaseRest.mockImplementation(async (table: string, options: { query?: Record<string, string> } = {}) => {
      if (table === "b36_automation_config") return [{ season: 2026 }];
      if (table === "b36_scoring_weeks") return []; // no row for this week yet
      if (table === "b36_scoring_events") return eventsTable(options.query);
      return [];
    });
    const caller = appRouter.createCaller(adminContext());
    const result = await caller.league.admin.fullScoringAudit({ week: 2 });
    // slot-1 (QB): official 9, stored 9 (from the fallback all-weeks fetch, since no week_id filter
    // could be applied) -> no mismatch, same as the original behavior.
    expect(result.mismatches.find((m: { position: string }) => m.position === "QB")).toBeUndefined();
  });
});
