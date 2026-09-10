import { describe, expect, it } from "vitest";
import { eligibleGameIdsForSchool, finalShutoutCandidates, gameCountsForSchool, hasMadePat, isSupersededInterceptionPlay, mapLivePlayToCandidates, specialTeamsTouchdownType } from "./live-scoring";

describe("36 Football automatic scoring map", () => {
  const games = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, season: 2026, week: index + 1, seasonType: "regular", startDate: `2026-0${Math.min(index + 8, 9)}-${String(index + 1).padStart(2, "0")}T17:00:00Z`, completed: true, homeTeam: "Ohio State", awayTeam: "Opponent" }));
  it("caps each school at its first 12 eligible regular-season games", () => {
    expect(eligibleGameIdsForSchool(games, "Ohio State")).toHaveLength(12);
    expect(gameCountsForSchool(games, "Ohio State", 12)).toBe(true);
    expect(gameCountsForSchool(games, "Ohio State", 13)).toBe(false);
  });

  it("matches a school regardless of case - CFBD's schedule spells it 'UTSA', a drafted slot spelled it 'Utsa' and silently never matched any of its games", () => {
    const utsaGames = [{ id: 1, season: 2026, week: 1, seasonType: "regular", startDate: "2026-08-30T17:00:00Z", completed: true, homeTeam: "UTSA", awayTeam: "Colorado State" }];
    expect(eligibleGameIdsForSchool(utsaGames, "Utsa")).toEqual([1]);
    expect(gameCountsForSchool(utsaGames, "Utsa", 1)).toBe(true);
  });
  it("excludes a reversed interception placeholder when the same drive immediately continues for the offense", () => {
    const interception = { id: 90, gameId: 9, driveId: "drive-4", playNumber: 7, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Interception", period: 4, clock: { minutes: 10, seconds: 36 } };
    const continuation = { id: 91, gameId: 9, driveId: "drive-4", playNumber: 8, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Rush", period: 4, clock: { minutes: 10, seconds: 36 } };
    expect(isSupersededInterceptionPlay(interception, continuation)).toBe(true);
    expect(isSupersededInterceptionPlay(interception, { ...continuation, offense: "Opponent" })).toBe(false);
  });
  it("credits both QB and receiver on a passing touchdown using snap yardline-to-goal", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 55, gameId: 9, offense: "Ohio State", defense: "Opponent", yardsToGoal: 31, scoring: true }, stats: [{ playId: 55, athleteId: 1, team: "Ohio State", statType: "Passing Touchdown", stat: 1 }, { playId: 55, athleteId: 2, team: "Ohio State", statType: "Reception", stat: 1 }], roster: [{ id: 1, position: "QB" }, { id: 2, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }] });
    expect(candidates.map(candidate => `${candidate.position}:${candidate.eventType}:${candidate.yardDistance}`)).toEqual(expect.arrayContaining(["QB:TOUCHDOWN:31", "WR:TOUCHDOWN:31"]));
  });
  it("resolves abbreviated official play text when player-stat rows are unavailable", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 551, gameId: 9, offense: "Ohio State", defense: "Opponent", yardsToGoal: 16, scoring: true, playType: "Passing Touchdown", playText: "A. Manning pass complete to R. Wingo for a touchdown" }, stats: [], roster: [{ id: 1, firstName: "Arch", lastName: "Manning", position: "QB" }, { id: 2, firstName: "Ryan", lastName: "Wingo", position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }] });
    expect(candidates.filter(candidate => candidate.eventType === "TOUCHDOWN").map(candidate => candidate.position).sort()).toEqual(["QB", "WR"]);
  });
  it("resolves an abbreviated quarterback passer on an interception when the official player-stat row is unavailable", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 552, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Pass Interception Return", playText: "A. Manning pass intercepted by Defender" }, stats: [], roster: [{ id: 1, firstName: "Arch", lastName: "Manning", position: "QB" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }] });
    expect(candidates).toEqual([expect.objectContaining({ position: "QB", eventType: "INTERCEPTION_THROWN", sourceEventKey: "552:INTERCEPTION_THROWN:QB" })]);
  });
  it("credits the intercepting defense's DEF unit from play text alone when no player-stat rows are available yet (live games)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 553, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Pass Interception Return", playText: "A. Manning pass intercepted by Defender, returned 12 yards" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Opponent", position: "DST", eventType: "DEFENSIVE_TURNOVER", sourceEventKey: "553:DEFENSIVE_TURNOVER:unit" })]);
  });
  it("credits a sack to the defense's DEF unit from play text alone when no player-stat rows are available yet", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 554, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Sack", playText: "A. Manning sacked for a loss of 7 yards" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Opponent", position: "DST", eventType: "SACK", sourceEventKey: "554:SACK:unit" })]);
  });
  it("credits a fumble recovery to the defense's DEF unit from playType alone, even with no matching player-stat row (the exact real play that was missed for UNLV)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 401862693353, gameId: 401862693, offense: "Memphis", defense: "UNLV", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "pass complete short right ... fumbled by #1 T.Chapman ... recovered by UNLV #2 D.Harris ..." }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "UNLV", position: "DST" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "UNLV", position: "DST", eventType: "DEFENSIVE_TURNOVER", sourceEventKey: "401862693353:DEFENSIVE_TURNOVER:playtype" })]);
  });
  it("credits exactly one defensive turnover for a fumble recovery, via the playType fallback (the only real path - 'Fumble Recovery' isn't an actual CFBD stat category for defensive players)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 556, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "fumbled, recovered by #4 Defender" }, stats: [], roster: [{ id: 4, position: "DST" }], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates.filter(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")).toHaveLength(1);
    expect(candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")?.sourceEventKey).toBe("556:DEFENSIVE_TURNOVER:playtype");
  });
  it("does not double-credit a defensive turnover from text when official player-stat rows are already present", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 555, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Pass Interception Return", playText: "A. Manning pass intercepted by #4 Defender" }, stats: [{ playId: 555, athleteId: 9, team: "Opponent", statType: "Interception", stat: 1 }], roster: [{ id: 9, position: "DST" }], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates.filter(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")).toHaveLength(1);
    expect(candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")?.sourceEventKey).toBe("555:DEFENSIVE_TURNOVER:9");
  });
  it("recognizes alternative pass-from wording while excluding interception returns and nullified touchdowns", () => {
    const roster = [{ id: 1, firstName: "Sawyer", lastName: "Robertson", position: "QB" }, { id: 2, firstName: "Kobe", lastName: "Prentice", position: "WR" }];
    const selectedSchoolPositions = [{ schoolName: "Baylor", position: "QB" as const }, { schoolName: "Baylor", position: "WR" as const }];
    const passFrom = mapLivePlayToCandidates({ play: { id: 553, gameId: 9, offense: "Baylor", defense: "Opponent", yardsToGoal: 18, scoring: false, playType: "Passing Touchdown", playText: "K. Prentice 18 Yd pass from S. Robertson" }, stats: [], roster, selectedSchoolPositions });
    const interceptionReturn = mapLivePlayToCandidates({ play: { id: 554, gameId: 9, offense: "Baylor", defense: "Opponent", yardsToGoal: 18, scoring: true, playType: "Interception Return Touchdown", playText: "S. Robertson pass intercepted and returned for a touchdown" }, stats: [], roster, selectedSchoolPositions });
    const nullified = mapLivePlayToCandidates({ play: { id: 555, gameId: 9, offense: "Baylor", defense: "Opponent", yardsToGoal: 3, scoring: true, playType: "Penalty", playText: "S. Robertson rush for a touchdown nullified by penalty. NO PLAY" }, stats: [], roster, selectedSchoolPositions });
    expect(passFrom.filter(candidate => candidate.eventType === "TOUCHDOWN").map(candidate => candidate.position).sort()).toEqual(["QB", "WR"]);
    expect(interceptionReturn.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "QB")).toBe(false);
    expect(nullified.some(candidate => candidate.eventType === "TOUCHDOWN")).toBe(false);
  });
  it("does not nullify a real touchdown just because a LATER, separate PAT retry in the same concatenated CFBD text blob was penalized - real Georgia/Tennessee State play that was missing a passing TD credit because of this", () => {
    const roster = [{ id: 1, firstName: "Ryan", lastName: "Montgomery", position: "QB" }, { id: 2, firstName: "Josh", lastName: "Bell", position: "WR" }];
    const selectedSchoolPositions = [{ schoolName: "Georgia", position: "QB" as const }];
    const play = { id: 401856658576, gameId: 401856658, offense: "Georgia", defense: "Tennessee State", scoring: true, playType: "Passing Touchdown", playText: "(13:41) No Huddle-Shotgun #15 R.Montgomery pass complete deep middle to #11 J.Bell caught at TSU17, for 54 yards to the TSU00 TOUCHDOWN, clock 13:38, 1ST DOWN #99 H.Zureikat kick attempt good (H: #12 R.Puglisi, LS: #51 W.Snellings) PENALTY #99 H.Zureikat kick attempt good (H: #12 R.Puglisi, LS: #51 W.Snellings) PENALTY UGA Illegal Snap (#51 W.Snellings) 5 yards from TSU03 to TSU08. NO PLAY" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions });
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "QB")).toBe(true);
  });

  it("creates one touchdown per credited position when CFBD reports both reception and touchdown stats", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 56, gameId: 9, offense: "Ohio State", defense: "Opponent", yardsToGoal: 12, scoring: true, playType: "Passing Touchdown" }, stats: [{ playId: 56, athleteId: 1, team: "Ohio State", statType: "Completion", stat: 12 }, { playId: 56, athleteId: 1, team: "Ohio State", statType: "Touchdown", stat: 1 }, { playId: 56, athleteId: 2, team: "Ohio State", statType: "Reception", stat: 12 }, { playId: 56, athleteId: 2, team: "Ohio State", statType: "Touchdown", stat: 1 }], roster: [{ id: 1, position: "QB" }, { id: 2, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }] });
    expect(candidates.filter(candidate => candidate.eventType === "TOUCHDOWN").map(candidate => candidate.position).sort()).toEqual(["QB", "WR"]);
  });
  it("credits successful passing and rushing two-point conversions from canonical play types", () => {
    const passing = mapLivePlayToCandidates({ play: { id: 57, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Two Point Pass", playText: "Quinn Ewers pass to Emeka Egbuka for Two-Point Conversion" }, stats: [], roster: [{ id: 1, firstName: "Quinn", lastName: "Ewers", position: "QB" }, { id: 2, firstName: "Emeka", lastName: "Egbuka", position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }] });
    const rushing = mapLivePlayToCandidates({ play: { id: 58, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Two Point Rush", playText: "Quinshon Judkins run for Two-Point Conversion" }, stats: [], roster: [{ id: 3, firstName: "Quinshon", lastName: "Judkins", position: "RB" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "RB" }] });
    expect(passing.filter(candidate => candidate.eventType === "TWO_POINT_CONVERSION").map(candidate => candidate.position).sort()).toEqual(["QB", "WR"]);
    expect(rushing.filter(candidate => candidate.eventType === "TWO_POINT_CONVERSION").map(candidate => candidate.position)).toEqual(["RB"]);
  });
  it("credits a two-point conversion run in by a WR even when CFBD gives the play a generic playType (just 'Rush') and only mentions the conversion in the play text - the real bug reported tonight", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 59, gameId: 9, offense: "Hawai'i", defense: "Opponent", scoring: false, playType: "Rush", playText: "#17 K.Dixon-Wyatt rush for 2 yards, TWO-POINT CONVERSION ATTEMPT SUCCEEDS" }, stats: [], roster: [{ id: 5, firstName: "K", lastName: "Dixon-Wyatt", position: "WR" }], selectedSchoolPositions: [{ schoolName: "Hawai'i", position: "WR" }] });
    expect(candidates).toEqual([expect.objectContaining({ position: "WR", eventType: "TWO_POINT_CONVERSION" })]);
  });
  it("does not credit a failed two-point conversion attempt", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 60, gameId: 9, offense: "Hawai'i", defense: "Opponent", scoring: false, playType: "Rush", playText: "rush for no gain, TWO-POINT CONVERSION ATTEMPT FAILS" }, stats: [], roster: [{ id: 5, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Hawai'i", position: "WR" }] });
    expect(candidates.filter(candidate => candidate.eventType === "TWO_POINT_CONVERSION")).toHaveLength(0);
  });
  it("penalizes the fumbling offensive position from playType alone when no player-stat row is available yet ('(Opponent)' unambiguously means the offense lost it)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 61, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "T.Smith rush for 3 yards, fumbled, recovered by Opponent" }, stats: [], roster: [{ id: 5, firstName: "T", lastName: "Smith", position: "RB" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "RB" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Ohio State", position: "RB", eventType: "FUMBLE_LOST" })]);
  });
  it("credits a fumble loss using the real CFBD stat category 'Fumble' cross-referenced with the play's own playType to confirm it went to the opponent (the actual fix for the stats-based path being completely non-functional all season)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 401856766648, gameId: 9, offense: "TCU", defense: "North Carolina", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "Jaden Craig sacked, fumbled, recovered by North Carolina" }, stats: [{ playId: 401856766648, athleteId: 5083569, athleteName: "Jaden Craig", team: "TCU", statType: "Fumble", stat: 1 }], roster: [{ id: 5083569, firstName: "Jaden", lastName: "Craig", position: "QB" }], selectedSchoolPositions: [{ schoolName: "TCU", position: "QB" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "TCU", position: "QB", eventType: "FUMBLE_LOST" })]);
  });
  it("does NOT credit a fumble loss from a bare 'Fumble' stat alone when the play itself shows it was recovered by the fumbling team's own side", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 999, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Fumble Recovery (Own)", playText: "fumbled, recovered by Ohio State's own player" }, stats: [{ playId: 999, athleteId: 5, team: "Ohio State", statType: "Fumble", stat: 1 }], roster: [{ id: 5, position: "RB" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "RB" }] });
    expect(candidates.filter(candidate => candidate.eventType === "FUMBLE_LOST")).toHaveLength(0);
  });
  it("does not double-credit a fumble loss between the stats loop and the playType fallback", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 62, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "fumbled by #5, recovered by Opponent" }, stats: [{ playId: 62, athleteId: 5, team: "Ohio State", statType: "Fumble", stat: 1 }], roster: [{ id: 5, position: "RB" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "RB" }] });
    expect(candidates.filter(candidate => candidate.eventType === "FUMBLE_LOST")).toHaveLength(1);
  });
  it("credits a pick-six (interception return touchdown) to the DEF unit from playType alone, live, with no player stats yet", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 63, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Interception Return Touchdown", playText: "pass intercepted by #4, returned 55 yards for a TOUCHDOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Opponent")).toBe(true);
  });
  it("credits a fumble-return touchdown to the DEF unit from playType alone, live", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 64, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Fumble Recovery (Opponent)", playText: "fumbled, recovered by #7, returned 40 yards for a TOUCHDOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Opponent")).toBe(true);
  });
  it("penalizes the offense for a fumble lost even when CFBD's playType is 'Fumble Return Touchdown' rather than 'Fumble Recovery (Opponent)' - the real Hawai'i play that was missed", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 65, gameId: 9, offense: "Hawai'i", defense: "Stanford", scoring: true, playType: "Fumble Return Touchdown", playText: "Tevarua Tafiti 31 Yd Fumble Return (Emmet Kenney Kick)" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Hawai'i", position: "QB" }, { schoolName: "Stanford", position: "DST" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Stanford")).toBe(true);
  });
  it("does NOT credit the defense with a turnover when a team recovers its OWN fumble ('Fumble Recovery (Own)') - a critical bug found tonight where the generic 'fumble recovery' text match would have wrongly credited a turnover that never happened", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 66, gameId: 9, offense: "Hawai'i", defense: "Stanford", scoring: false, playType: "Fumble Recovery (Own)", playText: "pass complete for 10 yards, fumbled, recovered by Hawai'i's own player, 1ST DOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Stanford", position: "DST" }] });
    expect(candidates.filter(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")).toHaveLength(0);
    expect(candidates.filter(candidate => candidate.eventType === "FUMBLE_LOST")).toHaveLength(0);
  });
  it("credits special-teams blocks and safeties to DST while preserving defensive safeties for DST", () => {
    const blockedPunt = mapLivePlayToCandidates({ play: { id: 71, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Blocked Punt", playText: "Punt blocked by Opponent" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    const defensiveSafety = mapLivePlayToCandidates({ play: { id: 72, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playText: "Quarterback tackled in end zone for safety" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    expect(blockedPunt.map(candidate => candidate.eventType)).toContain("BLOCKED_PUNT");
    expect(defensiveSafety.map(candidate => candidate.eventType)).toContain("DEFENSIVE_SAFETY");
    expect(defensiveSafety.find(candidate => candidate.eventType === "DEFENSIVE_SAFETY")?.position).toBe("DST");
  });
  it("adds a final-game shutout only for the selected defense that held its opponent scoreless", () => {
    const candidates = finalShutoutCandidates({ game: { id: 81, season: 2026, week: 1, seasonType: "regular", startDate: "2026-08-29T17:00:00Z", completed: true, homeTeam: "Ohio State", awayTeam: "Opponent", homePoints: 24, awayPoints: 0 }, selectedSchoolPositions: [{ schoolName: "Ohio State", position: "DST" }, { schoolName: "Opponent", position: "DST" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Ohio State", position: "DST", eventType: "SHUTOUT", sourceEventKey: "81:SHUTOUT:DST:ohio state" })]);
  });
  it("does not treat an ordinary offensive touchdown with its appended PAT as a K/ST touchdown", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 73, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Passing Touchdown", playText: "Quarterback pass complete for a TD (Kicker KICK)" }, stats: [{ playId: 73, athleteId: 1, team: "Ohio State", statType: "Passing Touchdown", stat: 1 }, { playId: 73, athleteId: 2, team: "Ohio State", statType: "Reception", stat: 1 }], roster: [{ id: 1, position: "QB" }, { id: 2, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }, { schoolName: "Ohio State", position: "K" }] });
    expect(candidates.some(candidate => candidate.position === "K" && candidate.eventType.includes("TOUCHDOWN"))).toBe(false);
  });
  it("K/ST rulebook: field-goal distance comes from the text, blocked kicks match CFBD's word order, safeties route by play context and score change, any special-teams TD goes to K/ST", () => {
    const pick = (school: string, position: "K" | "DST") => [{ schoolName: school, position }];
    // Real UNC-TCU play: typed "Safety" on a rush; North Carolina's score moved -> DEF safety for UNC.
    const uncSafety = { id: 401856766331, gameId: 401856766, offense: "TCU", defense: "North Carolina", scoring: true, scoringTeam: "North Carolina", playType: "Safety", playText: "(01:54) No Huddle TCU rush middle for 31 yards loss to the TCU00, End Of Play. North Carolina SAFETY, clock 01:49" };
    expect(mapLivePlayToCandidates({ play: uncSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "DST") }).map(c => c.eventType)).toContain("DEFENSIVE_SAFETY");
    expect(mapLivePlayToCandidates({ play: uncSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "K") }).map(c => c.eventType)).not.toContain("SPECIAL_TEAMS_SAFETY");
    // Same outcome type, but the text says it was a punt -> K/ST safety.
    const puntSafety = { ...uncSafety, id: 2, playType: "Safety", playText: "#47 A.Bacchetta punt, snap out of the end zone for a SAFETY" };
    expect(mapLivePlayToCandidates({ play: puntSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "DST") }).map(c => c.eventType)).toContain("SPECIAL_TEAMS_SAFETY");
    // Field goal distance from the text, not yardsGained.
    const fg = mapLivePlayToCandidates({ play: { id: 3, gameId: 1, offense: "Georgia Tech", defense: "Colorado", scoring: true, playType: "Field Goal Good", yardsGained: 0, playText: "#33 A.Birr field goal attempt from 47 yards GOOD" }, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "K") });
    expect(fg.find(c => c.eventType === "FIELD_GOAL")?.yardDistance).toBe(47);
    // Blocked FG in CFBD's phrasing.
    const blocked = mapLivePlayToCandidates({ play: { id: 4, gameId: 1, offense: "Colorado", defense: "Georgia Tech", scoring: false, playType: "Field Goal Missed", playText: "#38 D.Gerlach field goal attempt from 45 yards BLOCKED by #9 K.Smith" }, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "DST") });
    expect(blocked.map(c => c.eventType)).toContain("BLOCKED_FIELD_GOAL");
    expect(blocked.map(c => c.eventType)).not.toContain("FIELD_GOAL");
    // Muffed punt recovered for a TD is typed as a fumble return; it is a special-teams TD for the scoring team's K/ST, not a DEF touchdown.
    const muff = { id: 5, gameId: 1, offense: "Colorado", defense: "Georgia Tech", scoring: true, scoringTeam: "Georgia Tech", playType: "Fumble Return Touchdown", playText: "#35 D.Greaves punt 46 yards muffed by #4 J.Allen recovered by #22 T.Jones for a TOUCHDOWN" };
    expect(mapLivePlayToCandidates({ play: muff, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "DST") }).map(c => c.eventType)).toContain("OTHER_SPECIAL_TEAMS_TOUCHDOWN");
    expect(mapLivePlayToCandidates({ play: muff, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "DST") }).map(c => c.eventType)).not.toContain("DEFENSIVE_TOUCHDOWN");
  });
  it("matches CFBD's disambiguating first-name abbreviation when two teammates share an initial (Miami's Malachi Toney vs Monroe Toney)", () => {
    const roster = [
      { id: 1, firstName: "Malachi", lastName: "Toney", position: "WR" },
      { id: 2, firstName: "Monroe", lastName: "Toney", position: "DB" },
      { id: 3, firstName: "Darian", lastName: "Mensah", position: "QB" },
    ];
    const play = { id: 401858206117, gameId: 401858206, offense: "Miami", defense: "Stanford", scoring: true, playType: "Passing Touchdown", playText: "D. Mensah pass to Ma. Toney for 23 yds, for a TD (J. Weinberg KICK)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Miami", position: "WR" }, { schoolName: "Miami", position: "QB" }] });
    expect(candidates.map(c => `${c.eventType}:${c.position}`)).toEqual(expect.arrayContaining(["TOUCHDOWN:WR", "TOUCHDOWN:QB"]));
  });

  it("matches a roster player whose lastName carries a generational suffix (Jr./Sr./II/III/IV) against play text that omits it - real UTSA play where three separate receivers (Allen Jr., Wilson Jr., Young Jr.) all failed to match for exactly this reason", () => {
    const roster = [
      { id: 1, firstName: "DJ", lastName: "Allen Jr.", position: "WR" },
      { id: 2, firstName: "Oscar", lastName: "McCown", position: "QB" },
    ];
    const play = { id: 401862700717, gameId: 401862700, offense: "UTSA", defense: "UT Rio Grande Valley", scoring: true, playType: "Passing Touchdown", playText: "(10:50) No Huddle-Shotgun #2 O.McCown pass complete short left to #15 D.Allen caught at UTSA38, for 62 yards to the UTRGV00 TOUCHDOWN, clock 10:41, 1ST DOWN" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "UTSA", position: "WR" }, { schoolName: "UTSA", position: "QB" }] });
    expect(candidates.map(c => `${c.eventType}:${c.position}`)).toEqual(expect.arrayContaining(["TOUCHDOWN:WR", "TOUCHDOWN:QB"]));
  });
  it("recognizes only explicit special-teams touchdown play types and made kicks", () => {
    expect(specialTeamsTouchdownType("Kickoff Return Touchdown")).toBe("KICK_RETURN_TOUCHDOWN");
    expect(specialTeamsTouchdownType("Passing Touchdown")).toBeNull();
    // Ohio State is the KICKING team (offense on the play); the score change says Opponent returned it.
    const kickoffReturn = mapLivePlayToCandidates({ play: { id: 74, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, scoringTeam: "Opponent", playType: "Kickoff Return Touchdown", playText: "Kickoff returned for a touchdown" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DST" }] });
    const fieldGoal = mapLivePlayToCandidates({ play: { id: 75, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", yardsToGoal: 36 }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K" }] });
    expect(kickoffReturn.map(candidate => candidate.eventType)).toContain("KICK_RETURN_TOUCHDOWN");
    expect(kickoffReturn.find(candidate => candidate.eventType === "KICK_RETURN_TOUCHDOWN")?.schoolName).toBe("Opponent");
    expect(fieldGoal.map(candidate => candidate.eventType)).toContain("FIELD_GOAL");
  });
  it("never credits a return touchdown to the kicking team, and falls back to the play's defense when no score signal exists", () => {
    const base = { id: 76, gameId: 9, offense: "Kicking U", defense: "Returning U", scoring: true, playType: "Punt Return Touchdown", playText: "Punt returned 70 yards for a touchdown" };
    const wrongSide = mapLivePlayToCandidates({ play: base, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Kicking U", position: "DST" }] });
    expect(wrongSide.filter(candidate => candidate.eventType === "PUNT_RETURN_TOUCHDOWN")).toHaveLength(0);
    const rightSide = mapLivePlayToCandidates({ play: base, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Returning U", position: "DST" }] });
    expect(rightSide.find(candidate => candidate.eventType === "PUNT_RETURN_TOUCHDOWN")?.schoolName).toBe("Returning U");
  });

  it("credits the PAT following a return touchdown to the team that actually scored, not the kicking team CFBD lists as offense - real Georgia Tech/Colorado play where the PAT was missed entirely for exactly this reason", () => {
    const play = { id: 401856776225, gameId: 401856776, offense: "Colorado", defense: "Georgia Tech", scoring: true, scoringTeam: "Georgia Tech", playType: "Kickoff Return Touchdown", playText: "Rahkeem Smith 100 Yd Kickoff Return (Aidan Birr Kick)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Georgia Tech", position: "K" }, { schoolName: "Colorado", position: "K" }] });
    const pat = candidates.find(candidate => candidate.eventType === "EXTRA_POINT");
    expect(pat?.schoolName).toBe("Georgia Tech");
  });

  it("credits a kickoff-return fumble recovery to the kicking team when they're the one who actually recovers it, not the returning team CFBD lists as defense - real Kennesaw State/West Georgia play where this fumble was missed entirely", () => {
    const play = { id: 401864425190, gameId: 401864425, offense: "Kennesaw State", defense: "West Georgia", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "#89 D.Kinney kickoff 63 yards to the UWG02 #18 S.Ferguson return 12 yards to the UWG14 fumbled by #18 S.Ferguson at UWG14 forced by #18 J.Anglin recovered by KSU #56 Z.Wilson at UWG14, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Kennesaw State", position: "DST" }, { schoolName: "West Georgia", position: "DST" }] });
    const turnover = candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER");
    expect(turnover?.schoolName).toBe("Kennesaw State");
  });

  it("detects a muffed kickoff return as a real turnover even though CFBD's playType is just 'Kickoff' and the text says 'muffed' rather than 'fumble' - real Notre Dame/Wisconsin play that was invisible to the playType-only fumble check", () => {
    const play = { id: 401858438100, gameId: 401858438, offense: "Notre Dame", defense: "Wisconsin", scoring: false, playType: "Kickoff", playText: "(01:31) #18 E.Schmidt kickoff 60 yards to the Wis05 muffed by #32 H.Bortolotti at Wis05 recovered by UND #43 K.Kia at Wis13, End Of Play." };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Notre Dame", position: "DST" }, { schoolName: "Wisconsin", position: "DST" }] });
    const turnover = candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER");
    expect(turnover?.schoolName).toBe("Notre Dame");
  });

  it("detects an interception as a real turnover even when CFBD's playType is 'Penalty' rather than 'Interception' (because a penalty happened on the same play) - real Portland State/SDSU play where a confirmed interception went completely undetected", () => {
    const play = { id: 401860879391, gameId: 401860879, offense: "Portland State", defense: "San Diego State", scoring: false, playType: "Penalty", playText: "(01:36) No Huddle-Shotgun #5 G.Downing pass intercepted by #14 I.Green at SDSU21 #14 I.Green return 10 yards to the SDSU31 (#10 T.Beaman) PENALTY SDSU UNS: Unsportsmanlike Conduct (#11 K.Clay) 15 yards from SDSU31 to SDSU16" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "San Diego State", position: "DST" }] });
    const turnover = candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER");
    expect(turnover?.schoolName).toBe("San Diego State");
  });

  it("does not invalidate a touchdown that a replay review CONFIRMED (overturning an earlier incomplete call) - real Indiana play where a confirmed 15-yard TD pass was wrongly nullified because CFBD's text contains the word 'overturned' even though it means the score stood", () => {
    const roster = [{ id: 1, firstName: "J.", lastName: "Hoover", position: "QB" }];
    const play = { id: 40185842532, gameId: 401858425, offense: "Indiana", defense: "North Texas", scoring: true, playType: "Passing Touchdown", playText: "(13:40) Shotgun #10 J.Hoover pass complete short left to #11 N.Marsh caught at UNT00, for 15 yards to the UNT00 TOUCHDOWN, clock 13:36, 1ST DOWN. The previous play is under automatic review - \"Pass completion\". CALL OVERTURNED. (Original Play: (13:40) Shotgun #10 J.Hoover pass incomplete short left to #11 N.Marsh thrown to UNT00) #15 N.Radicic kick attempt good" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Indiana", position: "QB" }] });
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "QB")).toBe(true);
  });

  it("still invalidates a touchdown that a replay review overturned AWAY from a score (the opposite real scenario)", () => {
    const roster = [{ id: 1, firstName: "J.", lastName: "Hoover", position: "QB" }];
    const play = { id: 999, gameId: 1, offense: "Indiana", defense: "North Texas", scoring: false, playType: "Passing Touchdown", playText: "Shotgun #10 J.Hoover pass incomplete short left to #11 N.Marsh. The previous play is under automatic review - \"Pass completion\". CALL OVERTURNED. (Original Play: Shotgun #10 J.Hoover pass complete short left to #11 N.Marsh caught at UNT00, for 15 yards to the UNT00 TOUCHDOWN)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Indiana", position: "QB" }] });
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN")).toBe(false);
  });

  it("credits a fumble lost that a replay review CONFIRMED (overturning an original 'no fumble' call) - real Texas A&M play (Horton fumble, recovered by Missouri State) that was wrongly suppressed by the same overturned-invalidation ambiguity, this time for a fumble instead of a touchdown", () => {
    const play = { id: 401856668287, gameId: 401856668, offense: "Texas A&M", defense: "Missouri State", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "(10:06) No Huddle-Shotgun #10 M.Reed pass complete short right to #7 I.Horton caught at MSU15, for 16 yards to the MSU15 fumbled by #7 I.Horton at MSU15 forced by #12 J.Boamah recovered by MSU #12 J.Boamah at MSU15, End Of Play. The previous play is under automatic review - \"Fumble\". CALL OVERTURNED. (Original Play: (10:06) No Huddle-Shotgun #10 M.Reed pass complete short right to #7 I.Horton caught at MSU15, for 16 yards to the MSU15)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Texas A&M", position: "DST" }, { schoolName: "Missouri State", position: "DST" }] });
    const turnover = candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER");
    expect(turnover?.schoolName).toBe("Missouri State");
  });

  it("credits an interception that a replay review CONFIRMED (overturning an original 'incomplete/broken up' call) - real Texas Tech play (Hammond intercepted by Wilcox) that was wrongly suppressed by the same overturned-invalidation ambiguity a third time, now for an interception instead of a touchdown or fumble", () => {
    const roster = [{ id: 1, firstName: "W.", lastName: "Hammond", position: "QB" }];
    const play = { id: 401856770285, gameId: 401856770, offense: "Texas Tech", defense: "Abilene Christian", scoring: false, playType: "Interception", playText: "(07:13) No Huddle-Shotgun #15 W.Hammond pass intercepted by #22 J.Wilcox at ACU07, End Of Play. The previous play is under automatic review - \"Interception\". CALL OVERTURNED. (Original Play: (07:13) No Huddle-Shotgun #15 W.Hammond pass incomplete deep right to #9 D.Lee Jr. thrown to ACU10 broken up by #22 J.Wilcox)" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Texas Tech", position: "QB" }] });
    expect(candidates.some(candidate => candidate.eventType === "INTERCEPTION_THROWN" && candidate.position === "QB")).toBe(true);
  });

  it("credits a rushing touchdown to the player who actually scored, not a different player named later in the same text for an unrelated subsequent event (a two-point attempt) - real Kansas State play where Avery Johnson (QB) ran for the TD but Linkon Cure (TE), named only in the following two-point-attempt clause, got wrongly credited instead since TE was the drafted position and QB wasn't", () => {
    const roster = [
      { id: 1, firstName: "Avery", lastName: "Johnson", position: "QB" },
      { id: 2, firstName: "Linkon", lastName: "Cure", position: "TE" },
    ];
    const play = { id: 40185677194, gameId: 401856771, offense: "Kansas State", defense: "Nicholls", scoring: true, playType: "Rushing Touchdown", playText: "(07:05) No Huddle-Shotgun #2 A.Johnson rush left for 10 yards gain to the NICH00 TOUCHDOWN, clock 06:59, 1ST DOWN #0 L.Cure rush attempt Successful" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Kansas State", position: "TE" }] });
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "TE")).toBe(false);
  });

  it("does not misclassify a rushing touchdown as a passing touchdown just because the word 'pass' appears later in the same text for an unrelated event - real Vanderbilt play where Alexander (RB) ran for the score, but Berlowitz's (QB) failed two-point PASS attempt afterward wrongly matched a whole-text /pass/ check and routed the credit to QB instead of RB", () => {
    const roster = [
      { id: 1, firstName: "Blaze", lastName: "Berlowitz", position: "QB" },
      { id: 2, firstName: "Sedrick", lastName: "Alexander", position: "RB" },
    ];
    const play = { id: 401856669418, gameId: 401856669, offense: "Vanderbilt", defense: "Austin Peay", scoring: true, playType: "Rushing Touchdown", playText: "(05:25) Shotgun #28 S.Alexander rush middle for 18 yards gain to the APSU00 TOUCHDOWN, clock 05:24, 1ST DOWN #1 B.Berlowitz pass attempt failed" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Vanderbilt", position: "QB" }, { schoolName: "Vanderbilt", position: "RB" }] });
    const touchdown = candidates.find(candidate => candidate.eventType === "TOUCHDOWN");
    expect(touchdown?.position).toBe("RB");
  });

  it("detects a two-point conversion combined in the same play block as a touchdown, using CFBD's 'rush attempt Successful' vocabulary rather than the phrase 'two point conversion' - and credits the RIGHT scorer (the two-point attempt's own player, not the touchdown's) - real Kansas State play where Linkon Cure's (TE) successful two-point rush after Johnson's TD went entirely undetected", () => {
    const roster = [
      { id: 1, firstName: "Avery", lastName: "Johnson", position: "QB" },
      { id: 2, firstName: "Linkon", lastName: "Cure", position: "TE" },
    ];
    const play = { id: 40185677194, gameId: 401856771, offense: "Kansas State", defense: "Nicholls", scoring: true, playType: "Rushing Touchdown", playText: "(07:05) No Huddle-Shotgun #2 A.Johnson rush left for 10 yards gain to the NICH00 TOUCHDOWN, clock 06:59, 1ST DOWN #0 L.Cure rush attempt Successful" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Kansas State", position: "TE" }] });
    const twoPoint = candidates.find(candidate => candidate.eventType === "TWO_POINT_CONVERSION");
    expect(twoPoint?.position).toBe("TE");
  });

  it("does not credit a field goal nullified by penalty, even though CFBD's text still says GOOD before the penalty note - real Georgia/Tennessee State play where a made 38-yard FG got wrongly credited despite 'nullified by penalty ... NO PLAY' appearing right in the text, since field goal detection never checked isInvalidated at all", () => {
    const play = { id: 401856658277, gameId: 401856658, offense: "Georgia", defense: "Tennessee State", scoring: false, playType: "Field Goal Good", playText: "(07:46) #91 P.Woodring field goal attempt from 38 yards nullified by penaltyGOOD (H: #90 D.Miller, LS: #51 W.Snellings), clock 07:45 PENALTY UGA Equipment Violation 5 yards from TSU20 to TSU25. NO PLAY" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Georgia", position: "K" }] });
    expect(candidates.some(candidate => candidate.eventType === "FIELD_GOAL")).toBe(false);
  });

  it("does not credit a punt-return touchdown nullified by penalty, even though CFBD's text says TOUCHDOWN before the penalty note - real Virginia Tech/VMI play where a 43-yard punt return TD got wrongly credited despite 'nullified by penalty' appearing right in the text, because this credit path had its own separate, narrower invalidation check (only 'no play', not the comprehensive isInvalidated) instead of reusing the existing one", () => {
    const play = { id: 401858211442, gameId: 401858211, offense: "VMI", defense: "Virginia Tech", scoring: false, playType: "Punt Return", playText: "(13:10) #42 W.Lees punt 35 yards to the VMI43 #4 T.Denmark return 43 yards to the VMI00 TOUCHDOWN nullified by penalty, clock 13:02 PENALTY Hokies Holding (#30 C.Jones, Jr.) 10 yards from VMI14 to VMI24" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Virginia Tech", position: "DST" }] });
    expect(candidates.some(candidate => candidate.eventType === "OTHER_SPECIAL_TEAMS_TOUCHDOWN")).toBe(false);
  });

  it("credits a shared sack (CFBD gives each of two players their own per-athlete sack stat for the same play) only once, not twice - seen four times today with real data (Texas, Georgia, LSU, Florida)", () => {
    const play = { id: 999, gameId: 1, offense: "Team A", defense: "Team B", scoring: false, playType: "Sack", playText: "Sacked by two defenders" };
    const stats = [
      { playId: 999, athleteId: 1, team: "Team B", statType: "SACK", stat: 1 },
      { playId: 999, athleteId: 2, team: "Team B", statType: "SACK", stat: 1 },
    ];
    const candidates = mapLivePlayToCandidates({ play, stats, roster: [], selectedSchoolPositions: [{ schoolName: "Team B", position: "DST" }] });
    expect(candidates.filter(candidate => candidate.eventType === "SACK")).toHaveLength(1);
  });

  it("credits a trick-play touchdown pass to the actual thrower's real position (RB), not a blanket default to QB, when CFBD has no stats and the thrower isn't the drafted QB - real Delaware play where an RB threw a 75-yard TD pass to another RB", () => {
    const roster = [
      { id: 1, firstName: "Viron", lastName: "Ellison Jr.", position: "RB" },
      { id: 2, firstName: "Kaderris", lastName: "Roberts", position: "RB" },
      { id: 3, firstName: "Nick", lastName: "Minicucci", position: "QB" },
    ];
    const play = { id: 401864424544, gameId: 401864424, offense: "Delaware", defense: "Merrimack", scoring: true, playType: "Passing Touchdown", playText: "No Huddle-Shotgun #21 V.Ellison Jr. pass complete deep right to #3 K.Roberts caught at DEL45, for 75 yards to the MC00 TOUCHDOWN, clock 09:11, 1ST DOWN" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "Delaware", position: "QB" }, { schoolName: "Delaware", position: "RB" }] });
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "QB")).toBe(false);
    expect(candidates.some(candidate => candidate.eventType === "TOUCHDOWN" && candidate.position === "RB")).toBe(true);
  });

  it("credits a lost fumble to the receiver who actually fumbled after the catch, not the QB who threw the completed pass - real USC/Fresno State play where the QB was wrongly charged for a fumble the receiver committed", () => {
    const roster = [
      { id: 1, firstName: "Jayden", lastName: "Maiava", position: "QB" },
      { id: 2, firstName: "Waymond", lastName: "Jordan", position: "RB" },
    ];
    const play = { id: 401858436133, gameId: 401858436, offense: "USC", defense: "Fresno State", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "(02:43) No Huddle-Shotgun #14 J.Maiava pass complete short right to #2 W.Jordan caught at USC40, for 10 yards to the FST43 fumbled by #2 W.Jordan at FST43 forced by #11 D.Hampsten recovered by FST #35 T.Khajavi at FST43, End Of Play" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: [{ schoolName: "USC", position: "QB" }, { schoolName: "USC", position: "RB" }] });
    const fumble = candidates.find(candidate => candidate.eventType === "FUMBLE_LOST");
    expect(fumble?.position).toBe("RB");
  });

  it("extracts the real return distance from play text for a defensive touchdown - prefers it over play.yardsGained even when yardsGained is literally 0 (the real production value on this exact play, from CFBD's field for the offense's net yardage on the interception), since 0 doesn't fall into any of the three yard-bands and was silently swallowing the touchdown after the resilience fix, still crediting only the turnover", () => {
    const play = { id: 401858438493, gameId: 401858438, offense: "Wisconsin", defense: "Notre Dame", scoring: true, yardsGained: 0, playType: "Pass Interception Return", playText: "(08:59) Shotgun #1 C.Joseph pass intercepted by #2 D.McKinney at UND45 #2 D.McKinney return 55 yards to the WIS00 TOUCHDOWN, clock 08:52" };
    const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Notre Dame", position: "DST" }] });
    const touchdown = candidates.find(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN");
    expect(touchdown?.yardDistance).toBe(55);
  });

  it("derives scoringTeam from the running score for the post-game /plays feed", async () => {
    const { annotateScoringTeams } = await import("./cfbd");
    const plays = annotateScoringTeams([
      { id: 1, gameId: 5, offense: "A", defense: "B", offenseScore: 0, defenseScore: 0, scoring: false },
      { id: 2, gameId: 5, offense: "A", defense: "B", offenseScore: 0, defenseScore: 7, scoring: true, playType: "Punt Return Touchdown" },
      { id: 3, gameId: 5, offense: "B", defense: "A", offenseScore: 7, defenseScore: 7, scoring: true, playType: "Rushing Touchdown" },
    ]);
    expect(plays.map(play => play.scoringTeam ?? null)).toEqual([null, "B", "A"]);
  });
  it("uses the canonical field-goal distance once even when a made-kick player stat is present", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 79, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", yardsToGoal: 19, yardsGained: 36 }, stats: [{ playId: 79, athleteId: 4, team: "Ohio State", statType: "Field Goal Made", stat: 36 }], roster: [{ id: 4, position: "K" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K" }] });
    expect(candidates.filter(candidate => candidate.eventType === "FIELD_GOAL")).toEqual([expect.objectContaining({ yardDistance: 36, sourceEventKey: "79:FIELD_GOAL:K" })]);
  });
  it("counts a made PAT noted on a touchdown without turning that touchdown into a K/ST return score", () => {
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK)")).toBe(true);
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK NO GOOD)")).toBe(false);
    const candidates = mapLivePlayToCandidates({ play: { id: 76, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Rushing Touchdown", playText: "Run for a TD (Kicker KICK)" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K" }] });
    expect(candidates.map(candidate => candidate.eventType)).toEqual(["EXTRA_POINT"]);
  });
  it("counts a made PAT phrased as 'kick attempt good' outside parentheses - the actual live CFBD format that was previously missed", () => {
    expect(hasMadePat("Rushing Touchdown", "(08:55) #14 J.Maiava rush for 1 yard TOUCHDOWN, clock 08:55 #45 C.Chittenden kick attempt good (H: #35 L.Carrigan, LS: #53 L.Brown)")).toBe(true);
    expect(hasMadePat("Rushing Touchdown", "(08:55) #14 J.Maiava rush for 1 yard TOUCHDOWN, clock 08:55 #45 C.Chittenden kick attempt no good (H: #35 L.Carrigan, LS: #53 L.Brown)")).toBe(false);
  });
});

it("attaches the actual CFBD play description to every candidate's note, for auditing - not just our own generated summary", () => {
  const play = { id: 79, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", playText: "#33 A.Birr field goal attempt from 36 yards GOOD" };
  const candidates = mapLivePlayToCandidates({ play, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K" }] });
  expect(candidates.length).toBeGreaterThan(0);
  for (const candidate of candidates) expect(candidate.note).toContain("A.Birr field goal attempt from 36 yards GOOD");
});
