import { describe, expect, it } from "vitest";
import { assertSchoolPositionAvailable, buildReversal, calculateEventScore, generateBalancedDraftPlans, hasBalancedDraftAssignments, normalizeSchoolName, rankBySeasonPoints } from "./league-scoring";
import { yearOneRules } from "./year-one-rules";

describe("36 Football scoring engine", () => {
  const rules = yearOneRules.map((rule, index) => ({ ...rule, id: index + 1, pointsPerUnit: null, isActive: "true" as const }));
  it("uses the standard offensive tiers, flat 12-point TE touchdowns, and two-point value", () => {
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "WR", statValue: 1, yardDistance: 7 })).toMatchObject({ points: 6 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "TE", statValue: 1, yardDistance: 7 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "TE", statValue: 1, yardDistance: 24 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "TE", statValue: 1, yardDistance: 45 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "TE", statValue: 1, yardDistance: 70 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "RB", statValue: 1, yardDistance: 45 })).toMatchObject({ points: 10 });
    expect(calculateEventScore(rules, { eventType: "TOUCHDOWN", position: "QB", statValue: 1, yardDistance: 70 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "TWO_POINT_CONVERSION", position: "WR", statValue: 1 })).toMatchObject({ points: 4 });
  });
  it("scores turnovers, K stacking components, and DST events", () => {
    expect(calculateEventScore(rules, { eventType: "INTERCEPTION_THROWN", position: "QB", statValue: 1 })).toMatchObject({ points: -3 });
    expect(calculateEventScore(rules, { eventType: "FUMBLE_LOST", position: "RB", statValue: 1 })).toMatchObject({ points: -3 });
    expect(calculateEventScore(rules, { eventType: "FIELD_GOAL", position: "K", statValue: 1, yardDistance: 43 })).toMatchObject({ points: 9 });
    expect(calculateEventScore(rules, { eventType: "BLOCKED_PUNT", position: "DST", statValue: 1 })).toMatchObject({ points: 3 });
    expect(calculateEventScore(rules, { eventType: "PUNT_RETURN_TOUCHDOWN", position: "DST", statValue: 1 })).toMatchObject({ points: 12 });
    expect(calculateEventScore(rules, { eventType: "SACK", position: "DST", statValue: 1 })).toMatchObject({ points: 1 });
    expect(calculateEventScore(rules, { eventType: "DEFENSIVE_TOUCHDOWN", position: "DST", statValue: 1, yardDistance: 65 })).toMatchObject({ points: 15 });
    expect(calculateEventScore(rules, { eventType: "SHUTOUT", position: "DST", statValue: 1 })).toMatchObject({ points: 15 });
  });
  it("requires six distinct assignments totalling 111", () => {
    expect(hasBalancedDraftAssignments([{ position: "QB", draftPosition: 1 }, { position: "RB", draftPosition: 12 }, { position: "WR", draftPosition: 18 }, { position: "TE", draftPosition: 20 }, { position: "K", draftPosition: 24 }, { position: "DST", draftPosition: 36 }])).toBe(true);
  });
  it("normalizes schools and rejects a locked school-position group", () => {
    expect(normalizeSchoolName("  Ohio   State ")).toBe("Ohio State");
    expect(() => assertSchoolPositionAvailable([{ ownerId: 2, schoolName: "Ohio State", position: "WR" }], { ownerId: 1, schoolName: " ohio  state ", position: "WR" })).toThrow("already locked");
  });
  it("records immutable reversal payloads that offset both positive and negative source events", () => {
    expect(buildReversal({ id: 44, statValue: "1", computedPoints: "9" })).toEqual({ auditAction: "REVERSAL", correctionOfEventId: 44, statValue: "-1", computedPoints: "-9" });
    expect(buildReversal({ id: 45, statValue: "1", computedPoints: "-3" })).toEqual({ auditAction: "REVERSAL", correctionOfEventId: 45, statValue: "-1", computedPoints: "3" });
  });
  it("ranks equal season totals alphabetically with numeric-aware team labels", () => {
    expect(rankBySeasonPoints([{ teamName: "Zebra Club", totalPoints: 82 }, { teamName: "Alpha Club", totalPoints: 82 }]).map(team => `${team.rank}:${team.teamName}`)).toEqual(["1:Alpha Club", "2:Zebra Club"]);
    expect(rankBySeasonPoints([{ teamName: "Team 10", totalPoints: 0 }, { teamName: "Team 2", totalPoints: 0 }, { teamName: "Team 1", totalPoints: 0 }, { teamName: "Team 9", totalPoints: 0 }]).map(team => team.teamName)).toEqual(["Team 1", "Team 2", "Team 9", "Team 10"]);
  });
  it("declares the complete K/ST and DEF blueprint without yardage accumulation", () => {
    expect(new Set(yearOneRules.map(rule => rule.positionScope))).toEqual(new Set(["QB", "RB", "WR", "TE", "K", "DST"]));
    expect(yearOneRules.some(rule => rule.eventType === "FIELD_GOAL" && rule.flatPoints === 12)).toBe(true);
    expect(yearOneRules.some(rule => rule.eventType === "DEFENSIVE_TOUCHDOWN" && rule.flatPoints === 15)).toBe(true);
  });
  it("generates 36 auditable 111 plans without multiple early premium picks", () => {
    const plans = generateBalancedDraftPlans();
    expect(plans).toHaveLength(36); expect(plans.every(hasBalancedDraftAssignments)).toBe(true);
    expect(plans.every(plan => plan.filter(slot => ["QB", "RB", "WR"].includes(slot.position) && slot.draftPosition <= 12).length <= 1)).toBe(true);
    for (const position of ["QB", "RB", "WR", "TE", "K", "DST"] as const) expect(plans.map(plan => plan.find(slot => slot.position === position)?.draftPosition).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 36 }, (_, index) => index + 1));
  });
});
