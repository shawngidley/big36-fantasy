import { describe, expect, it } from "vitest";
import { eligibleGameIdsForSchool, gameCountsForSchool, mapLivePlayToCandidates } from "./live-scoring";

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
    const blockedPunt = mapLivePlayToCandidates({ play: { id: 71, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: false, playText: "Punt blocked by Opponent" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "K_ST" }] });
    const defensiveSafety = mapLivePlayToCandidates({ play: { id: 72, gameId: 9, offense: "Ohio State", defense: "Opponent", scoring: true, playText: "Quarterback tackled in end zone for safety" }, stats: [], roster: [], selectedSchoolPositions: [{ schoolName: "Opponent", position: "DEF" }] });
    expect(blockedPunt.map(candidate => candidate.eventType)).toContain("BLOCKED_PUNT");
    expect(defensiveSafety.map(candidate => candidate.eventType)).toContain("DEFENSIVE_SAFETY");
  });
});
