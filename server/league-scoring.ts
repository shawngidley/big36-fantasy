import type { Position, ScoringEventType } from "../drizzle/schema";

export type RuleInput = {
  id: number;
  eventType: ScoringEventType;
  positionScope: "ALL" | Position;
  minYards: number | null;
  maxYards: number | null;
  flatPoints: string | number | null;
  pointsPerUnit: string | number | null;
  isActive: "true" | "false";
};

export type ScoreEventInput = {
  eventType: ScoringEventType;
  position: Position;
  statValue: number;
  yardDistance?: number | null;
};

export type CalculatedScore = { ruleId: number; points: number };

const asNumber = (value: string | number | null) => value === null ? null : Number(value);

export function normalizeSchoolName(schoolName: string) {
  return schoolName.trim().replace(/\s+/g, " ");
}

export function assertSchoolPositionAvailable(
  existingPicks: Array<{ ownerId: number; schoolName: string; position: Position }>,
  candidate: { ownerId: number; schoolName: string; position: Position },
) {
  const normalizedCandidate = normalizeSchoolName(candidate.schoolName).toLocaleLowerCase();
  const conflict = existingPicks.find(pick =>
    pick.ownerId !== candidate.ownerId &&
    pick.position === candidate.position &&
    normalizeSchoolName(pick.schoolName).toLocaleLowerCase() === normalizedCandidate,
  );
  if (conflict) {
    throw new Error(`${normalizeSchoolName(candidate.schoolName)} ${candidate.position} is already locked by another Big 36 team.`);
  }
}

export function buildReversal(original: { id: number; statValue: string | number; computedPoints: string | number }) {
  return {
    auditAction: "REVERSAL" as const,
    correctionOfEventId: original.id,
    statValue: (-Number(original.statValue)).toString(),
    computedPoints: (-Number(original.computedPoints)).toString(),
  };
}

export function rankBySeasonPoints<T extends { teamName: string; totalPoints: number }>(teams: T[]) {
  return [...teams]
    .sort((a, b) => b.totalPoints - a.totalPoints || a.teamName.localeCompare(b.teamName, undefined, { numeric: true, sensitivity: "base" }))
    .map((team, index) => ({ ...team, rank: index + 1 }));
}

export function calculateEventScore(rules: RuleInput[], event: ScoreEventInput): CalculatedScore {
  const distanceTieredEvent = event.eventType === "TOUCHDOWN" || event.eventType === "FIELD_GOAL" || event.eventType === "DEFENSIVE_TOUCHDOWN";
  const matches = rules.filter(rule => {
    const scopeMatches = rule.positionScope === "ALL" || rule.positionScope === event.position;
    const distanceMatches = !distanceTieredEvent || (
      event.yardDistance !== undefined && event.yardDistance !== null &&
      (rule.minYards === null || event.yardDistance >= rule.minYards) &&
      (rule.maxYards === null || event.yardDistance <= rule.maxYards)
    );
    return rule.isActive === "true" && rule.eventType === event.eventType && scopeMatches && distanceMatches;
  });

  const specificRule = matches.find(rule => rule.positionScope === event.position);
  const rule = specificRule ?? matches.find(rule => rule.positionScope === "ALL");
  if (!rule) {
    throw new Error(`No active Big 36 scoring rule matches ${event.eventType} for ${event.position}.`);
  }

  const flatPoints = asNumber(rule.flatPoints);
  const pointsPerUnit = asNumber(rule.pointsPerUnit);
  if (flatPoints === null && pointsPerUnit === null) {
    throw new Error(`Scoring rule ${rule.id} must specify flat points or points per unit.`);
  }

  const calculated = flatPoints !== null
    ? flatPoints * event.statValue
    : (pointsPerUnit ?? 0) * event.statValue;

  return { ruleId: rule.id, points: Number(calculated.toFixed(2)) };
}

export function hasBalancedDraftAssignments(assignments: Array<{ position: Position; draftPosition: number }>) {
  if (assignments.length !== 6) return false;
  if (new Set(assignments.map(assignment => assignment.position)).size !== 6) return false;
  return assignments.reduce((total, assignment) => total + assignment.draftPosition, 0) === 111;
}

export function generateBalancedDraftPlans(): Array<Array<{ position: Position; draftPosition: number }>> {
  return Array.from({ length: 36 }, (_, index) => {
    const qb = index + 1;
    const rb = 37 - qb;
    const wr = qb <= 12 ? qb + 12 : qb <= 24 ? qb - 12 : qb;
    const te = 37 - wr;
    const k = ((index + 8) % 36) + 1;
    const defSt = 37 - k;
    return [
      { position: "QB" as const, draftPosition: qb },
      { position: "RB" as const, draftPosition: rb },
      { position: "WR" as const, draftPosition: wr },
      { position: "TE" as const, draftPosition: te },
      { position: "K" as const, draftPosition: k },
      { position: "DST" as const, draftPosition: defSt },
    ];
  });
}
