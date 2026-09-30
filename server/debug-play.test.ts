import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getWeekPlays: vi.fn(), getWeekPlayStats: vi.fn(), getRoster: vi.fn(), getLeagueSnapshot: vi.fn(), supabaseRest: vi.fn() }));
vi.mock("./cfbd", () => ({ getWeekPlays: mocks.getWeekPlays, getWeekPlayStats: mocks.getWeekPlayStats, getRoster: mocks.getRoster, getRegularSeasonGames: vi.fn(), getLiveScoreboard: vi.fn(), getLivePlays: vi.fn(), getFbsTeams: vi.fn(), getGamePlayerStats: vi.fn() }));
vi.mock("./league-data", () => ({ getLeagueSnapshot: mocks.getLeagueSnapshot, getScoringRulesForEvent: vi.fn() }));
vi.mock("./supabase", () => ({ supabaseRest: mocks.supabaseRest, supabaseRestAll: mocks.supabaseRest, supabaseRpc: vi.fn(), q: { eq: (value: unknown) => `eq.${value}` } }));

import { appRouter } from "./routers";

const adminContext = () => ({ req: { headers: {}, cookies: {} }, res: { setHeader: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn() }, user: { openId: "commish", role: "admin", isAdmin: true, name: "Commissioner" } }) as never;

// Real week-4 play: Oregon TE was credited a 12-point touchdown the NCAA book gives to nobody at
// TE (D.Moore is a WR). The endpoint has to show WHY: which roster names the text matched and what
// position each resolves to, next to the candidates the scorer produces.
const moorePlay = { id: 401858469677, gameId: 401858469, offense: "Oregon", defense: "USC", scoring: true, scoringTeam: "Oregon", yardsToGoal: 29, playType: "Passing Touchdown", playText: "(08:42) Shotgun #8 D.Raiola pass complete deep left to #1 D.Moore caught at USC00, for 29 yards to the USC00 TOUCHDOWN, clock 08:35, 1ST DOWN #97 G.Hurych kick attempt good" };

describe("league.admin.debugPlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabaseRest.mockResolvedValue([{ season: 2026 }]);
    mocks.getWeekPlays.mockResolvedValue([moorePlay]);
    // No stat rows for this play (CFBD's /plays/stats often lags /plays); one unrelated row proves the filter.
    mocks.getWeekPlayStats.mockResolvedValue([{ playId: 1, athleteId: 99, team: "Oregon", statType: "Sack", stat: 1 }]);
    mocks.getRoster.mockImplementation(async (team: string) => team === "Oregon"
      ? [{ id: 8, firstName: "Dante", lastName: "Moore", position: "QB" }, { id: 11, firstName: "Dakorien", lastName: "Moore", position: "WR" }, { id: 12, firstName: "Daniel", lastName: "Moore", position: "TE" }]
      : [{ id: 50, firstName: "Some", lastName: "Trojan", position: "LB" }]);
    mocks.getLeagueSnapshot.mockResolvedValue({ weeks: [], owners: [{ teamName: "Faber College", picks: [{ id: "slot-ore-te", schoolName: "Oregon", position: "TE" }, { id: "slot-x", schoolName: "Texas", position: "QB" }] }] });
  });

  it("returns the raw play, only its own stat rows, both rosters' name matches with positions, and the candidates for the league's real slots", async () => {
    const result = await appRouter.createCaller(adminContext()).league.admin.debugPlay({ week: 5, playId: "401858469677" });
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.play).toEqual(moorePlay);
    expect(result.playStats).toEqual([]);
    // Three Moores match "d moore" by initial. With no stat row to break the tie, the text path
    // credits every position that matched, which is how a WR's catch lands on the TE slot.
    expect(result.rosterMentions.Oregon.map(athlete => `${athlete.firstName} ${athlete.lastName}:${athlete.scoringPosition}`)).toEqual(["Dante Moore:QB", "Dakorien Moore:WR", "Daniel Moore:TE"]);
    expect(result.rosterMentions.USC).toEqual([]);
    expect(result.draftedOnThisPlay).toEqual([{ schoolName: "Oregon", position: "TE" }]);
    expect(result.candidates.map(candidate => `${candidate.schoolName}:${candidate.position}:${candidate.eventType}`)).toContain("Oregon:TE:TOUCHDOWN");
    expect(result.candidatesIfEverythingDrafted.map(candidate => `${candidate.position}:${candidate.eventType}`).sort()).toEqual(expect.arrayContaining(["WR:TOUCHDOWN", "TE:TOUCHDOWN"]));
    expect(result.fumbleRecovery).toBeNull();
    // Once the Reception stat row is there the scorer resolves the catch to the WR and the TE credit disappears.
    mocks.getWeekPlayStats.mockResolvedValue([{ playId: 401858469677, athleteId: 11, athleteName: "Dakorien Moore", team: "Oregon", statType: "Reception", stat: 1 }]);
    const withStats = await appRouter.createCaller(adminContext()).league.admin.debugPlay({ week: 5, playId: "401858469677" });
    expect(withStats.found && withStats.candidates.some(candidate => candidate.position === "TE")).toBe(false);
  });

  it("looks a live 9-prefixed id up by its official id, narrows by gameId, and says so when the play is not in the final feed", async () => {
    const caller = appRouter.createCaller(adminContext());
    const viaLiveId = await caller.league.admin.debugPlay({ week: 5, playId: 9401858469677 });
    expect(viaLiveId.found).toBe(true);
    const wrongGame = await caller.league.admin.debugPlay({ week: 5, playId: 401858469677, gameId: 1 });
    expect(wrongGame).toMatchObject({ found: false, playsInWeek: 1 });
    expect((wrongGame as { hint?: string }).hint).toMatch(/No play with that id/);
  });
});

describe("jersey-number tie-break for teammates sharing a surname and initial", () => {
  it("credits only the WR when the text says '#1 D.Moore' and the roster carries jerseys; without jerseys the old every-match behavior stands", async () => {
    const { mapLivePlayToCandidates } = await import("./live-scoring");
    const all = (["QB", "RB", "WR", "TE", "K", "DST"] as const).map(position => ({ schoolName: "Oregon", position }));
    const withJerseys = [{ id: 7, firstName: "Dante", lastName: "Raiola", position: "QB", jersey: 8 }, { id: 8, firstName: "Dante", lastName: "Moore", position: "QB", jersey: 5 }, { id: 11, firstName: "Dakorien", lastName: "Moore", position: "WR", jersey: 1 }, { id: 12, firstName: "Daniel", lastName: "Moore", position: "TE", jersey: 44 }];
    const scored = (roster: typeof withJerseys) => mapLivePlayToCandidates({ play: moorePlay, stats: [], roster, selectedSchoolPositions: all }).filter(candidate => candidate.eventType === "TOUCHDOWN").map(candidate => candidate.position).sort();
    expect(scored(withJerseys)).toEqual(["QB", "WR"]);
    expect(scored(withJerseys.map(({ jersey: _jersey, ...athlete }) => athlete) as typeof withJerseys)).toEqual(["QB", "TE", "WR"]);
  });
});
