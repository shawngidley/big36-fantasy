import { describe, expect, it } from "vitest";
import { eligibleGameIdsForSchool, gameCountsForSchool, hasMadePat, mapLivePlayToCandidates, specialTeamsTouchdownType } from "./live-scoring";

describe("36 Football automatic scoring map", () => {
  const games = Array.from({ length: 13 }, (_, index) => ({ id: index + 1, season: 2026, week: index + 1, seasonType: "regular", startDate: `2026-0${Math.min(index + 8, 9)}-${String(index + 1).padStart(2, "0")}T17:00:00Z`, completed: true, homeTeam: "Ohio State", awayTeam: "Opponent" }));
  it("caps each school at its first 12 eligible regular-season games", () => {
    expect(eligibleGameIdsForSchool(games, "Ohio State")).toHaveLength(12);
    expect(gameCountsForSchool(games, "Ohio State", 12)).toBe(true);
    expect(gameCountsForSchool(games, "Ohio State", 13)).toBe(false);
  });
  it("credits both QB and receiver on a passing touchdown using snap yardline-to-goal", () => {
    const candidates = mapLivePlayToCandidates({ play: { id: 55, gameId: 9, offense: "Ohio State", defense: "Opponent", yardsToGoal: 31, scoring: true }, stats: [{ playId: 55, athleteId: 1, team: "Ohio State", statType: "Passing Touchdown", stat: 1 }, { playId: 55, athleteId: 2, team: "Ohio State", statType: "Reception", stat: 1 }], roster: [{ id: 1, position: "QB" }, { id: 2, position: "WR" }], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "QB" }, { schoolName: "Ohio State", position: "WR" }] });
    expect(candidates.map(candidate => `${candidate.position}:${candidate.eventType}:${candidate.yardDistance}`)).toEqual(expect.arrayContaining(["QB:TOUCHDOWN:31", "WR:TOUCHDOWN:31"]));
  });
  it("credits special-teams blocks and safeties to K/ST while preserving defensive safeties for DEF", () => {
    const blockedPunt = mapLivePlayToCandidates({ play: { id: 71, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playType: "Blocked Punt", playText: "Punt blocked by Opponent" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "K_ST" }] });
    const defensiveSafety = mapLivePlayToCandidates({ play: { id: 72, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playText: "Quarterback tackled in end zone for safety" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(blockedPunt.map(candidate => candidate.eventType)).toContain("BLOCKED_PUNT");
    expect(defensiveSafety.map(candidate => candidate.eventType)).toContain("DEFENSIVE_SAFETY");
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
  it("counts a made PAT noted on a touchdown without turning that touchdown into a K/ST return score", () => {
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK)")).toBe(true);
    expect(hasMadePat("Passing Touchdown", "Pass complete for a TD (Kali Nguma KICK NO GOOD)")).toBe(false);
    const candidates = mapLivePlayToCandidates({ play: { id: 76, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playType: "Rushing Touchdown", playText: "Run for a TD (Kicker KICK)" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Ohio State", position: "K_ST" }] });
    expect(candidates.map(candidate => candidate.eventType)).toEqual(["EXTRA_POINT"]);
  });
});
