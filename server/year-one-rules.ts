import type { Position, ScoringEventType } from "../drizzle/schema";

export type YearOneRule = { label: string; eventType: ScoringEventType; positionScope: "ALL" | Position; minYards: number | null; maxYards: number | null; flatPoints: number };

const offensivePositions = ["QB", "RB", "WR", "TE"] as const;
const touchdownRules = (position: (typeof offensivePositions)[number]): YearOneRule[] => {
  // Commissioner-approved Year 1 exception: a TE touchdown is always worth
  // 12 points, regardless of its goal-line distance. The yard bands remain so
  // the live scorer can resolve a rule consistently for every event.
  const [short, medium, long, explosive] = position === "TE" ? [12, 12, 12, 12] : [6, 8, 10, 12];
  return [
    { label: `${position} touchdown 1–9 yards`, eventType: "TOUCHDOWN", positionScope: position, minYards: 1, maxYards: 9, flatPoints: short },
    { label: `${position} touchdown 10–29 yards`, eventType: "TOUCHDOWN", positionScope: position, minYards: 10, maxYards: 29, flatPoints: medium },
    { label: `${position} touchdown 30–59 yards`, eventType: "TOUCHDOWN", positionScope: position, minYards: 30, maxYards: 59, flatPoints: long },
    { label: `${position} touchdown 60+ yards`, eventType: "TOUCHDOWN", positionScope: position, minYards: 60, maxYards: null, flatPoints: explosive },
  ];
};
const conversionAndTurnoverRules = (position: (typeof offensivePositions)[number]): YearOneRule[] => [
  { label: `${position} successful two-point conversion`, eventType: "TWO_POINT_CONVERSION", positionScope: position, minYards: null, maxYards: null, flatPoints: 4 },
  { label: `${position} fumble lost`, eventType: "FUMBLE_LOST", positionScope: position, minYards: null, maxYards: null, flatPoints: -3 },
];

export const yearOneRules: YearOneRule[] = [
  ...offensivePositions.flatMap(touchdownRules), ...offensivePositions.flatMap(conversionAndTurnoverRules),
  { label: "QB interception thrown", eventType: "INTERCEPTION_THROWN", positionScope: "QB", minYards: null, maxYards: null, flatPoints: -3 },
  // K: kicking-only. Everything special-teams-adjacent (blocks, returns, ST safety) moved to DST below.
  { label: "K made PAT", eventType: "EXTRA_POINT", positionScope: "K", minYards: null, maxYards: null, flatPoints: 1 },
  { label: "K field goal 10–29 yards", eventType: "FIELD_GOAL", positionScope: "K", minYards: 10, maxYards: 29, flatPoints: 3 },
  { label: "K field goal 30–39 yards", eventType: "FIELD_GOAL", positionScope: "K", minYards: 30, maxYards: 39, flatPoints: 6 },
  { label: "K field goal 40–49 yards", eventType: "FIELD_GOAL", positionScope: "K", minYards: 40, maxYards: 49, flatPoints: 9 },
  { label: "K field goal 50+ yards", eventType: "FIELD_GOAL", positionScope: "K", minYards: 50, maxYards: null, flatPoints: 12 },
  // DST: Defense and Special Teams - former DEF rules plus every special-teams event moved off K.
  { label: "DST sack", eventType: "SACK", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 1 },
  { label: "DST turnover", eventType: "DEFENSIVE_TURNOVER", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "DST safety", eventType: "DEFENSIVE_SAFETY", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 6 },
  { label: "DST touchdown return 1–19 yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DST", minYards: 1, maxYards: 19, flatPoints: 9 },
  { label: "DST touchdown return 20–59 yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DST", minYards: 20, maxYards: 59, flatPoints: 12 },
  { label: "DST touchdown return 60+ yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DST", minYards: 60, maxYards: null, flatPoints: 15 },
  { label: "DST shutout", eventType: "SHUTOUT", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 15 },
  { label: "DST blocked field goal", eventType: "BLOCKED_FIELD_GOAL", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "DST blocked punt", eventType: "BLOCKED_PUNT", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "DST special-teams safety", eventType: "SPECIAL_TEAMS_SAFETY", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 6 },
  { label: "DST kickoff-return touchdown", eventType: "KICK_RETURN_TOUCHDOWN", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "DST punt-return touchdown", eventType: "PUNT_RETURN_TOUCHDOWN", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "DST blocked-kick return touchdown", eventType: "BLOCKED_KICK_RETURN_TOUCHDOWN", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "DST other special-teams touchdown", eventType: "OTHER_SPECIAL_TEAMS_TOUCHDOWN", positionScope: "DST", minYards: null, maxYards: null, flatPoints: 12 },
];
