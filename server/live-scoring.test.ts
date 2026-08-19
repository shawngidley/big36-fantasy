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
  it("recognizes only explicit special-teams touchdown play types and made kicks", () => {
    expect(specialTeamsTouchdownType("Kickoff Return Touchdown")).toBe("KICK_RETURN_TOUCHDOWN");
    expect(specialTeamsTouchdownType("Passing Touchdown")).toBeNull();
    const kickoffReturn = mapLivePlayToCandidates({ play: { id: 74, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Kickoff Return Touchdown", playText: "Kickoff returned for a touchdown" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    const fieldGoal = mapLivePlayToCandidates({ play: { id: 75, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Field Goal Good", yardsToGoal: 36 }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    expect(kickoffReturn.map(candidate => candidate.eventType)).toContain("KICK_RETURN_TOUCHDOWN");
    expect(fieldGoal.map(candidate => candidate.eventType)).toContain("FIELD_GOAL");
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
});
