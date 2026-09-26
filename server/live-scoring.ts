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

// CFBD's /plays/stats for a whole week is tens of thousands of rows (several per play, across every
// FBS game), and every scoring loop in this codebase used to look up a play's stats with
// `stats.filter(stat => String(stat.playId) === String(play.id))` - a full scan of that array, with
// two String() allocations per row, once PER PLAY. Measured at realistic week-2 scale (10,400 plays /
// 41,600 stat rows / 28 relevant games): ~22 seconds of pure CPU per pass on a fast machine, and
// Vercel's function CPU is slower. That single line was the dominant cost behind the main gameday
// loop needing time-budget cutoffs, reconcileWeekFromFinalData only fitting 2-5 games per call, and
// fullScoringAudit 504ing even after its I/O was batched. Building this index once per fetched
// stats array turns every per-play lookup into O(1) - the same 28-game pass takes ~6ms.
// Keys are String(playId) on purpose: /plays ids are numbers, /plays/stats ids can come back as
// either, and the old filter's String()-both-sides matching is preserved exactly.
export type PlayStatsIndex = Map<string, CfbdPlayStat[]>;
export function indexPlayStatsByPlayId(stats: CfbdPlayStat[]): PlayStatsIndex {
  const index: PlayStatsIndex = new Map();
  for (const stat of stats) {
    const key = String(stat.playId);
    const bucket = index.get(key);
    if (bucket) bucket.push(stat); else index.set(key, [stat]);
  }
  return index;
}
export function statsForPlay(index: PlayStatsIndex, play: { id: number | string }): CfbdPlayStat[] {
  return index.get(String(play.id)) ?? [];
}

export function eligibleGameIdsForSchool(games: CfbdGame[], schoolName: string) {
  const normalizedSchool = normalizeSchoolForComparison(schoolName);
  return games.filter(game => game.seasonType.toLowerCase() === "regular" && (normalizeSchoolForComparison(game.homeTeam) === normalizedSchool || normalizeSchoolForComparison(game.awayTeam) === normalizedSchool)).sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime() || a.id - b.id).slice(0, 12).map(game => game.id);
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
// Stripping every non-ASCII character outright (the original behavior here) doesn't just drop
// punctuation - it deletes the letter entirely for any accented name, e.g. "Öhrström" became
// "hrstr m" (each accented letter replaced by a bare separator, splitting the surname across a
// stray space). Real SMU/UC Davis plays: two of TE Öhrström's touchdowns went completely uncredited
// because the roster's own name for him didn't collapse to the same mangled string CFBD's play text
// produced (whichever of the two spells it with the diaeresis and whichever doesn't, "hrstr m" from
// one side never matches the other's normalized form). Unicode-normalizing to NFD and stripping only
// COMBINING marks first transliterates "Öhrström" to "Ohrstrom" before the ASCII-only filter runs,
// so both the accented and plain-ASCII spellings of the same name now normalize identically and
// match each other regardless of which source (roster vs. CFBD's play-by-play text) uses the accent.
const normalizeText = (value: string | null | undefined) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// CFBD abbreviates a play-by-play first name to just enough letters to disambiguate teammates who
// share an initial - e.g. Miami's WR "Malachi Toney" appears as "Ma. Toney" because DB "Monroe
// Toney" is also on the roster. Checking only a single-letter abbreviation ("M Toney") matches
// neither and silently drops the catch. Every prefix length up to the full first name is tried, so
// the roster's own duplicate-initial teammates are exactly what makes this necessary.
// CFBD's play-by-play text almost always drops generational suffixes (Jr., Sr., II, III, IV) even
// when the roster's own lastName carries one. Stripping the suffix before matching either name is
// what lets these otherwise-correct roster entries actually match real play text.
const stripGenerationalSuffix = (value: string) => value.replace(/\b(jr|sr|ii|iii|iv)\b/g, "").trim().replace(/\s+/g, " ");

// A defensive/turnover-return touchdown's actual return distance is what CFBD's play text
// explicitly states ("...return 55 yards to the...") - the generic play.yardsGained field reflects
// the OFFENSE's net yardage on the play, which is typically null, zero, or meaningless on a
// turnover return, causing DEFENSIVE_TOUCHDOWN's yard-banded scoring rules to never match anything.
function extractReturnYards(playText: string | null | undefined): number | null {
  const match = normalizeText(playText).match(/return (\d+) yards?/);
  return match ? Number(match[1]) : null;
}

function nameVariantsMatchText(text: string, firstName: string, lastName: string): boolean {
  const last = stripGenerationalSuffix(normalizeText(lastName));
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
    for (let length = 2; length <= first.length; length += 1) if (text.includes(` ${first.slice(0, length)} ${stripGenerationalSuffix(normalizeText(athlete.lastName ?? ""))} `)) return true;
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
    const name = stripGenerationalSuffix(normalizeText(`${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`));
    const shortName = stripGenerationalSuffix(normalizeText(`${String(athlete.firstName ?? "").slice(0, 1)} ${athlete.lastName ?? ""}`));
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
  // CFBD's final-data feed sometimes condenses a touchdown AND its own conversion attempt into one
  // line with no literal "touchdown" word at all - playType alone ("Rushing Touchdown"/"Passing
  // Touchdown") is the only signal, e.g. "Charles Robinson 8 Yd pass from Jackson Gutierrez
  // (Two-Point Run Conversion Failed)" or "Jackson Gutierrez 49 Yd Run (Jackson Gutierrez Pass to Vic
  // Listorti for Two-Point Conversion)" - both real Navy plays. A bare text search for "two point"
  // matched the trailing conversion clause and set isTwoPoint true for the WHOLE play, which
  // suppressed passingTouchdown/rushingTouchdown below and dropped the touchdown itself - the
  // touchdown-vs-conversion split logic a few lines down (beforeTouchdown/afterTouchdown) only works
  // when the literal word "touchdown" appears in playText to split on, which these condensed lines
  // never contain. When playType (or playText) already declares this play a touchdown, a "two point"
  // mention elsewhere in the same text describes the SEPARATE conversion attempt, not this play's own
  // type, so it must not disable touchdown detection for it.
  //
  // The playTextNormalized.includes("touchdown") branch is deliberately the weaker, overridable
  // signal here: this feed demonstrably concatenates a scoring play's text onto LATER, unrelated
  // plays (see the "kick attempt"/"pat attempt" scoping a few lines down), so a genuinely standalone
  // two-point-attempt play could inherit a stray "touchdown" mention from a PRECEDING play's leaked
  // text even though playType correctly and unambiguously identifies this play as its own two-point
  // attempt. playType is CFBD's own structured classification of THIS play, not a free-text blob that
  // can carry over another play's wording, so it must win outright whenever it explicitly says this
  // play is a two-point attempt - no text-based "touchdown" mention should be able to override that.
  const playTypeDeclaresTwoPoint = /two[ -]?point conversion/.test(playType) || /two[ -]?point (pass|rush)/.test(playType);
  const playAlreadyDeclaresTouchdown = !playTypeDeclaresTwoPoint && (playType.includes("touchdown") || playTextNormalized.includes("touchdown"));
  const isTwoPoint = !playAlreadyDeclaresTouchdown && /two[ -]?point/.test(`${playType} ${playTextNormalized}`);
  // CFBD often concatenates a scoring play with LATER, unrelated sub-events into one text blob -
  // e.g. a touchdown followed by a penalized PAT retry that itself ends in "NO PLAY". The touchdown
  // itself is only actually nullified when the invalidation phrase directly follows it (same
  // clause, e.g. "...for a touchdown nullified by penalty"); once a "kick attempt" marker appears
  // after the touchdown, everything past that point describes the SEPARATE PAT/2pt attempt and its
  // own penalty history, which must not retroactively void an already-completed score. For plays
  // that never mention "touchdown" at all this is a no-op and every other check is unaffected.
  const [beforeTouchdown, ...afterTouchdownParts] = playTextNormalized.split(/touchdown/);
  // Who actually scored is named right before "touchdown" appears in CFBD's text; text AFTER it
  // often describes a SEPARATE subsequent event (most commonly a PAT or two-point conversion
  // attempt, frequently involving a completely different player). The broader mentionedPositions
  // set (scanning the whole play text) doesn't distinguish these, so when there's no structured stat
  // data to fall back on, any player mentioned ANYWHERE - including in that later, unrelated clause -
  // could get wrongly credited with the touchdown itself. Real Kansas State play: Avery Johnson (QB)
  // ran for the touchdown, but Linkon Cure (TE) - named only in the following two-point-attempt
  // clause - got credited instead, since TE was the drafted position and QB wasn't.
  const mentionedPositionsBeforeTouchdown = positionsMentionedInText(beforeTouchdown, roster, positions);
  const afterTouchdown = afterTouchdownParts.join("touchdown");
  // Also cut at "pass attempt"/"rush attempt" - CFBD's other vocabulary for a two-point conversion
  // attempt (see twoPointMentioned below) - not just "kick attempt"/"pat attempt"/"point attempt".
  // Real Old Dominion/Virginia Tech play: a 76-yard rushing touchdown was followed, in the SAME play
  // block, by two penalized (and correctly voided) two-point pass attempts each ending in "NO PLAY",
  // before the conversion was finally successfully run in. Without this cutoff, "NO PLAY" from those
  // nullified RETRY attempts bled back into isInvalidated below and wrongly voided the touchdown
  // itself, which had already legitimately happened and was never in question.
  const relevantAfterTouchdown = afterTouchdown.split(/kick attempt|pat attempt|point attempt|pass attempt|rush attempt/)[0] ?? "";
  const invalidationScopedText = playTextNormalized.includes("touchdown") ? `${beforeTouchdown} touchdown ${relevantAfterTouchdown}` : playTextNormalized;
  const overturnedIndex = playTextNormalized.search(/overturned/);
  // "Overturned" is uniquely context-dependent, unlike the other invalidation words: CFBD's text
  // always states the CONFIRMED, final result first, then explains the review, so a real event
  // (a touchdown, a fumble/recovery, OR an interception) already described before "overturned" means
  // the review CONFIRMED that event by overturning an earlier, different original call - not voided
  // it. Only treat "overturned" as invalidating when no such confirmed event appears before that
  // word. Real Indiana play (Hoover to Marsh) was a confirmed TD wrongly nullified by this ambiguity;
  // real Texas A&M play (Horton fumble, recovered by Missouri State) was a confirmed turnover with
  // the exact same problem; real Texas Tech play (Hammond intercepted by Wilcox, originally ruled
  // incomplete/broken up) was a confirmed interception with the same ambiguity a third time.
  const overturnedConfirmsRealEvent = overturnedIndex >= 0 && /(touchdown|fumbled|intercepted)/.test(playTextNormalized.slice(0, overturnedIndex));
  const isInvalidated = /(no play|nullified by penalty|reversed)/.test(`${playType} ${invalidationScopedText}`) || (/overturned/.test(invalidationScopedText) && !overturnedConfirmsRealEvent);
  // CFBD sometimes labels the playType by whatever ELSE happened on the play (here, a penalty on the
  // return) rather than the interception itself, even though the text clearly describes one. Real
  // Portland State/SDSU play: "pass intercepted by #14 I.Green ... PENALTY SDSU Unsportsmanlike
  // Conduct" was typed "Penalty," making the interception invisible to a playType-only check.
  const isInterceptionReturn = playType.includes("interception") || /\bintercepted\b/.test(playTextNormalized);
  // CFBD uses a different playType when the fumble is returned for a touchdown ("Fumble Return
  // Touchdown") versus when it isn't ("Fumble Recovery (Opponent)") - both mean the offense lost
  // the fumble to the defense, but checking only one phrase (the original gap here) meant a
  // fumble-six correctly credited the defense's touchdown while never penalizing the offense for
  // losing the ball in the first place.
  // A muffed kickoff/punt return (the returner fails to control the catch) uses "muffed" in CFBD's
  // text rather than "fumble," and the playType is often just "Kickoff"/"Punt" rather than a clean
  // "Fumble Recovery (Opponent)" tag - so this was invisible to the playType-only check above. Real
  // Notre Dame/Wisconsin play: "muffed by #32 H.Bortolotti ... recovered by UND #43 K.Kia" was a
  // genuine takeaway that went completely undetected.
  const isMuffedReturn = /muffed/.test(playTextNormalized) && /recovered by/.test(playTextNormalized);
  // A reception (or run) that's THEN fumbled and recovered by someone else BEFORE the word
  // "touchdown" appears means the ball changed hands before anyone scored - the original
  // catch/pass has nothing to do with who actually reached the end zone. Without this check, the
  // generic passing/rushing-touchdown text fallback saw "pass ... touchdown" and wrongly credited
  // the original passer AND receiver, even though the receiver fumbled and the DEFENSE recovered
  // and scored. Real FAMU play: Coleman's completed pass to Burton, Burton fumbled, FAMU's McKenzie
  // recovered and ran it in - both Coleman and Burton were wrongly credited a passing touchdown
  // while FAMU's real defensive score went completely uncredited.
  // "own player"/"'s own" is CFBD's phrasing for a self-recovery in SOME feeds, but not all - real
  // Clemson play: "...fumbled by #12 B.Wesco Jr. at GS16 recovered by CLEM #12 B.Wesco Jr. at
  // (#4 A.Bynum)" names the fumbling team (CLEM, the offense itself) and the EXACT SAME jersey
  // number as both fumbler and recoverer, with no "own player" wording at all - so the phrase check
  // alone missed it, and a player recovering his own fumble got wrongly scored as a -3 FUMBLE_LOST
  // against his own team. Comparing the jersey number named right after "fumbled by" to the one
  // named right after "recovered by" catches this regardless of CFBD's exact wording: a genuine
  // turnover is always recovered by a DIFFERENT player (a different jersey number), so this can only
  // fire on an actual self-recovery, never suppress a real one.
  // beforeTouchdown is derived from playTextNormalized, which has already stripped every "#" (and
  // all other punctuation) down to a single space via normalizeText - so "#12" has already become
  // just "12" by this point, with no "#" left to match against. "fumbled by" is USUALLY followed
  // immediately by the jersey number, but CFBD's final-data feed also renders this same event as
  // "fumble by" (no "d") - real Old Dominion/Virginia Tech play 401858221174: "...fumble by #10
  // Q.Henicle recovered by Hokies #1 T.Flowers... TOUCHDOWN" is a genuine fumble recovered by the
  // OPPONENT and returned for a defensive score, but the literal "fumbled" (and "fumbled by") checks
  // below never matched "fumble by", so this play was invisible to both the FUMBLE_LOST credit for
  // Henicle and the DEFENSIVE_TOUCHDOWN/DEFENSIVE_TURNOVER credit for Virginia Tech - on top of
  // playType itself wrongly saying "Fumble Recovery (Own)" for a fumble the text clearly shows
  // recovered by the other team. "recovered by" is followed by a team abbreviation (letters only, no
  // digits) before its own jersey number, so \D*? skips past that non-numeric team code to reach it.
  const fumblerJerseyNumber = beforeTouchdown.match(/fumbled? by\s+(\d+)/)?.[1];
  const recovererJerseyNumber = beforeTouchdown.match(/recovered by\D*?(\d+)/)?.[1];
  const recoveredBySameJerseyNumber = Boolean(fumblerJerseyNumber && recovererJerseyNumber && fumblerJerseyNumber === recovererJerseyNumber);
  const fumbleChangedPossessionBeforeTouchdown = /fumble/.test(beforeTouchdown) && /recovered by/.test(beforeTouchdown) && !/(own player|'s own)/.test(beforeTouchdown) && !recoveredBySameJerseyNumber;
  const isFumbleLostToOpponent = playType.includes("fumble recovery (opponent)") || playType.includes("fumble return touchdown") || isMuffedReturn || fumbleChangedPossessionBeforeTouchdown;
  const hasOffensiveTouchdownText = /(touchdown|\btd\b)/.test(`${playType} ${playTextNormalized}`);
  // The final /pass/ fallback below must be scoped to the text BEFORE "touchdown" specifically -
  // otherwise a rushing touchdown followed by an unrelated pass-based PAT/2pt attempt (a different
  // player entirely) gets wrongly classified as a passing touchdown. Real Vanderbilt play: Alexander
  // (RB) ran for the score, but Berlowitz's (QB) failed two-point PASS attempt afterward matched this
  // generic check against the whole text, wrongly routing the touchdown credit to QB instead of RB.
  const passingTouchdown = !isTwoPoint && !isInvalidated && !isInterceptionReturn && !fumbleChangedPossessionBeforeTouchdown && (passingTouchdownPositions.has("QB") || (explicitTouchdownPositions.has("QB") && athletePositionsFor(type => type.includes("reception")).size > 0) || (hasOffensiveTouchdownText && /\bpass\b/.test(`${playType} ${beforeTouchdown}`)));
  const rushingTouchdown = !isTwoPoint && !isInvalidated && !passingTouchdown && !fumbleChangedPossessionBeforeTouchdown && (rushingTouchdownPositions.size > 0 || (hasOffensiveTouchdownText && /\b(rush\w*|run)\b/.test(`${playType} ${playTextNormalized}`)));
  const scoringDistance = play.yardsToGoal ?? null;
  const offensiveCandidate = (position: LivePosition, eventType: "TOUCHDOWN" | "TWO_POINT_CONVERSION") => {
    if (!eligibleSelection(schoolName, position)) return;
    candidates.push({ sourceEventKey: `${play.id}:${eventType}:${position}`, sourceGameId: play.gameId, schoolName, position, eventType, statValue: 1, yardDistance: eventType === "TOUCHDOWN" ? scoringDistance : null, provisional, note: `CFBD play ${play.id} · ${eventType.toLowerCase().replace(/_/g, " ")}` });
  };
  if (passingTouchdown) {
    const qbSource = passingTouchdownPositions.has("QB") || (explicitTouchdownPositions.has("QB") && athletePositionsFor(type => type.includes("reception")).size > 0) || passerPositions.has("QB");
    if (qbSource) {
      offensiveCandidate("QB", "TOUCHDOWN");
    } else {
      // No QB evidence at all (no stats, no text mention) - if the text specifically identifies a
      // real, non-QB passer (a trick play: an RB or WR throwing it), credit that player's own
      // position rather than either defaulting to QB or dropping the pass side of the play entirely.
      Array.from(passerPositions).filter(position => position !== "QB").forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
    }
    const scorer = offensivePositions.filter(position => position !== "QB" && explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => position !== "QB" && athletePositionsFor(type => type.includes("reception")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => position !== "QB" && mentionedPositionsBeforeTouchdown.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  } else if (rushingTouchdown) {
    const scorer = offensivePositions.filter(position => rushingTouchdownPositions.has(position) || explicitTouchdownPositions.has(position));
    const legacyScorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position));
    const positionsToCredit = scorer.length > 0 ? scorer : legacyScorer.length > 0 ? legacyScorer : offensivePositions.filter(position => mentionedPositionsBeforeTouchdown.has(position));
    positionsToCredit.forEach(position => offensiveCandidate(position, "TOUCHDOWN"));
  }
  // Like PATs, CFBD frequently gives a two-point conversion attempt a generic playType (just "Rush"
  // or "Pass Reception") and only mentions "two-point conversion" in the play text itself - checking
  // playType alone (the original bug here) misses these entirely.
  // CFBD sometimes describes a two-point attempt combined in the SAME play block as the touchdown
  // itself, using a completely different vocabulary ("[Player] rush/pass attempt Successful/Failed")
  // rather than the phrase "two point conversion" - real Kansas State play: after Johnson's TD, "#0
  // L.Cure rush attempt Successful" is a made two-point conversion that went entirely undetected.
  const twoPointMentioned = /two.point conversion/.test(playType) || /two.point conversion/.test(playTextNormalized) || /two point (pass|rush)/.test(playType) || /\b(rush|pass) attempt (successful|failed)\b/.test(playTextNormalized);
  // CFBD replays a penalized two-point attempt as its own "[Player] rush/pass attempt Failed" clause,
  // immediately followed by another retry, when a flag (offsetting or declined) voids the previous
  // snap - real Old Dominion/Virginia Tech play had TWO penalized, voided pass attempts (each ending
  // "NO PLAY") before the conversion was actually run in successfully. A bare search for "failed"
  // anywhere in the text found those two earlier, voided attempts and wrongly called the whole
  // conversion failed even though it succeeded on the very next, legitimate try. When the text
  // contains at least one explicit "attempt successful/failed" marker, only the LAST one - the actual
  // final outcome, since every earlier one was a nullified retry - decides success or failure; the
  // broader word search remains as a fallback for text that never uses this "attempt" phrasing at all
  // (e.g. "two-point conversion failed").
  const attemptOutcomes = Array.from(playTextNormalized.matchAll(/\b(?:rush|pass) attempt (successful|failed)\b/g));
  const lastAttemptOutcome = attemptOutcomes.length > 0 ? attemptOutcomes[attemptOutcomes.length - 1][1] : null;
  const twoPointFailed = lastAttemptOutcome ? lastAttemptOutcome === "failed" : /(failed|fail|no good|incomplete|unsuccessful)/.test(playTextNormalized);
  const successfulTwoPoint = twoPointMentioned && !twoPointFailed && !isInvalidated;
  // When this play ALSO contains a touchdown (the combined case above), the two-point attempt's own
  // scorer is named in the text after "touchdown" - scoping to just that portion avoids crediting the
  // touchdown's own scorer (a different player) for the separate two-point attempt too. A standalone
  // two-point play (no touchdown mentioned in the same text) has no such competing name to worry
  // about, so it keeps using the full, unscoped set as before.
  const mentionedPositionsForTwoPoint = playTextNormalized.includes("touchdown") ? positionsMentionedInText(afterTouchdown, roster, positions) : mentionedPositions;
  if (successfulTwoPoint) {
    const isPassPlay = playType.includes("pass") || playTextNormalized.includes("pass");
    if (isPassPlay) {
      const qbSource = athletePositionsFor(type => type.includes("completion") || type.includes("pass")).has("QB") || mentionedPositionsForTwoPoint.has("QB");
      if (qbSource) offensiveCandidate("QB", "TWO_POINT_CONVERSION");
      const scorer = offensivePositions.filter(position => position !== "QB" && (athletePositionsFor(type => type.includes("reception")).has(position) || mentionedPositionsForTwoPoint.has(position)));
      scorer.forEach(position => offensiveCandidate(position, "TWO_POINT_CONVERSION"));
    } else {
      const scorer = offensivePositions.filter(position => athletePositionsFor(type => type.includes("rush")).has(position) || mentionedPositionsForTwoPoint.has(position));
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
    // "fumbled by X" names the actual player who lost it - on a completed-pass-then-fumble play,
    // BOTH the passer and the receiver are mentioned in the same text, and picking "whichever
    // offensive position appears anywhere" always favored the QB (first in position order) even
    // when it was the receiver who fumbled after the catch. Checking specifically the text after
    // "fumbled by" identifies the real fumbler; only falls back to the broader (less precise) check
    // when that phrase isn't present in the text at all. Splits on the same "fumbled? by" variant
    // fumbleChangedPossessionBeforeTouchdown now matches, since CFBD also renders this as "fumble by"
    // (no "d") in some final-data text.
    const fumblerSegment = playTextNormalized.split(/fumbled? by/)[1] ?? "";
    const fumblerMentionedPositions = fumblerSegment ? positionsMentionedInText(fumblerSegment, roster, positions) : new Set<LivePosition>();
    const fumblingPosition = offensivePositions.find(position => fumblerMentionedPositions.has(position)) ?? offensivePositions.find(position => mentionedPositions.has(position));
    if (fumblingPosition && eligibleSelection(schoolName, fumblingPosition)) candidates.push({ sourceEventKey: `${play.id}:FUMBLE_LOST:${fumblingPosition}`, sourceGameId: play.gameId, schoolName, position: fumblingPosition, eventType: "FUMBLE_LOST", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble lost (playType match)` });
  }
  const mentionsFieldGoal = playType.includes("field goal") || playTextNormalized.includes("field goal");
  const fieldGoalMissedOrBlocked = /(missed|no good|blocked)/.test(`${playType} ${playTextNormalized}`);
  if (eligibleSelection(schoolName, "K") && mentionsFieldGoal && !fieldGoalMissedOrBlocked && !isInvalidated) candidates.push({ sourceEventKey: `${play.id}:FIELD_GOAL:K`, sourceGameId: play.gameId, schoolName, position: "K", eventType: "FIELD_GOAL", statValue: 1, yardDistance: fieldGoalDistance(play), provisional, note: `CFBD play ${play.id} · made field goal` });
  // A PAT following a return touchdown (kickoff/punt/blocked-kick return) is bundled into the same
  // play as the score itself, and CFBD lists the KICKING team as "offense" on that play - meaning
  // schoolName here is the kicking team, not whoever actually scored and would attempt the PAT.
  // scoringTeam (derived from which side's score moved) resolves this the same way the return-TD
  // credit itself does; for a normal offensive-drive PAT, scoringTeam already equals schoolName, so
  // this is a no-op there.
  const patSchool = play.scoringTeam && [schoolName, play.defense].includes(play.scoringTeam) ? play.scoringTeam : schoolName;
  if (eligibleSelection(patSchool, "K") && hasMadePat(play.playType, play.playText)) candidates.push({ sourceEventKey: `${play.id}:EXTRA_POINT:K`, sourceGameId: play.gameId, schoolName: patSchool, position: "K", eventType: "EXTRA_POINT", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · made PAT` });
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
  if (eligibleSelection(defensiveSchool, "DST") && blockedFieldGoal && !isInvalidated) candidates.push(specialTeamsCandidate("BLOCKED_FIELD_GOAL"));
  if (eligibleSelection(defensiveSchool, "DST") && blockedPunt) candidates.push(specialTeamsCandidate("BLOCKED_PUNT"));
  if (playText.includes("safety")) {
    // The team that scored the safety is whoever's score moved; the play's defense otherwise.
    const safetySchool = play.scoringTeam && [schoolName, defensiveSchool].includes(play.scoringTeam) ? play.scoringTeam : defensiveSchool;
    const safetyCandidate = (eventType: string, position: "K" | "DST", note: string) => ({ ...unitCandidate(eventType, position, note), schoolName: safetySchool });
    if (specialTeamsPlay && eligibleSelection(safetySchool, "DST")) candidates.push(safetyCandidate("SPECIAL_TEAMS_SAFETY", "DST", "special teams safety"));
    if (!specialTeamsPlay && eligibleSelection(safetySchool, "DST")) candidates.push(safetyCandidate("DEFENSIVE_SAFETY", "DST", "defensive safety"));
  }
  // A sack CFBD splits between two players (a "half sack" each) generates a separate per-athlete
  // stat record for each - crediting every one of them separately double-counts what is really ONE
  // sack event. Seen four times with real data today (Texas, Georgia, LSU, Florida). Track whether
  // this play has already been credited a sack and skip any further per-athlete sack stat for it.
  let sackAlreadyCreditedForPlay = false;
  for (const stat of defensiveStats) {
    const type = stat.statType.toLowerCase();
    if (eligibleSelection(defensiveSchool, "DST") && type.includes("sack")) {
      if (!sackAlreadyCreditedForPlay) { candidates.push(defensiveCandidate("SACK", stat, "DST")); sackAlreadyCreditedForPlay = true; }
      continue;
    }
    // "Fumble Recovery" is not a real CFBD stat category for defensive players (confirmed: only
    // "Fumble" and "Fumble Forced" exist) - checking for it here could never match. Fumble
    // recoveries are correctly handled below via the playType-based fallback instead.
    if (eligibleSelection(defensiveSchool, "DST") && type.includes("interception")) candidates.push(defensiveCandidate("DEFENSIVE_TURNOVER", stat, "DST"));
    if (play.scoring && !specialTeamsPlay && eligibleSelection(defensiveSchool, "DST") && type.includes("touchdown")) candidates.push(defensiveCandidate("DEFENSIVE_TOUCHDOWN", stat, "DST", extractReturnYards(play.playText) ?? play.yardsGained ?? null));
  }
  // A pick-six or fumble-return touchdown is reliably flagged by the play mentioning both a
  // turnover (interception, or "(Opponent)" fumble recovery) AND "touchdown" - independent of
  // whether player-level stats exist yet, the same weakness already fixed for sacks/turnovers.
  // Requiring play.scoring (an actual home/away score delta on this play, computed independently
  // of any text) is load-bearing, not redundant: CFBD's live play text for a play under booth
  // review keeps embedding the ORIGINAL, since-overturned call in a "(Original Play: ...)"
  // parenthetical even after the ruling is corrected. Real Ole Miss/Charlotte play: an
  // interception was originally ruled a 76-yard pick-six, then overturned on review to a 38-yard
  // return only - but the final play text still contains "... TOUCHDOWN, clock 00:04)" from the
  // reversed original call, which wrongly credited Ole Miss's DST a defensive touchdown that
  // officially never happened (confirmed against CFBD's own final score: no defensive/special
  // teams touchdown appears anywhere in Ole Miss's box score for that game). The stat-based branch
  // two lines above already gates on play.scoring for exactly this reason; this text-only fallback
  // had the same exposure without the same guard.
  if (play.scoring && !specialTeamsPlay && eligibleSelection(defensiveSchool, "DST") && !isInvalidated && (isInterceptionReturn || isFumbleLostToOpponent) && (playType.includes("touchdown") || playTextNormalized.includes("touchdown")) && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === defensiveSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TOUCHDOWN:playtype`, sourceGameId: play.gameId, schoolName: defensiveSchool, position: "DST", eventType: "DEFENSIVE_TOUCHDOWN", statValue: 1, yardDistance: extractReturnYards(play.playText) ?? play.yardsGained ?? null, provisional, note: `CFBD play ${play.id} · defensive touchdown (playType match)` });
  }
  // A fumble recovery is reliably flagged on the play's own playType (e.g. "Fumble Recovery
  // (Opponent)" or "Fumble Return Touchdown") independent of whether a matching player-level stat
  // row exists for it - CFBD's stat attribution for fumbles isn't always reliable, so this catches
  // recoveries the loop above would otherwise miss entirely. Must check specifically for the
  // opponent recovering it - a generic "fumble recovery" match would also fire on "Fumble Recovery
  // (Own)", wrongly crediting the defense for a fumble the offense recovered themselves.
  // On a kickoff/punt return, CFBD lists the KICKING/PUNTING team as "offense" - so if the returner
  // (defensiveSchool) fumbles and the kicking team recovers it, the actual recovering team is
  // schoolName, not defensiveSchool. Only special-teams plays need this inversion; a normal
  // offensive fumble recovered by the real defense is unaffected (specialTeamsPlay is false there).
  const fumbleRecoveringSchool = specialTeamsPlay ? schoolName : defensiveSchool;
  if (eligibleSelection(fumbleRecoveringSchool, "DST") && isFumbleLostToOpponent && !isInvalidated && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TURNOVER" && candidate.schoolName === fumbleRecoveringSchool) && !candidates.some(candidate => candidate.eventType === "DEFENSIVE_TOUCHDOWN" && candidate.schoolName === fumbleRecoveringSchool)) {
    candidates.push({ sourceEventKey: `${play.id}:DEFENSIVE_TURNOVER:playtype`, sourceGameId: play.gameId, schoolName: fumbleRecoveringSchool, position: "DST", eventType: "DEFENSIVE_TURNOVER", statValue: 1, yardDistance: null, provisional, note: `CFBD play ${play.id} · fumble recovery (playType match)` });
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
  const untypedSpecialTeamsTd = !typedSpecialTeamsTd && specialTeamsPlay && /touchdown|\btd\b/.test(playText) && !isInvalidated;
  const specialTeamType = typedSpecialTeamsTd ?? (untypedSpecialTeamsTd ? "OTHER_SPECIAL_TEAMS_TOUCHDOWN" : null);
  if (specialTeamType && !isInvalidated) {
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
export function boxScoreFumbleCandidates(input: { gameId: number; school: string; box: CfbdGamePlayerStatsGame | undefined; roster: CfbdRosterAthlete[]; selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition }>; alreadyWrittenBySlot: Map<LivePosition, number> }): { available: boolean; candidates: ScoringCandidate[]; confirmedPositions: LivePosition[] } {
  const team = input.box?.teams.find(entry => normalizeSchoolForComparison(entry.team) === normalizeSchoolForComparison(input.school));
  if (!team) return { available: false, candidates: [], confirmedPositions: [] };
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
  // Every position the box score confirms actually lost a fumble (post-eligibility), whether or not
  // that produces a NEW candidate below. A slot can be fully - or exactly - accounted for by existing
  // non-box ENTRY rows (shortfall <= 0), which is not the same as the box failing to confirm it: the
  // caller uses this to keep those already-written rows out of the "stale, not confirmed by final
  // data" reversal sweep, since the box is in fact still confirming them.
  const confirmedPositions: LivePosition[] = [];
  for (const [position, entry] of Array.from(bySlot.entries())) {
    if (!input.selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(input.school) && selection.position === position)) continue;
    confirmedPositions.push(position);
    const shortfall = entry.count - (input.alreadyWrittenBySlot.get(position) ?? 0);
    if (shortfall <= 0) continue;
    candidates.push({ sourceEventKey: `${input.gameId}:FUMBLE_LOST:${position}:box`, sourceGameId: input.gameId, schoolName: input.school, position, eventType: "FUMBLE_LOST", statValue: shortfall, yardDistance: null, provisional: false, note: `CFBD box score · fumbles lost (${entry.names.join(", ")})` });
  }
  return { available: true, candidates, confirmedPositions };
}
