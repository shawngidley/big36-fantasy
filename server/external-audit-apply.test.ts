import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({ getRegularSeasonGames: vi.fn(), getLeagueSnapshot: vi.fn(), supabaseRest: vi.fn() }));

vi.mock("./cfbd", () => ({ getRegularSeasonGames: mocks.getRegularSeasonGames, getWeekPlays: vi.fn(), getWeekPlayStats: vi.fn(), getRoster: vi.fn(), getLiveScoreboard: vi.fn(), getLivePlays: vi.fn(), getFbsTeams: vi.fn(), getGamePlayerStats: vi.fn() }));
vi.mock("./league-data", () => ({ getLeagueSnapshot: mocks.getLeagueSnapshot, getScoringRulesForEvent: vi.fn() }));
vi.mock("./supabase", () => ({
  q: { eq: (value: unknown) => `eq.${String(value)}`, isNull: "is.null" },
  supabaseRest: mocks.supabaseRest,
  supabaseRestAll: async (table: string, options: { query?: Record<string, string> } = {}) => mocks.supabaseRest(table, options),
  supabaseRpc: vi.fn(),
}));

import { appRouter } from "./routers";

function adminContext(): TrpcContext {
  return { user: { id: 1, openId: "commish", name: "Admin", email: "a@example.com", loginMethod: "email", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"] };
}

// A two-group excerpt in the real report's exact layout: one mismatch with a how block, one match.
const reportText = `36football — Week 2 audit

36Football data pulled 2026-09-20 00:27 (saved as site_snapshots/week_2.json)

MISMATCHES
----------

Group                  Owner                                 NCAA Audit  36Football  Diff  How (NCAA Audit)
---------------------  ------------------------------------  ----------  ----------  ----  ----------------------------------------
Georgia - DST          University of Bad Decisions                   35          53   -18  Fumble recovery (Boyd) (3)
                                                                                           Sack (Harris Jr.) (1)

MATCHES
-------

Group                   Owner                                 NCAA Audit  36Football
----------------------  ------------------------------------  ----------  ----------  -----
Hawai'i - K             Marcus College                                23          23  MATCH
`;

// The endpoint reads the schedule from the synced b36_source_games table, never from CFBD - so the
// audit can be applied while the CFBD account is over quota (which is exactly when it is needed most).
const sourceGameRow = { cfbd_game_id: 401858200, week_number: 2, start_date: "2026-09-12T19:00:00Z", home_team: "Georgia", away_team: "Austin Peay" };

describe("league.admin.applyExternalAudit", () => {
  let events: Array<{ id: string; draft_slot_id: string; week_id: string; computed_points: number }>;
  let writes: Array<Record<string, unknown>>;
  let weekPatches: Array<{ query?: Record<string, string>; body?: Record<string, unknown> }>;
  beforeEach(() => {
    vi.clearAllMocks();
    writes = [];
    weekPatches = [];
    mocks.getRegularSeasonGames.mockRejectedValue(new Error("Monthly call quota exceeded.")); // CFBD is down; the endpoint must not care
    mocks.getLeagueSnapshot.mockResolvedValue({
      weeks: [{ id: "week-2-id", weekNumber: 2, label: "Week 2", status: "OPEN" }],
      owners: [
        { teamName: "University of Bad Decisions", picks: [{ id: "slot-ga-dst", schoolName: "Georgia", position: "DST" }] },
        { teamName: "Marcus College", picks: [{ id: "slot-haw-k", schoolName: "Hawai'i", position: "K" }] },
      ],
    });
    // Site currently has Georgia DST at 53 (as two rows) and Hawai'i K at 23.
    events = [
      { id: "e1", draft_slot_id: "slot-ga-dst", week_id: "week-2-id", computed_points: 50 },
      { id: "e2", draft_slot_id: "slot-ga-dst", week_id: "week-2-id", computed_points: 3 },
      { id: "e3", draft_slot_id: "slot-haw-k", week_id: "week-2-id", computed_points: 23 },
    ];
    mocks.supabaseRest.mockImplementation(async (table: string, options: { method?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {}) => {
      if (table === "b36_automation_config") return [{ season: 2026 }];
      if (table === "b36_source_games") return [sourceGameRow];
      if (table === "b36_scoring_weeks" && options.method === "PATCH") { weekPatches.push({ query: options.query, body: options.body }); return []; }
      if (table === "b36_scoring_weeks" && options.query?.week_number === "eq.4") return [{ id: "week-4-id", status: "OPEN" }];
      if (table === "b36_scoring_weeks") return [];
      if (table === "b36_scoring_events" && options.method === "POST") {
        writes.push(options.body!);
        events.push({ id: `w${writes.length}`, draft_slot_id: options.body!.draft_slot_id as string, week_id: options.body!.week_id as string, computed_points: options.body!.computed_points as number });
        return [];
      }
      if (table === "b36_scoring_events") {
        const q = options.query ?? {};
        const ids = (q.draft_slot_id ?? "").replace(/^in\.\(|\)$/g, "").split(",");
        return events.filter(event => ids.includes(event.draft_slot_id) && (!q.week_id || event.week_id === q.week_id.replace(/^eq\./, "")));
      }
      return [];
    });
  });

  it("dry run reports the plan with the report's own counts and writes nothing", async () => {
    const result = await appRouter.createCaller(adminContext()).league.admin.applyExternalAudit({ week: 2, reportText });
    expect(result).toMatchObject({ dryRun: true, groupsInReport: 2, matches: 1, wouldAdjust: 1, adjusted: 0, errors: 0, unknownGroups: 0, netPointChange: -18, pulledAt: "2026-09-20 00:27" });
    expect(result.results.find(row => row.school === "Georgia")).toMatchObject({ currentPoints: 53, expectedPoints: 35, delta: -18, status: "would-adjust" });
    expect(writes).toHaveLength(0);
    expect(weekPatches).toHaveLength(0);
    expect(result.weekLocked).toBe(false);
  });

  // Weeks 2 and 3 drifted back toward CFBD in the hours between applying the audit and the manual
  // SQL lock, on exactly the plays the audit had corrected. The apply itself must lock the week.
  it("a successful apply marks the week FINAL in the same call; a dry run or an apply with write errors does not", async () => {
    const caller = appRouter.createCaller(adminContext());
    const applied = await caller.league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    expect(applied).toMatchObject({ adjusted: 1, errors: 0, weekLocked: true, weekStatus: "FINAL" });
    expect(weekPatches).toEqual([{ query: { id: "eq.week-2-id" }, body: { status: "FINAL" } }]);
    const lockAudit = writes.length; // scoring-event writes only; the LOCK_WEEK audit row goes to b36_audit_events
    expect(lockAudit).toBe(1);

    weekPatches = [];
    const failingImpl = mocks.supabaseRest.getMockImplementation()!;
    mocks.supabaseRest.mockImplementation(async (table: string, options = {}) => {
      if (table === "b36_scoring_events" && (options as { method?: string }).method === "POST") throw new Error("insert failed");
      return failingImpl(table, options as never);
    });
    events = events.slice(0, 3);
    const errored = await caller.league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    expect(errored).toMatchObject({ errors: 1, weekLocked: false, weekStatus: "OPEN" });
    expect(weekPatches).toHaveLength(0);
  });

  it("does not re-lock a week that is already FINAL", async () => {
    mocks.getLeagueSnapshot.mockResolvedValue({ weeks: [{ id: "week-2-id", weekNumber: 2, label: "Week 2", status: "FINAL" }], owners: [{ teamName: "University of Bad Decisions", picks: [{ id: "slot-ga-dst", schoolName: "Georgia", position: "DST" }] }, { teamName: "Marcus College", picks: [{ id: "slot-haw-k", schoolName: "Hawai'i", position: "K" }] }] });
    const result = await appRouter.createCaller(adminContext()).league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    expect(result).toMatchObject({ adjusted: 1, weekLocked: false, weekStatus: "FINAL" });
    expect(weekPatches).toHaveLength(0);
  });

  it("apply writes one official NCAA_AUDIT_ADJUSTMENT row per mismatch, tied to the game, with the how lines as the note", async () => {
    const result = await appRouter.createCaller(adminContext()).league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    expect(result).toMatchObject({ adjusted: 1, matches: 1, errors: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ week_id: "week-2-id", draft_slot_id: "slot-ga-dst", event_type: "NCAA_AUDIT_ADJUSTMENT", computed_points: -18, audit_action: "ENTRY", is_provisional: false, source_game_id: 401858200, recorded_by_open_id: "commish", source_event_key: "ncaa-audit:2:slot-ga-dst:53->35" });
    expect(writes[0].note).toContain("site 53 -> NCAA 35");
    expect(writes[0].note).toContain("Fumble recovery (Boyd) (3); Sack (Harris Jr.) (1)");
  });

  it("re-running the same report after applying is a no-op", async () => {
    const caller = appRouter.createCaller(adminContext());
    await caller.league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    const again = await caller.league.admin.applyExternalAudit({ week: 2, reportText, dryRun: false });
    expect(again).toMatchObject({ matches: 2, adjusted: 0, wouldAdjust: 0 });
    expect(writes).toHaveLength(1);
  });

  it("refuses a week the league has no scoring row for, and flags report groups nobody drafted", async () => {
    const caller = appRouter.createCaller(adminContext());
    await expect(caller.league.admin.applyExternalAudit({ week: 9, reportText })).rejects.toThrow(/No scoring week row/);
    mocks.getLeagueSnapshot.mockResolvedValue({ weeks: [{ id: "week-2-id", weekNumber: 2, label: "Week 2", status: "OPEN" }], owners: [] });
    const result = await caller.league.admin.applyExternalAudit({ week: 2, reportText });
    expect(result).toMatchObject({ unknownGroups: 2, wouldAdjust: 0 });
  });

  it("setWeekStatus locks or reopens an existing week and refuses an unknown one", async () => {
    const caller = appRouter.createCaller(adminContext());
    await expect(caller.league.admin.setWeekStatus({ weekNumber: 4, status: "FINAL" })).resolves.toMatchObject({ success: true, weekNumber: 4, status: "FINAL", rowsUpdated: 1 });
    expect(weekPatches).toEqual([{ query: { id: "eq.week-4-id" }, body: { status: "FINAL" } }]);
    await expect(caller.league.admin.setWeekStatus({ weekNumber: 9, status: "FINAL" })).rejects.toThrow(/No scoring week row for week 9/);
  });

  it("createWeek refuses to insert a second row for a week that already exists", async () => {
    const caller = appRouter.createCaller(adminContext());
    await expect(caller.league.admin.createWeek({ weekNumber: 4, label: "Week 4", status: "OPEN" })).rejects.toThrow(/Week 4 already exists/);
    await expect(caller.league.admin.createWeek({ weekNumber: 9, label: "Week 9" })).resolves.toMatchObject({ success: true });
  });
});
