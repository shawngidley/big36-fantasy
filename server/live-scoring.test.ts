import { describe, expect, it } from "vitest";
import { eligibleGameIdsForSchool, finalShutoutCandidates, gameCountsForSchool, hasMadePat, isSupersededInterceptionPlay, mapLivePlayToCandidates, specialTeamsTouchdownType } from "./live-scoring";

describe("36 Football automatic scoring map", () => {
  const games = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, season: 2026, week: index + 1, seasonType: "regular", startDate: `2026-0${Math.min(index + 8, 9)}-${String(index + 1).padStart(2, "0")}T17:00:00Z`, completed: true, homeTeam: "Ohio State", awayTeam: "Opponent" }));
  it("caps each school at its first 12 eligible regular-season games", () => {
    expect(eligibleGameIdsForSchool(games, "Ohio State")).toHaveLength(12);
    expect(gameCountsForSchool(games, "Ohio State", 12)).toBe(true);
    expect(gameCountsForSchool(games, "Ohio State", 13)).toBe(false);
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
    const candidates = mapLivePlayToCandidates({ play: { id: 553, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Pass Interception Return", playText: "A. Manning pass intercepted by Defender, returned 12 yards" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Opponent", position: "DEF", eventType: "DEFENSIVE_TURNOVER", sourceEventKey: "553:DEFENSIVE_TURNOVER:unit" })]);
  });
  it("credits a sack to the defense's DEF unit from play text alone when no player-stat rows are available yet", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 554, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Sack", playText: "A. Manning sacked for a loss of 7 yards" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Opponent", position: "DEF", eventType: "SACK", sourceEventKey: "554:SACK:unit" })]);
  });
  it("credits a fumble recovery to the defense's DEF unit from playType alone, even with no matching player-stat row (the exact real play that was missed for UNLV)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 401862693353, gameId: 401862693, offense: "Memphis", defense: "UNLV", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "pass complete short right ... fumbled by #1 T.Chapman ... recovered by UNLV #2 D.Harris ..." }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "UNLV", position: "DEF" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "UNLV", position: "DEF", eventType: "DEFENSIVE_TURNOVER", sourceEventKey: "401862693353:DEFENSIVE_TURNOVER:playtype" })]);
  });
  it("credits exactly one defensive turnover for a fumble recovery, via the playType fallback (the only real path - 'Fumble Recovery' isn't an actual CFBD stat category for defensive players)", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 556, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Fumble Recovery (Opponent)", playText: "fumbled, recovered by #4 Defender" }, stats: [], roster: [{ id: 4, position: "DEF" }], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(candidates.filter(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")).toHaveLength(1);
    expect(candidates.find(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")?.sourceEventKey).toBe("556:DEFENSIVE_TURNOVER:playtype");
  });
  it("does not double-credit a defensive turnover from text when official player-stat rows are already present", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 555, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Pass Interception Return", playText: "A. Manning pass intercepted by #4 Defender" }, stats: [{ playId: 555, athleteId: 9, team: "Opponent", statType: "Interception", stat: 1 }], roster: [{ id: 9, position: "DEF" }], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
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
    const candidates = mapLivePlayToCandidates({ play: { id: 63, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Interception Return Touchdown", playText: "pass intercepted by #4, returned 55 yards for a TOUCHDOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Opponent")).toBe(true);
  });
  it("credits a fumble-return touchdown to the DEF unit from playType alone, live", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 64, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Fumble Recovery (Opponent)", playText: "fumbled, recovered by #7, returned 40 yards for a TOUCHDOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Opponent")).toBe(true);
  });
  it("penalizes the offense for a fumble lost even when CFBD's playType is 'Fumble Return Touchdown' rather than 'Fumble Recovery (Opponent)' - the real Hawai'i play that was missed", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 65, gameId: 9, offense: "Hawai'i", defense: "Stanford", scoring: true, playType: "Fumble Return Touchdown", playText: "Tevarua Tafiti 31 Yd Fumble Return (Emmet Kenney Kick)" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Hawai'i", position: "QB" }, { schoolName: "Stanford", position: "DEF" }] });
    expect(candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === "Stanford")).toBe(true);
  });
  it("does NOT credit the defense with a turnover when a team recovers its OWN fumble ('Fumble Recovery (Own)') - a critical bug found tonight where the generic 'fumble recovery' text match would have wrongly credited a turnover that never happened", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 66, gameId: 9, offense: "Hawai'i", defense: "Stanford", scoring: false, playType: "Fumble Recovery (Own)", playText: "pass complete for 10 yards, fumbled, recovered by Hawai'i's own player, 1ST DOWN" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Stanford", position: "DEF" }] });
    expect(candidates.filter(candidate => candidate.eventType === "DEFENSIVE_TURNOVER")).toHaveLength(0);
    expect(candidates.filter(candidate => candidate.eventType === "FUMBLE_LOST")).toHaveLength(0);
  });
  it("credits special-teams blocks and safeties to K/ST while preserving defensive safeties for DEF", () => {
    const blockedPunt = mapLivePlayToCandidates({ play: { id: 71, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Blocked Punt", playText: "Punt blocked by Opponent" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "K_ST" }] });
    const defensiveSafety = mapLivePlayToCandidates({ play: { id: 72, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playText: "Quarterback tackled in end zone for safety" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(blockedPunt.map(candidate => candidate.eventType)).toContain("BLOCKED_PUNT");
    expect(defensiveSafety.map(candidate => candidate.eventType)).toContain("DEFENSIVE_SAFETY");
    expect(defensiveSafety.find(candidate => candidate.eventType === "DEFENSIVE_SAFETY")?.position).toBe("DEF");
  });
  it("adds a final-game shutout only for the selected defense that held its opponent scoreless", () => {
    const candidates = finalShutoutCandidates({ game: { id: 81, season: 2026, week: 1, seasonType: "regular", startDate: "2026-08-29T17:00:00Z", completed: true, homeTeam: "Ohio State", awayTeam: "Opponent", homePoints: 24, awayPoints: 0 }, selectedSchoolPositions: [{ schoolName: "Ohio State", position: "DEF" }, { schoolName: "Opponent", position: "DEF" }] });
    expect(candidates).toEqual([expect.objectContaining({ schoolName: "Ohio State", position: "DEF", eventType: "SHUTOUT", sourceEventKey: "81:SHUTOUT:DEF:ohio state" })]);
  });
  it("does not treat an ordinary offensive touchdown with its appended PAT as a K/ST touchdown", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 73, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Passing Touchdown", playText: "Quarterback pass complete for a TD (Kicker KICK)" }, stats: [{ playId: 73, athleteId: 1, team: "Ohio State", statType: "Passing Touchdown", stat: 1 }, { playId: 73, athleteId: 2, team: "Ohio State", statType: "Reception", stat: 1 }], roster: [{ id: 1, position: "QB" }, { id: 2, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }, { schoolName: "Ohio State", position: "K_ST" }] });
    expect(candidates.some(candidate => candidate.position === "K_ST" && candidate.eventType.includes("TOUCHDOWN"))).toBe(false);
  });
  it("K/ST rulebook: field-goal distance comes from the text, blocked kicks match CFBD's word order, safeties route by play context and score change, any special-teams TD goes to K/ST", () => {
    const pick = (school: string, position: "K_ST" | "DEF") => [{ schoolName: school, position }];
    // Real UNC-TCU play: typed "Safety" on a rush; North Carolina's score moved -> DEF safety for UNC.
    const uncSafety = { id: 401856766331, gameId: 401856766, offense: "TCU", defense: "North Carolina", scoring: true, scoringTeam: "North Carolina", playType: "Safety", playText: "(01:54) No Huddle TCU rush middle for 31 yards loss to the TCU00, End Of Play. North Carolina SAFETY, clock 01:49" };
    expect(mapLivePlayToCandidates({ play: uncSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "DEF") }).map(c => c.eventType)).toContain("DEFENSIVE_SAFETY");
    expect(mapLivePlayToCandidates({ play: uncSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "K_ST") }).map(c => c.eventType)).not.toContain("SPECIAL_TEAMS_SAFETY");
    // Same outcome type, but the text says it was a punt -> K/ST safety.
    const puntSafety = { ...uncSafety, id: 2, playType: "Safety", playText: "#47 A.Bacchetta punt, snap out of the end zone for a SAFETY" };
    expect(mapLivePlayToCandidates({ play: puntSafety, stats: [], roster: [], selectedSchoolPositions: pick("North Carolina", "K_ST") }).map(c => c.eventType)).toContain("SPECIAL_TEAMS_SAFETY");
    // Field goal distance from the text, not yardsGained.
    const fg = mapLivePlayToCandidates({ play: { id: 3, gameId: 1, offense: "Georgia Tech", defense: "Colorado", scoring: true, playType: "Field Goal Good", yardsGained: 0, playText: "#33 A.Birr field goal attempt from 47 yards GOOD" }, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "K_ST") });
    expect(fg.find(c => c.eventType === "FIELD_GOAL")?.yardDistance).toBe(47);
    // Blocked FG in CFBD's phrasing.
    const blocked = mapLivePlayToCandidates({ play: { id: 4, gameId: 1, offense: "Colorado", defense: "Georgia Tech", scoring: false, playType: "Field Goal Missed", playText: "#38 D.Gerlach field goal attempt from 45 yards BLOCKED by #9 K.Smith" }, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "K_ST") });
    expect(blocked.map(c => c.eventType)).toContain("BLOCKED_FIELD_GOAL");
    expect(blocked.map(c => c.eventType)).not.toContain("FIELD_GOAL");
    // Muffed punt recovered for a TD is typed as a fumble return; it is a special-teams TD for the scoring team's K/ST, not a DEF touchdown.
    const muff = { id: 5, gameId: 1, offense: "Colorado", defense: "Georgia Tech", scoring: true, scoringTeam: "Georgia Tech", playType: "Fumble Return Touchdown", playText: "#35 D.Greaves punt 46 yards muffed by #4 J.Allen recovered by #22 T.Jones for a TOUCHDOWN" };
    expect(mapLivePlayToCandidates({ play: muff, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "K_ST") }).map(c => c.eventType)).toContain("OTHER_SPECIAL_TEAMS_TOUCHDOWN");
    expect(mapLivePlayToCandidates({ play: muff, stats: [], roster: [], selectedSchoolPositions: pick("Georgia Tech", "DEF") }).map(c => c.eventType)).not.toContain("DEFENSIVE_TOUCHDOWN");
  });
  it("recognizes only explicit special-teams touchdown play types and made kicks", () => {
    expect(specialTeamsTouchdownType("Kickoff Return Touchdown")).toBe("KICK_RETURN_TOUCHDOWN");
    expect(specialTeamsTouchdownType("Passing Touchdown")).toBeNull();
    // Ohio State is the KICKING team (offense on the play); the score change says Opponent returned it.
    const kickoffReturn = mapLivePlayToCandidates({ play: { id: 74, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, scoringTeam: "Opponent", playType: "Kickoff Return Touchdown", playText: "Kickoff returned for a touchdown" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "K_ST" }] });
    const fieldGoal = mapLivePlayToCandidates({ play: { id: 75, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", yardsToGoal: 36 }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    expect(kickoffReturn.map(candidate => candidate.eventType)).toContain("KICK_RETURN_TOUCHDOWN");
    expect(kickoffReturn.find(candidate => candidate.eventType === "KICK_RETURN_TOUCHDOWN")?.schoolName).toBe("Opponent");
    expect(fieldGoal.map(candidate => candidate.eventType)).toContain("FIELD_GOAL");
  });
  it("never credits a return touchdown to the kicking team, and falls back to the play's defense when no score signal exists", () => {
    const base = { id: 76, gameId: 9, offense: "Kicking U", defense: "Returning U", scoring: true, playType: "Punt Return Touchdown", playText: "Punt returned 70 yards for a touchdown" };
    const wrongSide = mapLivePlayToCandidates({ play: base, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Kicking U", position: "K_ST" }] });
    expect(wrongSide.filter(candidate => candidate.eventType === "PUNT_RETURN_TOUCHDOWN")).toHaveLength(0);
    const rightSide = mapLivePlayToCandidates({ play: base, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Returning U", position: "K_ST" }] });
    expect(rightSide.find(candidate => candidate.eventType === "PUNT_RETURN_TOUCHDOWN")?.schoolName).toBe("Returning U");
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
    const candidates = mapLivePlayToCandidates({ play: { id: 79, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", yardsToGoal: 19, yardsGained: 36 }, stats: [{ playId: 79, athleteId: 4, team: "Ohio State", statType: "Field Goal Made", stat: 36 }], roster: [{ id: 4, position: "K" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    expect(candidates.filter(candidate => candidate.eventType === "FIELD_GOAL")).toEqual([expect.objectContaining({ yardDistance: 36, sourceEventKey: "79:FIELD_GOAL:K_ST" })]);
  });
  it("counts a made PAT noted on a touchdown without turning that touchdown into a K/ST return score", () => {
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK)")).toBe(true);
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK NO GOOD)")).toBe(false);
    const candidates = mapLivePlayToCandidates({ play: { id: 76, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Rushing Touchdown", playText: "Run for a TD (Kicker KICK)" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    expect(candidates.map(candidate => candidate.eventType)).toEqual(["EXTRA_POINT"]);
  });
  it("counts a made PAT phrased as 'kick attempt good' outside parentheses - the actual live CFBD format that was previously missed", () => {
    expect(hasMadePat("Rushing Touchdown", "(08:55) #14 J.Maiava rush for 1 yard TOUCHDOWN, clock 08:55 #45 C.Chittenden kick attempt good (H: #35 L.Carrigan, LS: #53 L.Brown)")).toBe(true);
    expect(hasMadePat("Rushing Touchdown", "(08:55) #14 J.Maiava rush for 1 yard TOUCHDOWN, clock 08:55 #45 C.Chittenden kick attempt no good (H: #35 L.Carrigan, LS: #53 L.Brown)")).toBe(false);
  });
});
