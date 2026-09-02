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

export function isSupersededInterceptionPlay(play: CfbdPlay, nextPlay: CfbdPlay | undefined) {
  const isInterception = /interception/i.test(String(play.playType ?? ""));
  const sameClock = play.period === nextPlay?.period && play.clock?.minutes === nextPlay?.clock?.minutes && play.clock?.seconds === nextPlay?.clock?.seconds;
  return Boolean(isInterception && nextPlay && play.gameId === nextPlay.gameId && play.driveId && play.driveId === nextPlay.driveId && play.offense === nextPlay.offense && sameClock && !/interception/i.test(String(nextPlay.playType ?? "")) && Number(nextPlay.playNumber ?? 0) > Number(play.playNumber ?? 0));
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

function passerPositionsInText(playText: string | null | undefined, roster: CfbdRosterAthlete[], positions: Map<number, LivePosition | null>) {
  const normalized = normalizeText(playText);
  const beforePass = ` ${normalized.split(" pass ")[0] ?? ""} `;
  const afterPassFrom = ` ${normalized.split(" pass from ")[1] ?? ""} `;
  const mentioned = new Set<LivePosition>();
  for (const athlete of roster) {
    const position = positions.get(athlete.id);
    const name = normalizeText(`${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`);
    const shortName = normalizeText(`${String(athlete.firstName ?? "").slice(0, 1)} ${athlete.lastName ?? ""}`);
    if (position && ((name.length >= 5 && (beforePass.includes(` ${name} `) || afterPassFrom.includes(` ${name} `))) || (shortName.length >= 3 && (beforePass.includes(` ${shortName} `) || afterPassFrom.includes(` ${shortName} `))))) mentioned.add(position);
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
  const failed = /(no good|missed|failed|blocked)/.test(`${type} ${text}`);
  if (failed) return false;
  if (type.includes("extra point") || type.includes("pat")) return true;
  // A made PAT is very commonly appended to the same play text as the touchdown itself. This can
  // show up as "...kick attempt good..." / "...kick is good..." outside any parentheses, or as a
  // bare "(PlayerName KICK)" inside parentheses - support both, guarded by the failure check above.
  if (text.includes("kick attempt good") || text.includes("kick is good")) return true;
  return /\([^)]*\bkick\b[^)]*\)/.test(text);
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
  const playTextNormalized = normalizeText(play.playText);
  const mentionedPositions = positionsMentionedInText(play.playText, roster, positions);
  const passerPositions = passerPositionsInText(play.playText, roster, positions);
  const athletePositionsFor = (matcher: (type: string) => boolean) => new Set(Array.from(statsByAthlete.entries()).flatMap(([athleteId, stats]) => matcher(stats.map(stat => stat.statType.toLowerCase()).join(" ")) ? [positions.get(athleteId)] : []).filter((position): position is LivePosition => Boolean(position)));
  const explicitTouchdownPositions = athletePositionsFor(type => type.includes("touchdown"));
  const passingTouchdownPositions = athletePositionsFor(type => type.includes("passing touchdown"));
  const rushingTouchdownPositions = athletePositionsFor(type => type.includes("rushing touchdown"));
  const isTwoPoint = /two[ -]?point/.test(`${playType} ${playTextNormalized}`);
  const isInvalidated = /(no play|nullified by penalty|reversed|overturned)/.test(`${playType} ${playTextNormalized}`);
  const isInterceptionReturn = playType.includes("interception");
  const hasOffensiveTouchdownText = /(touchdown|\btd\b)/.test(`${playType} ${playTextNormalized}`);
  const passingTouchdown = !isTwoPoint && !isInvalidated && !isInterceptionReturn && (passingTouchdownPositions.has("QB") || (explicitTouchdownPositions.has("QB") && athletePositionsFor(type => type.includes("reception")).size > 0) || (hasOffensiveTouchdownText && /\bpass\b/.test(`${playType} ${playTextNormalized}`)));
  const rushingTouchdown = !isTwoPoint && !isInvalidated && !passingTouchdown && (rushingTouchdownPositions.size > 0 || (hasOffensiveTouchdownText && /\b(rush\w*|run)\b/.test(`${playType} ${playTextNormalized}`)));
  const scoringDistance = play.yardsToGoal ?? null;
  const offensiveCandidate = (position: LivePosition, eventType: "TOUCHDOWN" | "TWO_POINT_CONVERSION") => {
    if (!eligibleSelection(schoolName, position)) return;
    candidates.push({ sourceEventKey: `${play.id}:${eventType}:${position}`, sourceGameId: play.gameId, schoolName, position, eventType, statValue: 1, yardDistance: eventType === "TOUCHDOWN" ? scoringDistance : null, provisional, note: `CFBD play ${play.id} · ${eventType.toLowerCase().replace(/_/g, " ")}` });
  };
  if (passingTouchdown) {
    const qbSource = passingTouchdownPositions.has("QB") || (explicitTouchdownPositions.has("QB") && athletePositionsFor(type => type.includes("reception")).size > 0) || passerPositions.has("QB");
    if (qbSource) offensiveCandidate("QB", "TOUCHDOWN");
    const scorer = offensivePositions.filter(position => position !== "QB" && explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => position !== "QB" && athletePositionsFor(type => type.includes("reception")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => position !== "QB" && mentionedPositions.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  } else if (rushingTouchdown) {
    const scorer = offensivePositions.filter(position => rushingTouchdownPositions.has(position) || explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => mentionedPositions.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  }
  // Like PATs, CFBD frequently gives a two-point conversion attempt a generic playType (just "Rush"
  // or "Pass Reception") and only mentions "two-point conversion" in the play text itself - checking
  // playType alone (the original bug here) misses these entirely.
  const twoPointMentioned = /two.point conversion/.test(playType) || /two.point conversion/.test(playTextNormalized) || /two point (pass|rush)/.test(playType);
  const twoPointFailed = /(failed|fail|no good|incomplete|unsuccessful)/.test(playTextNormalized);
  const successfulTwoPoint = twoPointMentioned && !twoPointFailed && !isInvalidated;
  if (successfulTwoPoint) {
    const isPassPlay = playType.includes("pass") || playTextNormalized.includes("pass");
    if (isPassPlay) {
      const qbSource = athletePositionsFor(type => type.includes("completion") || type.includes("pass")).has("QB") || mentionedPositions.has("QB");
      if (qbSource) offensiveCandidate("QB", "TWO_POINT_CONVERSION");
      const scorer = offensivePositions.filter(position => position !== "QB" && (athletePositionsFor(type => type.includes("reception")).has(position) || mentionedPositions.has(position)));
      scorer.forEach(position => offensiveCandidate(position, "TWO_POINT_CONVERSION"));
    } else {
      const scorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position) || mentionedPositions.has(position));
      scorer.forEach(position => offensiveCandidate(position, "TWO_POINT_CONVERSION"));
    }
  }
  const qbInterception = !isInvalidated && (scoringStats.some(stat => positions.get(stat.athleteId) === "QB" && stat.statType.toLowerCase().includes("interception")) || (/interception/.test(playType) && passerPositions.has("QB")));
  if (qbInterception && eligibleSelection(schoolName, "QB")) candidates.push({ sourceEventKey: `${play.id}:INTERCEPTION_THROWN:QB`, sourceGameId: play.gameId, schoolName, position: "QB", eventType: "INTERCEPTION_THROWN", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · quarterback interception` });
  for (const stat of scoringStats) {
    const position = positions.get(stat.athleteId);
    const type = stat.statType.toLowerCase();
    if (position && eligibleSelection(schoolName, position) && type.includes("fumble") && type.includes("lost")) candidates.push(statFor("FUMBLE_LOST", stat, position, schoolName));
  }
  // Like the defensive turnover credit, "(Opponent)" in the playType is an unambiguous signal that
  // the OFFENSE lost this fumble - independent of whether player-level stats reliably attribute it.
  // Only fires if the loop above (which has the real player, if the stat data was available) didn't
  // already credit someone, to avoid crediting a generic "mentioned" position twice.
  if (playType.includes("fumble recovery (opponent)") && !isInvalidated && !candidates.some(candidate => candidate.eventType === "FUMBLE_LOST" && candidate.schoolName === schoolName)) {
    const fumblingPosition = offensivePositions.find(position => mentionedPositions.has(position));
    if (fumblingPosition && eligibleSelection(schoolName, fumblingPosition)) candidates.push({ sourceEventKey: `${play.id}:FUMBLE_LOST:${fumblingPosition}`, sourceGameId: play.gameId, schoolName, position: fumblingPosition, eventType: "FUMBLE_LOST", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble lost (playType match)` });
  }
  const mentionsFieldGoal = playType.includes("field goal") || playTextNormalized.includes("field goal");
  const fieldGoalMissedOrBlocked = /(missed|no good|blocked)/.test(`${playType} ${playTextNormalized}`);
  if (eligibleSelection(schoolName, "K_ST") && mentionsFieldGoal && !fieldGoalMissedOrBlocked) candidates.push({ sourceEventKey: `${play.id}:FIELD_GOAL:K_ST`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: "FIELD_GOAL", statValue: 1, yardDistance: play.yardsGained ?? null, provisional, note: `CFBD play ${play.id} · made field goal` });
  if (eligibleSelection(schoolName, "K_ST") && hasMadePat(play.playType, play.playText)) candidates.push({ sourceEventKey: `${play.id}:EXTRA_POINT:K_ST`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: "EXTRA_POINT", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · made PAT` });
  const defensiveSchool = play.defense;
  const defensiveStats = input.stats.filter(stat => normalizeSchoolForComparison(stat.team) === normalizeSchoolForComparison(defensiveSchool) && Number(stat.stat) !== 0);
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
  // A pick-six or fumble-return touchdown is reliably flagged by the play mentioning both a
  // turnover (interception, or "(Opponent)" fumble recovery) AND "touchdown" - independent of
  // whether player-level stats exist yet, the same weakness already fixed for sacks/turnovers.
  if (!specialTeamsPlay && eligibleSelection(defensiveSchool, "DEF") && !isInvalidated && (isInterceptionReturn || playType.includes("fumble recovery (opponent)")) && (playType.includes("touchdown") || playTextNormalized.includes("touchdown")) && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === defensiveSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TOUCHDOWN:playtype`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DEF", eventType: "DEFENSIVE_TOUCHDOWN", statValue: 1, yardDistance: play.yardsGained ?? null, provisional, note: `CFBD play ${play.id} · defensive touchdown (playType match)` });
  }
  // A fumble recovery is reliably flagged on the play's own playType (e.g. "Fumble Recovery
  // (Opponent)") independent of whether a matching player-level stat row exists for it - CFBD's
  // stat attribution for fumbles isn't always reliable, so this catches recoveries the loop above
  // would otherwise miss entirely, without needing to wait for or depend on player-level stats.
  if (eligibleSelection(defensiveSchool, "DEF") && playType.includes("fumble recovery") && !isInvalidated && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TURNOVER" && candidate.schoolName === defensiveSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TURNOVER:playtype`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DEF", eventType: "DEFENSIVE_TURNOVER", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble recovery (playType match)` });
  }
  // Live play data has no player-level stats to drive the loop above (only the final, post-game feed
  // does) — so defensive credit needs a text-based fallback here too, the same way offensive
  // touchdowns already do. Only fires when no structured stat already matched, to avoid double-crediting
  // once official stats do become available after the game.
  if (defensiveStats.length === 0 && eligibleSelection(defensiveSchool, "DEF")) {
    const isSackPlay = /\bsack(ed)?\b/.test(playText) && !isInvalidated;
    // Interceptions are reliably flagged by playType alone. Fumbles are left to the final,
    // stats-based pass — play text alone can't reliably tell which team recovered a fumble, so a
    // text-only fumble check here would be too unreliable to trust; better a short delay than a
    // wrong credit.
    const isTurnoverPlay = isInterceptionReturn && !isInvalidated;
    if (isSackPlay) candidates.push({ sourceEventKey: `${play.id}:SACK:unit`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DEF", eventType: "SACK", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · sack (text match)` });
    if (isTurnoverPlay) candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TURNOVER:unit`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DEF", eventType: "DEFENSIVE_TURNOVER", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · turnover (text match)` });
  }
  const specialTeamType = specialTeamsTouchdownType(play.playType);
  if (specialTeamType && eligibleSelection(schoolName, "K_ST")) {
    candidates.push({ sourceEventKey: `${play.id}:${specialTeamType}`, sourceGameId: play.gameId, schoolName, position: "K_ST", eventType: specialTeamType, statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · special teams return` });
  }
  return uniqueCandidates(candidates);
}
