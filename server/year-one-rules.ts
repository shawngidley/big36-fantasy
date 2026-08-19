import type { Position, ScoringEventType } from "../drizzle/schema";

export type YearOneRule = { label: string; eventType: ScoringEventType; positionScope: "ALL" | Position; minYards: number | null; maxYards: number | null; flatPoints: number };

const offensivePositions = ["QB", "RB", "WR", "TE"] as const;
const touchdownRules = (position: (typeof offensivePositions)[number]): YearOneRule[] => {
  const [short, medium, long, explosive] = position === "TE" ? [12, 16, 20, 24] : [6, 8, 10, 12];
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
  { label: "K/ST made PAT", eventType: "EXTRA_POINT", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 1 },
  { label: "K/ST field goal 10–29 yards", eventType: "FIELD_GOAL", positionScope: "K_ST", minYards: 10, maxYards: 29, flatPoints: 3 },
  { label: "K/ST field goal 30–39 yards", eventType: "FIELD_GOAL", positionScope: "K_ST", minYards: 30, maxYards: 39, flatPoints: 6 },
  { label: "K/ST field goal 40–49 yards", eventType: "FIELD_GOAL", positionScope: "K_ST", minYards: 40, maxYards: 49, flatPoints: 9 },
  { label: "K/ST field goal 50+ yards", eventType: "FIELD_GOAL", positionScope: "K_ST", minYards: 50, maxYards: null, flatPoints: 12 },
  { label: "K/ST blocked field goal", eventType: "BLOCKED_FIELD_GOAL", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "K/ST blocked punt", eventType: "BLOCKED_PUNT", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "K/ST special-teams safety", eventType: "SPECIAL_TEAMS_SAFETY", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 6 },
  { label: "K/ST kickoff-return touchdown", eventType: "KICK_RETURN_TOUCHDOWN", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "K/ST punt-return touchdown", eventType: "PUNT_RETURN_TOUCHDOWN", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "K/ST blocked-kick return touchdown", eventType: "BLOCKED_KICK_RETURN_TOUCHDOWN", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "K/ST other special-teams touchdown", eventType: "OTHER_SPECIAL_TEAMS_TOUCHDOWN", positionScope: "K_ST", minYards: null, maxYards: null, flatPoints: 12 },
  { label: "DEF sack", eventType: "SACK", positionScope: "DEF", minYards: null, maxYards: null, flatPoints: 1 },
  { label: "DEF turnover", eventType: "DEFENSIVE_TURNOVER", positionScope: "DEF", minYards: null, maxYards: null, flatPoints: 3 },
  { label: "DEF safety", eventType: "DEFENSIVE_SAFETY", positionScope: "DEF", minYards: null, maxYards: null, flatPoints: 6 },
  { label: "DEF touchdown return 1–19 yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DEF", minYards: 1, maxYards: 19, flatPoints: 9 },
  { label: "DEF touchdown return 20–59 yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DEF", minYards: 20, maxYards: 59, flatPoints: 12 },
  { label: "DEF touchdown return 60+ yards", eventType: "DEFENSIVE_TOUCHDOWN", positionScope: "DEF", minYards: 60, maxYards: null, flatPoints: 15 },
  { label: "DEF shutout", eventType: "SHUTOUT", positionScope: "DEF", minYards: null, maxYards: null, flatPoints: 15 },
];
