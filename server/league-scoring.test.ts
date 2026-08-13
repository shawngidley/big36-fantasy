import { describe, expect, it } from "vitest";
import { assertSchoolPositionAvailable, buildReversal, calculateEventScore, hasBalancedDraftAssignments, normalizeSchoolName, rankBySeasonPoints } from "./league-scoring";

describe("Big 36 scoring engine", () => {
  const rules = [
    { id: 1, eventType: "TOUCHDOWN" as const, positionScope: "ALL" as const, minYards: 1, maxYards: 9, flatPoints: "6", pointsPerUnit: null, isActive: "true" as const },
    { id: 2, eventType: "TOUCHDOWN" as const, positionScope: "ALL" as const, minYards: 10, maxYards: 19, flatPoints: "9", pointsPerUnit: null, isActive: "true" as const },
    { id: 3, eventType: "PASSING_YARDS" as const, positionScope: "QB" as const, minYards: null, maxYards: null, flatPoints: null, pointsPerUnit: "0.04", isActive: "true" as const },
  ];

  it("uses the matching touchdown distance tier", () => {
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "WR", statValue: 1, yardDistance: 14 })).toEqual({ ruleId: 2, points: 9 });
  });

  it("calculates yardage with a position-specific rate", () => {
    expect(calculateEventScore(rules, { eventType: "PASSING_YARDS", position: "QB", statValue: 250 })).toEqual({ ruleId: 3, points: 10 });
  });

  it("requires six distinct assignments totalling 111", () => {
    expect(hasBalancedDraftAssignments([
      { position: "QB", draftPosition: 1 }, { position: "RB", draftPosition: 12 },
      { position: "WR", draftPosition: 18 }, { position: "TE", draftPosition: 20 },
      { position: "DEF_ST", draftPosition: 24 }, { position: "FLEX", draftPosition: 36 },
    ])).toBe(true);
    expect(hasBalancedDraftAssignments([{ position: "QB", draftPosition: 1 }])).toBe(false);
  });

  it("normalizes schools and rejects an already locked school-position group", () => {
    expect(normalizeSchoolName("  Ohio   State ")).toBe("Ohio State");
    expect(() => assertSchoolPositionAvailable(
      [{ ownerId: 2, schoolName: "Ohio State", position: "WR" }],
      { ownerId: 1, schoolName: " ohio  state ", position: "WR" },
    )).toThrow("already locked");
    expect(() => assertSchoolPositionAvailable(
      [{ ownerId: 2, schoolName: "Ohio State", position: "WR" }],
      { ownerId: 1, schoolName: "Ohio State", position: "QB" },
    )).not.toThrow();
  });

  it("records an equal and opposite immutable reversal payload", () => {
    expect(buildReversal({ id: 44, statValue: "1", computedPoints: "9" })).toEqual({
      auditAction: "REVERSAL",
      correctionOfEventId: 44,
      statValue: "-1",
      computedPoints: "-9",
    });
  });

  it("ranks season totals and breaks equal totals alphabetically", () => {
    expect(rankBySeasonPoints([
      { teamName: "Zebra Club", totalPoints: 82 },
      { teamName: "Alpha Club", totalPoints: 82 },
      { teamName: "Bronze Club", totalPoints: 79 },
    ]).map(team => `${team.rank}:${team.teamName}`)).toEqual([
      "1:Alpha Club", "2:Zebra Club", "3:Bronze Club",
    ]);
  });
});
