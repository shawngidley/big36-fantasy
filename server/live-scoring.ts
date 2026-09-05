import type { CfbdGame, CfbdGamePlayerStatsGame, CfbdPlay, CfbdPlayStat, CfbdRosterAthlete } from "./cfbd";

export type LivePosition = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export type ScoringCandidate = { sourceEventKey: string; sourceGameId: number; schoolName: string; position: LivePosition; eventType: string; statValue: number; yardDistance: number | null; provisional: boolean; note: string };

const positionForRosterValue = (position: string | null | undefined): LivePosition | null => {
  // CFBD roster entries can carry a null position (walk-ons, incomplete records). Treat those as
  // "no scoring position" rather than crashing the entire refresh/audit for that school's game.
  if (!position) return null;
  const mapping: Record<string, LivePosition> = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", K: "K", P: "K" };
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
  const selectedDef = (schoolName: string) => input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(schoolName) && selection.position === "DST");
  const candidates: ScoringCandidate[] = [];
  if (game.awayPoints === 0 && selectedDef(game.homeTeam)) candidates.push({ sourceEventKey: `${game.id}:SHUTOUT:DST:${normalizeSchoolForComparison(game.homeTeam)}`, sourceGameId: game.id, schoolName: game.homeTeam, position: "DST", eventType: "SHUTOUT", statValue: 1, yardDistance: null, provisional, note: `CFBD final score · ${game.awayTeam} held scoreless` });
  if (game.homePoints === 0 && selectedDef(game.awayTeam)) candidates.push({ sourceEventKey: `${game.id}:SHUTOUT:DST:${normalizeSchoolForComparison(game.awayTeam)}`, sourceGameId: game.id, schoolName: game.awayTeam, position: "DST", eventType: "SHUTOUT", statValue: 1, yardDistance: null, provisional, note: `CFBD final score · ${game.homeTeam} held scoreless` });
  return candidates;
}

export function normalizeSchoolForComparison(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

// Keyed by STRING id. The roster feed returns athlete ids as strings while /plays/stats returns
// numbers; a Map keyed on the raw roster value never matched a stat's athleteId, which silently
// disabled every stat-based attribution path (only the play-text fallbacks were ever firing).
function positionByAthlete(roster: CfbdRosterAthlete[]) { return new Map(roster.map(athlete => [String(athlete.id), positionForRosterValue(athlete.position)])); }

const offensivePositions: LivePosition[] = ["QB", "RB", "WR", "TE"];
const normalizeText = (value: string | null | undefined) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// CFBD abbreviates a play-by-play first name to just enough letters to disambiguate teammates who
// share an initial - e.g. Miami's WR "Malachi Toney" appears as "Ma. Toney" because DB "Monroe
// Toney" is also on the roster. Checking only a single-letter abbreviation ("M Toney") matches
// neither and silently drops the catch. Every prefix length up to the full first name is tried, so
// the roster's own duplicate-initial teammates are exactly what makes this necessary.
function nameVariantsMatchText(text: string, firstName: string, lastName: string): boolean {
  const last = normalizeText(lastName);
  if (!last) return false;
  const first = normalizeText(firstName);
  if (first.length >= 3 && text.includes(` ${first} ${last} `)) return true;
  for (let length = 1; length <= first.length; length += 1) {
    if (text.includes(` ${first.slice(0, length)} ${last} `)) return true;
  }
  return false;
}

function positionsMentionedInText(playText: string | null | undefined, roster: CfbdRosterAthlete[], positions: Map<string, LivePosition | null>) {
  const text = ` ${normalizeText(playText)} `;
  const mentioned = new Set<LivePosition>();
  const matches = roster.filter(athlete => normalizeText(athlete.lastName ?? "").length >= 3 && nameVariantsMatchText(text, athlete.firstName ?? "", athlete.lastName ?? ""));
  // If the abbreviation is ambiguous (two teammates share it - shouldn't happen once CFBD's own
  // disambiguating letters are honored above, but a name shorter than what CFBD used could still
  // collide), prefer whichever athlete's fuller name variant actually appears, over a bare initial.
  const resolved = matches.length <= 1 ? matches : matches.filter(athlete => {
    const first = normalizeText(athlete.firstName ?? "");
    for (let length = 2; length <= first.length; length += 1) if (text.includes(` ${first.slice(0, length)} ${normalizeText(athlete.lastName ?? "")} `)) return true;
    return false;
  });
  for (const athlete of (resolved.length ? resolved : matches)) {
    const position = positions.get(String(athlete.id));
    if (position) mentioned.add(position);
  }
  return mentioned;
}

function passerPositionsInText(playText: string | null | undefined, roster: CfbdRosterAthlete[], positions: Map<string, LivePosition | null>) {
  const normalized = normalizeText(playText);
  const beforePass = ` ${normalized.split(" pass ")[0] ?? ""} `;
  const afterPassFrom = ` ${normalized.split(" pass from ")[1] ?? ""} `;
  const mentioned = new Set<LivePosition>();
  for (const athlete of roster) {
    const position = positions.get(String(athlete.id));
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

// CFBD frequently types a special-teams play by its OUTCOME ("Safety", "Fumble Return Touchdown")
// rather than by the kick, so the text is the only clue it was a punt/kickoff/field goal.
export function isSpecialTeamsPlay(playType: string | null | undefined, playText: string | null | undefined) {
  if (isSpecialTeamsPlayType(playType)) return true;
  const text = String(playText ?? "").toLowerCase();
  return /\b(punt|punts|punted|kickoff|kicks? off|field goal|muff|muffed)\b/.test(text);
}

// Kick distance: the text ("from 22 yards") is authoritative; fall back to yards-to-goal + 17
// (goal line to kicking spot), then to whatever CFBD put in yardsGained.
export function fieldGoalDistance(play: { playText?: string | null; yardsToGoal?: number | null; yardsGained?: number | null }): number | null {
  const fromText = /from (\d{1,2}) ?(?:yards?|yds?)/i.exec(String(play.playText ?? ""));
  if (fromText) return Number(fromText[1]);
  if (play.yardsToGoal != null && play.yardsToGoal > 0) return play.yardsToGoal + 17;
  return play.yardsGained ?? null;
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
  const athletePositionsFor = (matcher: (type: string) => boolean) => new Set(Array.from(statsByAthlete.entries()).flatMap(([athleteId, stats]) => matcher(stats.map(stat => stat.statType.toLowerCase()).join(" ")) ? [positions.get(String(athleteId))] : []).filter((position): position is LivePosition => Boolean(position)));
  const explicitTouchdownPositions = athletePositionsFor(type => type.includes("touchdown"));
  const passingTouchdownPositions = athletePositionsFor(type => type.includes("passing touchdown"));
  const rushingTouchdownPositions = athletePositionsFor(type => type.includes("rushing touchdown"));
  const isTwoPoint = /two[ -]?point/.test(`${playType} ${playTextNormalized}`);
  const isInvalidated = /(no play|nullified by penalty|reversed|overturned)/.test(`${playType} ${playTextNormalized}`);
  const isInterceptionReturn = playType.includes("interception");
  // CFBD uses a different playType when the fumble is returned for a touchdown ("Fumble Return
  // Touchdown") versus when it isn't ("Fumble Recovery (Opponent)") - both mean the offense lost
  // the fumble to the defense, but checking only one phrase (the original gap here) meant a
  // fumble-six correctly credited the defense's touchdown while never penalizing the offense for
  // losing the ball in the first place.
  const isFumbleLostToOpponent = playType.includes("fumble recovery (opponent)") || playType.includes("fumble return touchdown");
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
  const qbInterception = !isInvalidated && (scoringStats.some(stat => positions.get(String(stat.athleteId)) === "QB" && stat.statType.toLowerCase().includes("interception")) || (/interception/.test(playType) && passerPositions.has("QB")));
  if (qbInterception && eligibleSelection(schoolName, "QB")) candidates.push({ sourceEventKey: `${play.id}:INTERCEPTION_THROWN:QB`, sourceGameId: play.gameId, schoolName, position: "QB", eventType: "INTERCEPTION_THROWN", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · quarterback interception` });
  for (const stat of scoringStats) {
    const position = positions.get(String(stat.athleteId));
    const type = stat.statType.toLowerCase();
    // CFBD's actual stat category is just "Fumble" (the player who fumbled) - there is no separate
    // "Fumble Lost" category, so the previous check here (requiring both "fumble" and "lost" in the
    // stat type) could never match anything, ever. Cross-referencing with isFumbleLostToOpponent
    // (the play's own playType) confirms it was actually recovered by the other team, not the
    // fumbling player's own side, since a bare "Fumble" stat alone doesn't distinguish that.
    if (position && eligibleSelection(schoolName, position) && type === "fumble" && isFumbleLostToOpponent) candidates.push(statFor("FUMBLE_LOST", stat, position, schoolName));
  }
  // Like the defensive turnover credit, "(Opponent)" in the playType is an unambiguous signal that
  // the OFFENSE lost this fumble - independent of whether player-level stats reliably attribute it.
  // Only fires if the loop above (which has the real player, if the stat data was available) didn't
  // already credit someone, to avoid crediting a generic "mentioned" position twice.
  if (isFumbleLostToOpponent && !isInvalidated && !candidates.some(candidate => candidate.eventType === "FUMBLE_LOST" && candidate.schoolName === schoolName)) {
    const fumblingPosition = offensivePositions.find(position => mentionedPositions.has(position));
    if (fumblingPosition && eligibleSelection(schoolName, fumblingPosition)) candidates.push({ sourceEventKey: `${play.id}:FUMBLE_LOST:${fumblingPosition}`, sourceGameId: play.gameId, schoolName, position: fumblingPosition, eventType: "FUMBLE_LOST", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble lost (playType match)` });
  }
  const mentionsFieldGoal = playType.includes("field goal") || playTextNormalized.includes("field goal");
  const fieldGoalMissedOrBlocked = /(missed|no good|blocked)/.test(`${playType} ${playTextNormalized}`);
  if (eligibleSelection(schoolName, "K") && mentionsFieldGoal && !fieldGoalMissedOrBlocked) candidates.push({ sourceEventKey: `${play.id}:FIELD_GOAL:K`, sourceGameId: play.gameId, schoolName, position: "K", eventType: "FIELD_GOAL", statValue: 1, yardDistance: fieldGoalDistance(play), provisional, note: `CFBD play ${play.id} · made field goal` });
  if (eligibleSelection(schoolName, "K") && hasMadePat(play.playType, play.playText)) candidates.push({ sourceEventKey: `${play.id}:EXTRA_POINT:K`, sourceGameId: play.gameId, schoolName, position: "K", eventType: "EXTRA_POINT", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · made PAT` });
  const defensiveSchool = play.defense;
  const defensiveStats = input.stats.filter(stat => normalizeSchoolForComparison(stat.team) === normalizeSchoolForComparison(defensiveSchool) && Number(stat.stat) !== 0);
  const playText = `${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase();
  const specialTeamsPlay = isSpecialTeamsPlay(play.playType, play.playText);
  const defensiveCandidate = (eventType: string, stat: CfbdPlayStat, position: LivePosition, distance: number | null = null) => ({ sourceEventKey: `${play.id}:${eventType}:${stat.athleteId}`, sourceGameId: play.gameId, schoolName: defensiveSchool, position, eventType, statValue: 1, yardDistance: distance, provisional, note: `CFBD play ${play.id} · ${stat.statType}` } satisfies ScoringCandidate);
  const unitCandidate = (eventType: string, position: "K" | "DST", note: string) => ({ sourceEventKey: `${play.id}:${eventType}`, sourceGameId: play.gameId, schoolName: defensiveSchool, position, eventType, statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · ${note}` } satisfies ScoringCandidate);
  const specialTeamsCandidate = (eventType: string) => unitCandidate(eventType, "DST", "special teams event");
  // "field goal attempt from 45 yards BLOCKED" / "punt ... BLOCKED by" - the words are rarely adjacent.
  const blockedFieldGoal = /blocked[^.]*field goal|field goal[^.]*blocked/.test(playText);
  const blockedPunt = !blockedFieldGoal && /blocked[^.]*punt|punt[^.]*blocked/.test(playText);
  if (eligibleSelection(defensiveSchool, "DST") && blockedFieldGoal) candidates.push(specialTeamsCandidate("BLOCKED_FIELD_GOAL"));
  if (eligibleSelection(defensiveSchool, "DST") && blockedPunt) candidates.push(specialTeamsCandidate("BLOCKED_PUNT"));
  if (playText.includes("safety")) {
    // The team that scored the safety is whoever's score moved; the play's defense otherwise.
    const safetySchool = play.scoringTeam && [schoolName, defensiveSchool].includes(play.scoringTeam) ? play.scoringTeam : defensiveSchool;
    const safetyCandidate = (eventType: string, position: "K" | "DST", note: string) => ({ ...unitCandidate(eventType, position, note), schoolName: safetySchool });
    if (specialTeamsPlay && eligibleSelection(safetySchool, "DST")) candidates.push(safetyCandidate("SPECIAL_TEAMS_SAFETY", "DST", "special teams safety"));
    if (!specialTeamsPlay && eligibleSelection(safetySchool, "DST")) candidates.push(safetyCandidate("DEFENSIVE_SAFETY", "DST", "defensive safety"));
  }
  for (const stat of defensiveStats) {
    const type = stat.statType.toLowerCase();
    if (eligibleSelection(defensiveSchool, "DST") && type.includes("sack")) candidates.push(defensiveCandidate("SACK", stat, "DST"));
    // "Fumble Recovery" is not a real CFBD stat category for defensive players (confirmed: only
    // "Fumble" and "Fumble Forced" exist) - checking for it here could never match. Fumble
    // recoveries are correctly handled below via the playType-based fallback instead.
    if (eligibleSelection(defensiveSchool, "DST") && type.includes("interception")) candidates.push(defensiveCandidate("DEFENSIVE_TURNOVER", stat, "DST"));
    if (play.scoring && !specialTeamsPlay && eligibleSelection(defensiveSchool, "DST") && type.includes("touchdown")) candidates.push(defensiveCandidate("DEFENSIVE_TOUCHDOWN", stat, "DST", play.yardsGained ?? null));
  }
  // A pick-six or fumble-return touchdown is reliably flagged by the play mentioning both a
  // turnover (interception, or "(Opponent)" fumble recovery) AND "touchdown" - independent of
  // whether player-level stats exist yet, the same weakness already fixed for sacks/turnovers.
  if (!specialTeamsPlay && eligibleSelection(defensiveSchool, "DST") && !isInvalidated && (isInterceptionReturn || isFumbleLostToOpponent) && (playType.includes("touchdown") || playTextNormalized.includes("touchdown")) && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === defensiveSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TOUCHDOWN:playtype`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DST", eventType: "DEFENSIVE_TOUCHDOWN", statValue: 1, yardDistance: play.yardsGained ?? null, provisional, note: `CFBD play ${play.id} · defensive touchdown (playType match)` });
  }
  // A fumble recovery is reliably flagged on the play's own playType (e.g. "Fumble Recovery
  // (Opponent)" or "Fumble Return Touchdown") independent of whether a matching player-level stat
  // row exists for it - CFBD's stat attribution for fumbles isn't always reliable, so this catches
  // recoveries the loop above would otherwise miss entirely. Must check specifically for the
  // opponent recovering it - a generic "fumble recovery" match would also fire on "Fumble Recovery
  // (Own)", wrongly crediting the defense for a fumble the offense recovered themselves.
  if (eligibleSelection(defensiveSchool, "DST") && isFumbleLostToOpponent && !isInvalidated && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TURNOVER" && candidate.schoolName === defensiveSchool) && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === defensiveSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TURNOVER:playtype`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DST", eventType: "DEFENSIVE_TURNOVER", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble recovery (playType match)` });
  }
  // Live play data has no player-level stats to drive the loop above (only the final, post-game feed
  // does) — so defensive credit needs a text-based fallback here too, the same way offensive
  // touchdowns already do. Only fires when no structured stat already matched, to avoid double-crediting
  // once official stats do become available after the game.
  if (defensiveStats.length === 0 && eligibleSelection(defensiveSchool, "DST")) {
    const isSackPlay = /\bsack(ed)?\b/.test(playText) && !isInvalidated;
    // Interceptions are reliably flagged by playType alone. Fumbles are left to the final,
    // stats-based pass — play text alone can't reliably tell which team recovered a fumble, so a
    // text-only fumble check here would be too unreliable to trust; better a short delay than a
    // wrong credit.
    const isTurnoverPlay = isInterceptionReturn && !isInvalidated;
    if (isSackPlay) candidates.push({ sourceEventKey: `${play.id}:SACK:unit`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DST", eventType: "SACK", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · sack (text match)` });
    if (isTurnoverPlay) candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TURNOVER:unit`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DST", eventType: "DEFENSIVE_TURNOVER", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · turnover (text match)` });
  }
  const typedSpecialTeamsTd = specialTeamsTouchdownType(play.playType);
  const untypedSpecialTeamsTd = !typedSpecialTeamsTd && specialTeamsPlay && /touchdown|\btd\b/.test(playText) && !playText.includes("no play");
  const specialTeamType = typedSpecialTeamsTd ?? (untypedSpecialTeamsTd ? "OTHER_SPECIAL_TEAMS_TOUCHDOWN" : null);
  if (specialTeamType) {
    // Credit the team whose score actually moved. Without that signal, the returning side is the
    // play's DEFENSE (the kicking/punting team is listed as offense), never the offense.
    const returningSchool = play.scoringTeam && [schoolName, defensiveSchool].includes(play.scoringTeam) ? play.scoringTeam : defensiveSchool;
    if (eligibleSelection(returningSchool, "DST")) candidates.push({ sourceEventKey: `${play.id}:${specialTeamType}`, sourceGameId: play.gameId, schoolName: returningSchool, position: "DST", eventType: specialTeamType, statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · special teams return (${play.scoringTeam ? "by score change" : "defense of kicking team"})` });
  }
  // For auditing: attach the actual CFBD play description verbatim, not just our own generated
  // summary, so anyone reviewing a scored play (a touchdown especially) can see exactly what
  // happened without needing to re-fetch raw CFBD data.
  const withPlayText = play.playText ? candidates.map(candidate => ({ ...candidate, note: `${candidate.note} — "${play.playText!.trim()}"` })) : candidates;
  return uniqueCandidates(withPlayText);
}

// Fumbles lost from the per-game box score (/games/players -> "fumbles" -> "LOST"). This is the
// actual "lost" stat straight from the box, whereas the play feed only has a bare "Fumble" credit
// that frequently isn't attributed to any player at all. Used at end-of-game reconciliation as the
// authoritative source; one candidate per drafted slot with statValue = fumbles lost by that
// position group, minus anything the play feed already wrote for the same slot+game.
const normalizePersonName = (value: string | null | undefined) => String(value ?? "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]+/g, " ").trim();

// Resolve a box-score athlete to a roster entry. IDs are compared as strings (the roster feed and the
// box score do not agree on numeric vs string ids), with a normalized first+last name fallback.
export function matchBoxAthleteToRoster(athlete: { id: string; name: string }, roster: CfbdRosterAthlete[]): CfbdRosterAthlete | undefined {
  const byId = roster.find(entry => String(entry.id) === String(athlete.id));
  if (byId) return byId;
  const wanted = normalizePersonName(athlete.name);
  if (!wanted) return undefined;
  return roster.find(entry => normalizePersonName(`${entry.firstName ?? ""} ${entry.lastName ?? ""}`) === wanted);
}

// Fumbles lost from the per-game box score (/games/players -> "fumbles" -> "LOST"). This is the
// actual "lost" stat straight from the box, whereas the play feed only has a bare "Fumble" credit
// that frequently isn't attributed to any player at all. Used at end-of-game reconciliation as the
// authoritative source; one candidate per drafted slot with statValue = fumbles lost by that
// position group, minus anything the play feed already wrote for the same slot+game.
export function boxScoreFumbleCandidates(input: { gameId: number; school: string; box: CfbdGamePlayerStatsGame | undefined; roster: CfbdRosterAthlete[]; selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition }>; alreadyWrittenBySlot: Map<LivePosition, number> }): { available: boolean; candidates: ScoringCandidate[] } {
  const team = input.box?.teams.find(entry => normalizeSchoolForComparison(entry.team) === normalizeSchoolForComparison(input.school));
  if (!team) return { available: false, candidates: [] };
  // A team with no fumbles has no "fumbles" category at all - that's a real zero, not missing data.
  const lost = team.categories.find(category => category.name === "fumbles")?.types.find(type => type.name === "LOST");
  const bySlot = new Map<LivePosition, { count: number; names: string[] }>();
  for (const athlete of lost?.athletes ?? []) {
    const count = Number(athlete.stat);
    if (Number(athlete.id) <= 0 || !Number.isFinite(count) || count <= 0) continue; // negative ids are the " Team" bucket
    const position = positionForRosterValue(matchBoxAthleteToRoster(athlete, input.roster)?.position);
    if (!position || !offensivePositions.includes(position)) continue;
    const entry = bySlot.get(position) ?? { count: 0, names: [] };
    entry.count += count; entry.names.push(`${athlete.name.trim()} x${count}`);
    bySlot.set(position, entry);
  }
  const candidates: ScoringCandidate[] = [];
  for (const [position, entry] of Array.from(bySlot.entries())) {
    if (!input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(input.school) && selection.position === position)) continue;
    const shortfall = entry.count - (input.alreadyWrittenBySlot.get(position) ?? 0);
    if (shortfall <= 0) continue;
    candidates.push({ sourceEventKey: `${input.gameId}:FUMBLE_LOST:${position}:box`, sourceGameId: input.gameId, schoolName: input.school, position, eventType: "FUMBLE_LOST", statValue: shortfall, yardDistance: null, provisional: false, note: `CFBD box score · fumbles lost (${entry.names.join(", ")})` });
  }
  return { available: true, candidates };
}
