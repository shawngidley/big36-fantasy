import { getFbsTeams, getGamePlayerStats, getLivePlays, getLiveScoreboard, getRegularSeasonGames, getRoster, getWeekPlays, getWeekPlayStats, type CfbdGame, type CfbdLiveGame, type CfbdPlay, type CfbdRosterAthlete } from "./cfbd";
import { getLeagueSnapshot, getScoringRulesForEvent } from "./league-data";
import { calculateEventScore } from "./league-scoring";
import { boxScoreFumbleCandidates, eligibleGameIdsForSchool, finalShutoutCandidates, isSupersededInterceptionPlay, mapLivePlayToCandidates, type LivePosition } from "./live-scoring";
import { supabaseRest } from "./supabase";

type AutomationConfig = { season: number; enabled: boolean; last_refresh_at: string | null; schedule_cron_task_uid: string | null };
type SourceEvent = { id: string; source_event_key: string | null; source_game_id: number | null; audit_action: string; week_id: string; draft_slot_id: string; event_type: string; stat_value: number; yard_distance: number | null; computed_points: number; is_provisional: boolean; recorded_by_open_id: string };

export function sourceEventNeedsCorrection(original: Pick<SourceEvent, "computed_points" | "yard_distance" | "stat_value">, next: { points: number; yardDistance: number | null; statValue: number }) {
  return original.computed_points !== next.points || original.yard_distance !== next.yardDistance || original.stat_value !== next.statValue;
}

export function sourceEventReversalPoints(originalPoints: number) {
  return -originalPoints;
}

const sourceGameValues = (game: CfbdGame) => ({ cfbd_game_id: game.id, season: game.season, week_number: game.week, season_type: game.seasonType, start_date: game.startDate, completed: game.completed, home_team: game.homeTeam, away_team: game.awayTeam, home_classification: game.homeClassification ?? null, away_classification: game.awayClassification ?? null, home_points: game.homePoints ?? null, away_points: game.awayPoints ?? null, updated_at: new Date().toISOString() });

export function isCollegeFootballGamedayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  // Games can legitimately kick off as late as 10-11pm ET and take hours to fully reconcile once
  // CFBD's official data becomes available - the previous window (cutting off at 3am Sunday) left
  // late Saturday games permanently stuck unreconciled, since the automation would simply stop
  // trying once "outside the window" and never come back to them. This window now runs generously
  // through the whole weekend into Monday, giving every game ample time to actually get finalized,
  // not just detected as complete.
  if (weekday === "Thu" || weekday === "Fri") return hour >= 15;
  if (weekday === "Sat") return true;
  if (weekday === "Sun") return true;
  if (weekday === "Mon") return hour <= 12;
  return false;
}

async function writeRefreshStatus(values: Record<string, unknown>) {
  await supabaseRest("b36_automation_config", { method: "PATCH", query: { id: "eq.true" }, body: { ...values, last_refresh_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
}

// The season schedule already tells us which week every game belongs to, so there's no reason a
// commissioner should ever need to manually create a "Week N" scoring period before scoring can
// happen — that was a hidden dependency, not an intentional control. This creates it automatically
// the first time it's needed, and keeps the in-memory snapshot in sync so later lookups within the
// same refresh find it too.
// CFBD numbers every game from opening Saturday through Labor Day weekend as "week 1" - there is no
// way to ask CFBD for a finer breakdown. The league wants the Aug 29 (US/Eastern) openers tracked as
// their own "Week 0", separate from the rest of that CFBD week-1 slate, which stays "Week 1" exactly
// as before. This is the ONLY special case: every other CFBD week number maps straight through
// unchanged. The date check uses US/Eastern (not UTC) so a Friday-night West Coast kickoff that
// crosses into Aug 30 UTC still correctly counts as an Aug 29 game.
export function resolveB36WeekNumber(game: { week: number; startDate: string }): number {
  if (game.week !== 1) return game.week;
  const easternDate = new Date(game.startDate).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return easternDate === "2026-08-29" ? 0 : 1;
}

async function ensureWeekRow(weekNumber: number, weeks: Array<{ id: string; weekNumber: number }>): Promise<{ id: string; weekNumber: number }> {
  const existing = weeks.find(item => item.weekNumber === weekNumber);
  if (existing) return existing;
  // Check the database fresh (not just the in-memory snapshot) in case it was already created
  // moments ago by a concurrent refresh, before creating a new one.
  const freshRows = await supabaseRest<Array<{ id: string; week_number: number }>>("b36_scoring_weeks", { query: { select: "id,week_number", week_number: `eq.${weekNumber}`, limit: "1" } });
  if (freshRows[0]) { const row = { id: freshRows[0].id, weekNumber: freshRows[0].week_number }; weeks.push(row); return row; }
  const created = await supabaseRest<Array<{ id: string; week_number: number }>>("b36_scoring_weeks", { method: "POST", body: { week_number: weekNumber, label: `Week ${weekNumber}`, status: "OPEN" } });
  const row = { id: created[0].id, weekNumber: created[0].week_number };
  weeks.push(row);
  return row;
}

// /plays only populates once a game finishes, so it's useless for detecting scoring as it happens.
// /live/plays has the real in-progress data, but nests plays under drives with a different shape
// (no offense/defense/gameId/scoring fields) — this adapts it into the shape mapLivePlayToCandidates
// already understands, so that function doesn't need to change at all.
export function adaptLiveGameToLegacyPlays(gameId: number, live: CfbdLiveGame): CfbdPlay[] {
  const teamNames = (live.teams ?? []).map(team => team.team);
  const homeName = (live.teams ?? []).find(team => team.homeAway === "home")?.team ?? null;
  const awayName = (live.teams ?? []).find(team => team.homeAway === "away")?.team ?? null;
  let previousHome = 0, previousAway = 0;
  return (live.drives ?? []).flatMap(drive => drive.plays).map(play => {
    const scoring = play.homeScore !== previousHome || play.awayScore !== previousAway;
    // Which side's score moved - the only reliable way to know who scored on returns/blocks.
    const scoringTeam = play.homeScore > previousHome ? homeName : play.awayScore > previousAway ? awayName : null;
    previousHome = play.homeScore; previousAway = play.awayScore;
    const defense = teamNames.find(name => name !== play.team) ?? "";
    // Live play ids are strings (e.g. "4018567663"); keep them distinct from /plays' numeric ids so a
    // provisional live-detected event and its eventual final-confirmed counterpart never collide —
    // the existing reversal logic already cleanly replaces provisional entries once a game completes.
    return { id: Number(`9${play.id}`.slice(0, 15)), gameId, offense: play.team, defense, scoringTeam, yardsToGoal: play.yardsToGoal ?? null, yardsGained: play.yardsGained ?? null, scoring, playType: play.playType ?? null, playText: play.playText ?? null, period: play.period ?? null, clock: null };
  });
}

export async function syncFbsPoolAndSchedule(season: number) {
  const [teams, games] = await Promise.all([getFbsTeams(season), getRegularSeasonGames(season)]);
  if (teams.length < 130) throw new Error("CollegeFootballData did not return the expected FBS school pool.");
  await supabaseRest("b36_fbs_schools", { method: "POST", query: { on_conflict: "season,cfbd_team_id" }, prefer: "resolution=merge-duplicates,return=minimal", body: teams.map(team => ({ season, cfbd_team_id: team.id, school_name: team.school, conference: team.conference ?? null })) });
  await supabaseRest("b36_source_games", { method: "POST", query: { on_conflict: "cfbd_game_id" }, prefer: "resolution=merge-duplicates,return=minimal", body: games.map(sourceGameValues) });
  return { teamCount: teams.length, gameCount: games.length, games };
}

export async function runGamedayRefresh(options: { force?: boolean } = {}) {
  const config = (await supabaseRest<AutomationConfig[]>("b36_automation_config", { query: { select: "*", id: "eq.true" } }))[0];
  if (!config) throw new Error("36 Football automation is not configured.");
  if (!config.enabled && !options.force) return { skipped: "automation-disabled", insertedEvents: 0, activeGames: 0 };
  if (!options.force && !isCollegeFootballGamedayWindow()) return { skipped: "outside-gameday-window", insertedEvents: 0, activeGames: 0 };
  try {
    const schedule = await syncFbsPoolAndSchedule(config.season);
    const snapshot = await getLeagueSnapshot();
    const selectedSchoolPositions = snapshot.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as LivePosition, draftSlotId: pick.id })));
    const scoreboard = await getLiveScoreboard();
    const scoreboardStatusById = new Map(scoreboard.filter(game => game.id).map(game => [game.id, game.status ?? null]));
    const scoreboardGames = scoreboard.filter(game => game.id).map(game => schedule.games.find(source => source.id === game.id)).filter((game): game is CfbdGame => Boolean(game));
    // Once a week is marked FINAL by the commissioner, it's permanently locked - no further
    // automatic changes, ever, regardless of later code changes. Without this, a fix to detection
    // logic can retroactively re-evaluate and alter data that was already confirmed correct, which
    // is exactly what caused a real, serious regression tonight when a fumble-detection fix changed
    // which candidates got generated for plays across multiple already-settled games.
    const lockedWeekNumbers = new Set(snapshot.weeks.filter(week => week.status === "FINAL").map(week => week.weekNumber));
    const draftedGames = scoreboardGames.filter(game => selectedSchoolPositions.some(selection => selection.schoolName === game.homeTeam || selection.schoolName === game.awayTeam));
    // The lock must be per GAME, not per CFBD week number: CFBD's "week 1" spans opening weekend
    // through Labor Day, so locking the whole week number after the Aug 29 slate silently blocked
    // every game the following weekend. A game is settled (and therefore frozen) only when its week
    // is FINAL, it has completed, and it already carries official (non-provisional) entries. Games
    // in a FINAL week that are still upcoming/in progress, or completed but never reconciled, still
    // get scored normally.
    const lockedWeekCompletedIds = draftedGames.filter(game => lockedWeekNumbers.has(game.week) && game.completed).map(game => game.id);
    const settledGameIds = new Set<number>();
    if (lockedWeekCompletedIds.length) {
      const officialRows = await supabaseRest<Array<{ source_game_id: number | null }>>("b36_scoring_events", { query: { select: "source_game_id", source_game_id: `in.(${lockedWeekCompletedIds.join(",")})`, audit_action: "eq.ENTRY", is_provisional: "eq.false" } });
      officialRows.forEach(row => { if (row.source_game_id) settledGameIds.add(row.source_game_id); });
    }
    const relevantGames = draftedGames.filter(game => !settledGameIds.has(game.id));
    const trulyInProgress = relevantGames.filter(game => scoreboardStatusById.get(game.id) === "in_progress");
    // Stage-by-stage diagnostics so "0 relevant games" can be explained from the UI result alone.
    const draftedSchools = Array.from(new Set(selectedSchoolPositions.map(selection => selection.schoolName)));
    const matchDebug = {
      scoreboardCount: scoreboard.length,
      scoreboardMatchedToSchedule: scoreboardGames.length,
      scheduleGameCount: schedule.games.length,
      lockedWeeks: Array.from(lockedWeekNumbers),
      settledGamesSkipped: Array.from(settledGameIds),
      draftedSchoolCount: draftedSchools.length,
      scoreboardSample: scoreboard.slice(0, 40).map(game => ({ id: game.id, home: (game as { homeTeam?: { name?: string } }).homeTeam?.name ?? null, away: (game as { awayTeam?: { name?: string } }).awayTeam?.name ?? null, status: game.status ?? null, inSchedule: schedule.games.some(source => source.id === game.id) })),
      scoreboardDraftedByName: scoreboard.filter(game => draftedSchools.includes((game as { homeTeam?: { name?: string } }).homeTeam?.name ?? "") || draftedSchools.includes((game as { awayTeam?: { name?: string } }).awayTeam?.name ?? "")).map(game => game.id),
    };
    let insertedEvents = 0;

    // Live detection: for games actually happening right now, use the real live-play feed to catch
    // scoring as it happens, rather than waiting for the game to finish (when /plays finally populates).
    // These insert as provisional events; once the game completes, the existing final-reconciliation
    // pass below naturally supersedes them (its keys differ, so old provisional entries get reversed
    // and replaced with the official confirmed ones — no double-counting).
    const liveDebug: Array<Record<string, unknown>> = [];
    for (const game of trulyInProgress) {
      const debugEntry: Record<string, unknown> = { gameId: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam, week: game.week };
      try {
        const live = await getLivePlays(game.id);
        const legacyPlays = adaptLiveGameToLegacyPlays(game.id, live);
        debugEntry.legacyPlayCount = legacyPlays.length;
        const existingRows = await supabaseRest<Array<{ source_event_key: string | null }>>("b36_scoring_events", { query: { select: "source_event_key", source_game_id: `eq.${game.id}`, audit_action: "eq.ENTRY" } });
        const knownLiveKeys = new Set(existingRows.filter(row => row.source_event_key).map(row => row.source_event_key));
        const weekRow = await ensureWeekRow(resolveB36WeekNumber(game), snapshot.weeks);
        debugEntry.weekRowFound = Boolean(weekRow);
        debugEntry.availableWeekNumbers = snapshot.weeks.map(item => item.weekNumber);
        let candidateCount = 0, insertedForGame = 0, skippedNoSlot = 0;
        for (const school of [game.homeTeam, game.awayTeam]) {
          // Evaluate BOTH teams' offensive plays, not just drafted schools'. A drafted DEF earns
          // sacks/interceptions on the OPPONENT's offensive plays, so skipping an undrafted opponent
          // here silently dropped every live defensive credit unless both teams happened to be
          // drafted. The roster is only needed for offensive position attribution, so an undrafted
          // school gets an empty roster (no offensive candidates possible, no extra API call).
          const schoolIsDrafted = selectedSchoolPositions.some(selection => selection.schoolName === school);
          const roster = schoolIsDrafted ? await getRoster(school, config.season) : [];
          const schoolPlays = legacyPlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, legacyPlays[index + 1]));
          const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: true }));
          candidateCount += candidates.length;
          for (const candidate of candidates) {
            if (knownLiveKeys.has(candidate.sourceEventKey)) continue;
            const slot = selectedSchoolPositions.find(selection => selection.schoolName === candidate.schoolName && selection.position === candidate.position);
            if (!slot) { skippedNoSlot += 1; continue; }
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: `${candidate.note} (live)`, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-detection", source_event_key: candidate.sourceEventKey, source_game_id: game.id, is_provisional: true } });
            knownLiveKeys.add(candidate.sourceEventKey); insertedEvents += 1; insertedForGame += 1;
          }
        }
        debugEntry.candidateCount = candidateCount; debugEntry.insertedForGame = insertedForGame; debugEntry.skippedNoSlot = skippedNoSlot; debugEntry.alreadyKnownCount = knownLiveKeys.size;
      } catch (error) {
        debugEntry.error = error instanceof Error ? error.message : String(error);
      }
      liveDebug.push(debugEntry);
    }

    const byWeek = new Map<number, CfbdGame[]>();
    for (const game of relevantGames) byWeek.set(game.week, [...(byWeek.get(game.week) ?? []), game]);
    for (const [week, games] of Array.from(byWeek.entries())) {
      const [plays, stats] = await Promise.all([getWeekPlays(config.season, week), getWeekPlayStats(config.season, week)]);
      const schools = Array.from(new Set<string>(games.flatMap(game => [game.homeTeam, game.awayTeam]).filter(school => selectedSchoolPositions.some(selection => selection.schoolName === school))));
      const rosterEntries: Array<[string, CfbdRosterAthlete[]]> = await Promise.all(schools.map(async school => [school, await getRoster(school, config.season)]));
      const rosters = new Map<string, CfbdRosterAthlete[]>(rosterEntries);
      const eventRows = await supabaseRest<SourceEvent[]>("b36_scoring_events", { query: { select: "id,source_event_key,source_game_id,audit_action,week_id,draft_slot_id,event_type,stat_value,yard_distance,computed_points,is_provisional,recorded_by_open_id", source_game_id: `in.(${games.map(game => game.id).join(",")})` } });
      const knownKeys = new Set(eventRows.filter(row => row.source_event_key && row.audit_action !== "REVERSAL").map(row => row.source_event_key));
      const reversedKeys = new Set(eventRows.filter(row => row.audit_action === "REVERSAL" && row.source_event_key).map(row => row.source_event_key));
      const originalByKey = new Map(eventRows.filter(row => row.source_event_key && row.audit_action === "ENTRY").map(row => [row.source_event_key!, row]));
      // CFBD's /plays feed is not strictly post-game-only after all — it can start returning some
      // plays while a game is still in progress. That means an official candidate (real play id) can
      // get confirmed for the same real-world event a live-detected entry (synthetic "9..." id)
      // already covers, well before the game completes and the completion-gated cleanup below would
      // ever run — leaving both active and double-counting the play for however long the game has
      // left. Track still-active live-detected entries per (game, slot, eventType) so a newly
      // confirmed official candidate can reverse its live counterpart immediately, not just at game end.
      const pendingLiveByGameSlotType = new Map<string, SourceEvent[]>();
      for (const row of eventRows) {
        if (row.audit_action !== "ENTRY" || row.recorded_by_open_id !== "cfbd-live-detection" || !row.source_event_key || reversedKeys.has(`${row.source_event_key}:reversal`)) continue;
        const groupKey = `${row.source_game_id}:${row.draft_slot_id}:${row.event_type}`;
        pendingLiveByGameSlotType.set(groupKey, [...(pendingLiveByGameSlotType.get(groupKey) ?? []), row]);
      }
      for (const game of games) {
        const weekRow = await ensureWeekRow(resolveB36WeekNumber(game), snapshot.weeks);
        const currentCandidateKeys = new Set<string>();
        const gameCandidates = [
          ...[game.homeTeam, game.awayTeam].flatMap(school => {
            const roster = rosters.get(school) ?? [];
            const eligibleIds = eligibleGameIdsForSchool(schedule.games, school);
            if (!eligibleIds.includes(game.id)) return [];
            return plays.filter((play, index) => play.gameId === game.id && play.offense === school && !isSupersededInterceptionPlay(play, plays[index + 1])).flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => String(stat.playId) === String(play.id)), roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }));
          }),
          ...finalShutoutCandidates({ game, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }),
        ];
        if (game.completed) {
          // Fumbles lost: the box score is authoritative once the game is over (see
          // boxScoreFumbleCandidates). When it's available for a school, drop that school's
          // play-derived fumble candidates and let the box total (net of anything already written
          // from the play feed) drive the FUMBLE_LOST entries instead.
          for (const school of [game.homeTeam, game.awayTeam]) {
            if (!selectedSchoolPositions.some(selection => selection.schoolName === school)) continue;
            let box: Awaited<ReturnType<typeof getGamePlayerStats>>[number] | undefined;
            try { box = (await getGamePlayerStats(config.season, week, school)).find(entry => entry.id === game.id); } catch (error) { console.warn(`box score unavailable for ${school} game ${game.id}:`, error); }
            const alreadyWrittenBySlot = new Map<LivePosition, number>();
            for (const row of eventRows) {
              if (row.source_game_id !== game.id || row.event_type !== "FUMBLE_LOST" || row.audit_action !== "ENTRY" || !row.source_event_key || row.source_event_key.endsWith(":box") || reversedKeys.has(`${row.source_event_key}:reversal`)) continue;
              const slot = selectedSchoolPositions.find(selection => selection.draftSlotId === row.draft_slot_id && selection.schoolName === school);
              if (slot) alreadyWrittenBySlot.set(slot.position, (alreadyWrittenBySlot.get(slot.position) ?? 0) + row.stat_value);
            }
            const fromBox = boxScoreFumbleCandidates({ gameId: game.id, school, box, roster: rosters.get(school) ?? [], selectedSchoolPositions, alreadyWrittenBySlot });
            if (!fromBox.available) continue;
            for (let index = gameCandidates.length - 1; index >= 0; index -= 1) {
              const candidate = gameCandidates[index];
              if (candidate.eventType === "FUMBLE_LOST" && candidate.schoolName === school && !knownKeys.has(candidate.sourceEventKey)) gameCandidates.splice(index, 1);
            }
            gameCandidates.push(...fromBox.candidates);
          }
        }
        gameCandidates.forEach(candidate => currentCandidateKeys.add(candidate.sourceEventKey));
        for (const candidate of gameCandidates) {
          const slot = selectedSchoolPositions.find(selection => selection.schoolName === candidate.schoolName && selection.position === candidate.position);
          if (!slot) continue;
          const rules = await getScoringRulesForEvent(candidate.eventType as never);
          const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
          const original = originalByKey.get(candidate.sourceEventKey);
          if (!original) {
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: candidate.note, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-refresh", source_event_key: candidate.sourceEventKey, source_game_id: candidate.sourceGameId, is_provisional: !game.completed } });
            knownKeys.add(candidate.sourceEventKey); insertedEvents += 1;
            // The official candidate just confirmed is real - if a live-detected entry for the same
            // (game, slot, eventType) is still active, it's now a confirmed duplicate. Reverse it now
            // rather than waiting for game.completed, since /plays can populate well before then.
            const pendingGroupKey = `${game.id}:${slot.draftSlotId}:${candidate.eventType}`;
            const pendingLive = pendingLiveByGameSlotType.get(pendingGroupKey);
            const stalePending = pendingLive?.shift();
            if (stalePending) {
              const staleReversalKey = `${stalePending.source_event_key}:reversal`;
              if (!reversedKeys.has(staleReversalKey)) {
                await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: stalePending.week_id, draft_slot_id: stalePending.draft_slot_id, event_type: stalePending.event_type, stat_value: stalePending.stat_value, yard_distance: stalePending.yard_distance, computed_points: sourceEventReversalPoints(stalePending.computed_points), note: `Superseded by confirmed official play ${candidate.sourceEventKey} (no longer waiting on game completion)`, audit_action: "REVERSAL", correction_of_event_id: stalePending.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: staleReversalKey, source_game_id: game.id, is_provisional: false } });
                reversedKeys.add(staleReversalKey); insertedEvents += 1;
              }
            }
          } else if (game.completed && sourceEventNeedsCorrection(original, { points: score.points, yardDistance: candidate.yardDistance, statValue: candidate.statValue })) {
            const correctionKey = `${candidate.sourceEventKey}:correction:${score.points}:${candidate.yardDistance ?? "none"}:${candidate.statValue}`;
            if (!knownKeys.has(correctionKey)) {
              await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points - original.computed_points, note: `Official CFBD final correction updated source event ${candidate.sourceEventKey}`, audit_action: "CORRECTION", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: correctionKey, source_game_id: candidate.sourceGameId, is_provisional: false } });
              knownKeys.add(correctionKey); insertedEvents += 1;
            }
            await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
          }
        }
        for (const school of [game.homeTeam, game.awayTeam]) {
          if (!eligibleGameIdsForSchool(schedule.games, school).includes(game.id)) continue;
        }
        if (game.completed) {
          // Only ever auto-reverse PROVISIONAL (live-detected) entries that the official data doesn't
          // confirm. An entry that's already been confirmed official (is_provisional: false) must never
          // be blanket-reversed just because a later fetch produced a different result — CFBD's data can
          // be momentarily inconsistent between back-to-back calls, and reversing an already-correct
          // entry is far worse than leaving a stale one a little longer. Official entries can still be
          // adjusted via the CORRECTION path above if the point value genuinely needs fixing.
          const originalEvents = eventRows.filter(row => row.source_game_id === game.id && row.source_event_key && row.audit_action === "ENTRY" && row.is_provisional);
          for (const original of originalEvents.filter(event => !currentCandidateKeys.has(event.source_event_key!))) {
            const reversalKey = `${original.source_event_key}:reversal`;
            if (reversedKeys.has(reversalKey)) continue;
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: original.event_type, stat_value: original.stat_value, yard_distance: original.yard_distance, computed_points: sourceEventReversalPoints(original.computed_points), note: `Official CFBD final correction reversed source event ${original.source_event_key}`, audit_action: "REVERSAL", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: reversalKey, source_game_id: game.id, is_provisional: false } });
            reversedKeys.add(reversalKey); insertedEvents += 1;
          }
          for (const original of originalEvents.filter(event => currentCandidateKeys.has(event.source_event_key!))) {
            await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
          }
        }
      }
    }
    await writeRefreshStatus({ last_refresh_status: "ok", last_refresh_detail: { active_games: trulyInProgress.length, relevant_games: relevantGames.length, inserted_events: insertedEvents, team_count: schedule.teamCount, live_debug: liveDebug, match_debug: matchDebug } });
    return { activeGames: trulyInProgress.length, relevantGames: relevantGames.length, insertedEvents, teamCount: schedule.teamCount, liveDebug, matchDebug };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    await writeRefreshStatus({ last_refresh_status: "error", last_refresh_detail: { message } });
    throw error;
  }
}
