import type { CfbdGame, CfbdPlay, CfbdPlayStat, CfbdRosterAthlete } from "./cfbd";

export type LivePosition = "QB" | "RB" | "WR" | "TE" | "K_ST" | "DEF";
export type ScoringCandidate = { sourceEventKey: string; sourceGameId: number; schoolName: string; position: LivePosition; eventType: string; statValue: number; yardDistance: number | null; provisional: boolean; note: string };

const positionForRosterValue = (position: string): LivePosition | null => {
  const mapping: Record<string, LivePosition> = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", K: "K_ST", P: "K_ST" };
  return mapping[position.toUpperCase()] ?? null;
};

export function eligibleGameIdsForSchool(games: CfbdGame[], schoolName: string) {
  return games.filter(game => game.seasonType.toLowerCase() === "regular" && (game.homeTeam === schoolName || game.awayTeam === schoolName)).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime() || a.id - b.id).slice(0, 12).map(game => game.id);
}

export function gameCountsForSchool(games: CfbdGame[], schoolName: string, gameId: number) {
  return eligibleGameIdsForSchool(games, schoolName).includes(gameId);
}

export function normalizeSchoolForComparison(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

function positionByAthlete(roster: CfbdRosterAthlete[]) { return new Map(roster.map(athlete => [athlete.id, positionForRosterValue(athlete.position)])); }

function isPassTouchdown(stats: CfbdPlayStat[], positions: Map<number, LivePosition | null>) {
  return stats.some(stat => positions.get(stat.athleteId) === "QB" && /touchdown|pass/i.test(stat.statType)) && stats.some(stat => ["RB", "WR", "TE"].includes(positions.get(stat.athleteId) ?? "") && /touchdown|reception|rush/i.test(stat.statType));
}

export function mapLivePlayToCandidates(input: { play: CfbdPlay; stats: CfbdPlayStat[]; roster: CfbdRosterAthlete[]; selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition }>; provisional?: boolean }): ScoringCandidate[] {
  const { play, roster } = input;
  const provisional = input.provisional ?? true;
  const positions = positionByAthlete(roster);
  const eligibleSelection = (schoolName: string, position: LivePosition) => input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(schoolName) && selection.position === position);
  const statFor = (eventType: string, stat: CfbdPlayStat, position: LivePosition, schoolName: string, distance: number | null = null): ScoringCandidate => ({ sourceEventKey: `${play.id}:${eventType}:${stat.athleteId}`, sourceGameId: play.gameId, schoolName, position, eventType, statValue: 1, yardDistance: distance, provisional, note: `CFBD play ${play.id} · ${stat.statType}` });
  const candidates: ScoringCandidate[] = [];
  const schoolName = play.offense;
  const scoringStats = input.stats.filter(stat => Number(stat.stat) !== 0);
  if (play.scoring) {
    const scoringDistance = play.yardsToGoal ?? null;
    const passTd = isPassTouchdown(scoringStats, positions);
    const scoringAthletes = scoringStats.filter(stat => /touchdown|reception|rush/i.test(stat.statType));
    for (const stat of scoringAthletes) {
      const position = positions.get(stat.athleteId);
      if (position && ["QB", "RB", "WR", "TE"].includes(position) && eligibleSelection(schoolName, position)) candidates.push(statFor("TOUCHDOWN", stat, position, schoolName, scoringDistance));
    }
    if (passTd) {
      const qbStat = scoringStats.find(stat => positions.get(stat.athleteId) === "QB");
      if (qbStat && eligibleSelection(schoolName, "QB") && !candidates.some(candidate => candidate.position === "QB")) candidates.push(statFor("TOUCHDOWN", qbStat, "QB", schoolName, scoringDistance));
    }
  }
  for (const stat of scoringStats) {
    const position = positions.get(stat.athleteId);
    const type = stat.statType.toLowerCase();
    if (position && eligibleSelection(schoolName, position) && type.includes("two point")) candidates.push(statFor("TWO_POINT_CONVERSION", stat, position, schoolName));
    if (position === "QB" && eligibleSelection(schoolName, "QB") && type.includes("interception")) candidates.push(statFor("INTERCEPTION_THROWN", stat, "QB", schoolName));
    if (position && eligibleSelection(schoolName, position) && type.includes("fumble") && type.includes("lost")) candidates.push(statFor("FUMBLE_LOST", stat, position, schoolName));
    if (position === "K_ST" && eligibleSelection(schoolName, "K_ST") && type.includes("field goal") && /made|good/i.test(stat.statType)) candidates.push(statFor("FIELD_GOAL", stat, "K_ST", schoolName, play.yardsToGoal ?? null));
    if (position === "K_ST" && eligibleSelection(schoolName, "K_ST") && type.includes("extra point") && /made|good/i.test(stat.statType)) candidates.push(statFor("EXTRA_POINT", stat, "K_ST", schoolName));
  }
  return candidates;
}
