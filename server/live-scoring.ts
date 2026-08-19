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

export function finalShutoutCandidates(input: { game: CfbdGame; selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition }>; provisional?: boolean }): ScoringCandidate[] {
  const { game } = input;
  if (!game.completed) return [];
  const provisional = input.provisional ?? false;
  const selectedDef = (schoolName: string) => input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(schoolName) && selection.position === "DEF");
  const candidates: ScoringCandidate[] = [];
  if (game.awayPoints === 0 && selectedDef(game.homeTeam)) candidates.push({ sourceEventKey: `${game.id}:SHUTOUT:DEF:${normalizeSchoolForComparison(game.homeTeam)}`, sourceGameId: game.id, schoolName: game.homeTeam, position: "DEF", eventType: "SHUTOUT", statValue: 1, yardDistance: null, provisional, note: `CFBD final score · ${game.awayTeam} held scoreless` });
  if (game.homePoints === 0 && selectedDef(game.awayTeam)) candidates.push({ sourceEventKey: `${game.id}:SHUTOUT:DEF:${normalizeSchoolForComparison(game.awayTeam)}`, sourceGameId: game.id, schoolName: game.awayTeam, position: "DEF", eventType: "SHUTOUT", statValue: 1, yardDistance: null, provisional, note: `CFBD final score · ${game.homeTeam} held scoreless` });
  return candidates;
}

export function normalizeSchoolForComparison(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

function positionByAthlete(roster: CfbdRosterAthlete[]) { return new Map(roster.map(athlete => [athlete.id, positionForRosterValue(athlete.position)])); }

const offensivePositions: LivePosition[] = ["QB", "RB", "WR", "TE"];
const normalizeText = (value: string | null | undefined) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function positionsMentionedInText(playText: string | null | undefined, roster: CfbdRosterAthlete[], positions: Map<number, LivePosition | null>) {
  const text = ` ${normalizeText(playText)} `;
  const mentioned = new Set<LivePosition>();
  for (const athlete of roster) {
    const position = positions.get(athlete.id);
    const name = normalizeText(`${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`);
    const shortName = normalizeText(`${String(athlete.firstName ?? "").slice(0, 1)} ${athlete.lastName ?? ""}`);
    if (position && ((name.length >= 5 && text.includes(` ${name} `)) || (shortName.length >= 3 && text.includes(` ${shortName} `)))) mentioned.add(position);
  }
  return mentioned;
}

function uniqueCandidates(candidates: ScoringCandidate[]) {
  return Array.from(new Map(candidates.map(candidate => [candidate.sourceEventKey, candidate])).values());
}

export function specialTeamsTouchdownType(playType: string | null | undefined) {
  const type = String(playType ?? "").toLowerCase();
  if (!/(touchdown|\btd\b)/.test(type)) return null;
  if (type.includes("kickoff return")) return "KICK_RETURN_TOUCHDOWN";
  if (type.includes("punt return")) return "PUNT_RETURN_TOUCHDOWN";
  if (type.includes("blocked") && (type.includes("kick") || type.includes("punt") || type.includes("field goal"))) return "BLOCKED_KICK_RETURN_TOUCHDOWN";
  if (type.includes("return") && (type.includes("kick") || type.includes("punt") || type.includes("field goal"))) return "OTHER_SPECIAL_TEAMS_TOUCHDOWN";
  return null;
}

export function isSpecialTeamsPlayType(playType: string | null | undefined) {
  const type = String(playType ?? "").toLowerCase();
  return type.includes("kickoff") || type.includes("punt") || type.includes("field goal") || type.includes("extra point") || type.includes("pat") || type.includes("blocked kick");
}

export function hasMadePat(playType: string | null | undefined, playText: string | null | undefined) {
  const type = String(playType ?? "").toLowerCase();
  const text = String(playText ?? "").toLowerCase();
  if (type.includes("extra point good") || type.includes("pat good")) return true;
  return /(touchdown|\btd\b)/.test(type) && /\([^)]*\bkick\b[^)]*\)/.test(text) && !/(no good|missed|failed)/.test(text);
}

export function mapLivePlayToCandidates(input: { play: CfbdPlay; stats: CfbdPlayStat[]; roster: CfbdRosterAthlete[]; selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition }>; provisional?: boolean }): ScoringCandidate[] {
  const { play, roster } = input;
  const provisional = input.provisional ?? true;
  const positions = positionByAthlete(roster);
  const eligibleSelection = (schoolName: string, position: LivePosition) => input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(schoolName) && selection.position === position);
  const statFor = (eventType: string, stat: CfbdPlayStat, position: LivePosition, schoolName: string, distance: number | null = null): ScoringCandidate => ({ sourceEventKey: `${play.id}:${eventType}:${stat.athleteId}`, sourceGameId: play.gameId, schoolName, position, eventType, statValue: 1, yardDistance: distance, provisional, note: `CFBD play ${play.id} · ${stat.statType}` });
  const candidates: ScoringCandidate[] = [];
  const schoolName = play.offense;
  const scoringStats = input.stats.filter(stat => normalizeSchoolForComparison(stat.team) === normalizeSchoolForComparison(schoolName) && Number(stat.stat) !== 0);
  const statsByAthlete = new Map<number, CfbdPlayStat[]>();
  for (const stat of scoringStats) statsByAthlete.set(stat.athleteId, [...(statsByAthlete.get(stat.athleteId) ?? []), stat]);
  const playType = String(play.playType ?? "").toLowerCase();
  const mentionedPositions = positionsMentionedInText(play.playText, roster, positions);
  const athletePositionsFor = (matcher: (type: string) => boolean) => new Set(Array.from(statsByAthlete.entries()).flatMap(([athleteId, stats]) => matcher(stats.map(stat => stat.statType.toLowerCase()).join(" ")) ? [positions.get(athleteId)] : []).filter((position): position is LivePosition => Boolean(position)));
  const explicitTouchdownPositions = athletePositionsFor(type => type.includes("touchdown"));
  const passingTouchdown = play.scoring && (playType.includes("passing touchdown") || athletePositionsFor(type => type.includes("passing touchdown")).has("QB"));
  const rushingTouchdown = play.scoring && (playType.includes("rushing touchdown") || athletePositionsFor(type => type.includes("rushing touchdown")).size > 0);
  const scoringDistance = play.yardsToGoal ?? null;
  const offensiveCandidate = (position: LivePosition, eventType: "TOUCHDOWN" | "TWO_POINT_CONVERSION") => {
    if (!eligibleSelection(schoolName, position)) return;
    candidates.push({ sourceEventKey: `${play.id}:${eventType}:${position}`, sourceGameId: play.gameId, schoolName, position, eventType, statValue: 1, yardDistance: eventType === "TOUCHDOWN" ? scoringDistance : null, provisional, note: `CFBD play ${play.id} · ${eventType.toLowerCase().replace(/_/g, " ")}` });
  };
  if (passingTouchdown) {
    const qbSource = explicitTouchdownPositions.has("QB") || athletePositionsFor(type => type.includes("completion") || type.includes("passing touchdown")).has("QB") || mentionedPositions.has("QB");
    if (qbSource) offensiveCandidate("QB", "TOUCHDOWN");
    const scorer = offensivePositions.filter(position => position !== "QB" && explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => position !== "QB" && athletePositionsFor(type => type.includes("reception")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => position !== "QB" && mentionedPositions.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  } else if (rushingTouchdown) {
    const scorer = offensivePositions.filter(position => explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => mentionedPositions.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  }
  const successfulTwoPoint = /two point (pass|rush)/.test(playType) && !/(failed|fail|no good|incomplete)/.test(normalizeText(play.playText));
  if (successfulTwoPoint) {
    if (playType.includes("pass")) {
      const qbSource = athletePositionsFor(type => type.includes("completion") || type.includes("pass")).has("QB") || mentionedPositions.has("QB");
      if (qbSource) offensiveCandidate("QB", "TWO_POINT_CONVERSION");
      const scorer = offensivePositions.filter(position => position !== "QB" && (athletePositionsFor(type => type.includes("reception")).has(position) || mentionedPositions.has(position)));
      scorer.forEach(position => offensiveCandidate(position, "TWO_POINT_CONVERSION"));
    } else {
      const scorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position) || mentionedPositions.has(position));
      scorer.forEach(position => offensiveCandidate(position, "TWO_POINT_CONVERSION"));
    }
  }
  for (const stat of scoringStats) {
    const position = positions.get(stat.athleteId);
    const type = stat.statType.toLowerCase();
    if (position === "QB" && eligibleSelection(schoolName, "QB") && type.includes("interception")) candidates.push(statFor("INTERCEPTION_THROWN", stat, "QB", schoolName));
    if (position && eligibleSelection(schoolName, position) && type.includes("fumble") && type.includes("lost")) candidates.push(statFor("FUMBLE_LOST", stat, position, schoolName));
  }
  if (eligibleSelection(schoolName, "K_ST") && (playType.includes("field goal good") || playType.includes("made field goal"))) candidates.push({ sourceEventKey: `${play.id}:FIELD_GOAL:K_ST`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: "FIELD_GOAL", statValue: 1, yardDistance: play.yardsGained ?? null, provisional, note: `CFBD play ${play.id} · made field goal` });
  if (eligibleSelection(schoolName, "K_ST") && hasMadePat(play.playType, play.playText)) candidates.push({ sourceEventKey: `${play.id}:EXTRA_POINT:K_ST`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: "EXTRA_POINT", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · made PAT` });
  const defensiveSchool = play.defense;
  const defensiveStats = scoringStats.filter(stat => normalizeSchoolForComparison(stat.team) === normalizeSchoolForComparison(defensiveSchool));
  const playText = `${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase();
  const specialTeamsPlay = isSpecialTeamsPlayType(play.playType);
  const defensiveCandidate = (eventType: string, stat: CfbdPlayStat, position: LivePosition, distance: number | null = null) => ({ sourceEventKey: `${play.id}:${eventType}:${stat.athleteId}`, sourceGameId: play.gameId, schoolName: defensiveSchool, position, eventType, statValue: 1, yardDistance: distance, provisional, note: `CFBD play ${play.id} · ${stat.statType}` } satisfies ScoringCandidate);
  const unitCandidate = (eventType: string, position: "K_ST" | "DEF", note: string) => ({ sourceEventKey: `${play.id}:${eventType}`, sourceGameId: play.gameId, schoolName: defensiveSchool, position, eventType, statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · ${note}` } satisfies ScoringCandidate);
  const specialTeamsCandidate = (eventType: string) => unitCandidate(eventType, "K_ST", "special teams event");
  if (eligibleSelection(defensiveSchool, "K_ST") && (playText.includes("blocked field goal") || playText.includes("field goal blocked"))) candidates.push(specialTeamsCandidate("BLOCKED_FIELD_GOAL"));
  if (eligibleSelection(defensiveSchool, "K_ST") && (playText.includes("blocked punt") || playText.includes("punt blocked"))) candidates.push(specialTeamsCandidate("BLOCKED_PUNT"));
  if (playText.includes("safety")) {
    if (specialTeamsPlay && eligibleSelection(defensiveSchool, "K_ST")) candidates.push(specialTeamsCandidate("SPECIAL_TEAMS_SAFETY"));
    if (!specialTeamsPlay && eligibleSelection(defensiveSchool, "DEF")) candidates.push(unitCandidate("DEFENSIVE_SAFETY", "DEF", "defensive safety"));
  }
  for (const stat of defensiveStats) {
    const type = stat.statType.toLowerCase();
    if (eligibleSelection(defensiveSchool, "DEF") && type.includes("sack")) candidates.push(defensiveCandidate("SACK", stat, "DEF"));
    if (eligibleSelection(defensiveSchool, "DEF") && (type.includes("interception") || type.includes("fumble recovery"))) candidates.push(defensiveCandidate("DEFENSIVE_TURNOVER", stat, "DEF"));
    if (play.scoring && !specialTeamsPlay && eligibleSelection(defensiveSchool, "DEF") && type.includes("touchdown")) candidates.push(defensiveCandidate("DEFENSIVE_TOUCHDOWN", stat, "DEF", play.yardsGained ?? null));
  }
  const specialTeamType = specialTeamsTouchdownType(play.playType);
  if (specialTeamType && eligibleSelection(schoolName, "K_ST")) {
    candidates.push({ sourceEventKey: `${play.id}:${specialTeamType}`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: specialTeamType, statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · special teams return` });
  }
  return uniqueCandidates(candidates);
}
