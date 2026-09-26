import { getFbsTeams, getGamePlayerStats, getLivePlays, getLiveScoreboard, getRegularSeasonGames, getRoster, getWeekPlays, getWeekPlayStats, type CfbdGame, type CfbdLiveGame, type CfbdPlay, type CfbdRosterAthlete } from "./cfbd";
import { getLeagueSnapshot, getScoringRulesForEvent } from "./league-data";
import { calculateEventScore } from "./league-scoring";
import { boxScoreFumbleCandidates, eligibleGameIdsForSchool, finalShutoutCandidates, indexPlayStatsByPlayId, isSupersededInterceptionPlay, mapLivePlayToCandidates, normalizeSchoolForComparison, statsForPlay, type LivePosition } from "./live-scoring";
import { supabaseRest } from "./supabase";

type AutomationConfig = { season: number; enabled: boolean; last_refresh_at: string | null; schedule_cron_task_uid: string | null };
type SourceEvent = { id: string; source_event_key: string | null; source_game_id: number | null; audit_action: string; week_id: string; draft_slot_id: string; event_type: string; stat_value: number; yard_distance: number | null; computed_points: number; is_provisional: boolean; recorded_by_open_id: string; correction_of_event_id: string | null };

export function sourceEventNeedsCorrection(original: Pick<SourceEvent, "computed_points" | "yard_distance" | "stat_value">, next: { points: number; yardDistance: number | null; statValue: number }) {
  return original.computed_points !== next.points || original.yard_distance !== next.yardDistance || original.stat_value !== next.statValue;
}

export function sourceEventReversalPoints(originalPoints: number) {
  return -originalPoints;
}

// A CORRECTION row's computed_points is a DELTA layered on top of whatever total already existed
// for that source event, not a replacement absolute value - so once an ENTRY has received one or
// more corrections, the "current truth" for it is the ENTRY's own computed_points PLUS every
// CORRECTION chained to it via correction_of_event_id, never the ENTRY's raw stored value alone.
// Comparing a fresh candidate against just the raw ENTRY value mistakes an already-correctly-
// adjusted total for a brand new discrepancy and plans a redundant, doubled-up correction on top
// of one that already landed - confirmed with real data: Old Dominion QB fumbles were already
// correctly adjusted to -6 via one ENTRY (-3) + one CORRECTION (-3), but reconciliation kept
// comparing fresh candidates against the ENTRY's own -3 and proposing a further -3 "correction".
export function currentEffectivePoints(
  original: { id: string; computed_points: number },
  eventRows: Array<{ audit_action: string; correction_of_event_id: string | null; computed_points: number }>,
) {
  return original.computed_points + eventRows
    .filter(row => row.audit_action === "CORRECTION" && row.correction_of_event_id === original.id)
    .reduce((sum, row) => sum + row.computed_points, 0);
}

const sourceGameValues = (game: CfbdGame) => ({ cfbd_game_id: game.id, season: game.season, week_number: game.week, season_type: game.seasonType, start_date: game.startDate, completed: game.completed, home_team: game.homeTeam, away_team: game.awayTeam, home_classification: game.homeClassification ?? null, away_classification: game.awayClassification ?? null, home_points: game.homePoints ?? null, away_points: game.awayPoints ?? null, updated_at: new Date().toISOString() });

export function isCollegeFootballGamedayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const weekday = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  // Games can legitimately kick off as late as 10-11pm ET and take hours to fully reconcile once
  // CFBD's official data becomes available - the previous window (cutting off at 3am Sunday, then
  // later at noon Monday) left late games permanently stuck unreconciled, since the automation would
  // simply stop trying once "outside the window" and never come back to them. Monday night games are
  // a normal, regular part of the schedule (not an edge case), so Monday now runs all day like
  // Sat/Sun, and the window extends into Tuesday morning to give a Monday night game - which can
  // finish near midnight - the same reconciliation runway every other day already gets.
  if (weekday === "Thu" || weekday === "Fri") return hour >= 15;
  if (weekday === "Sat") return true;
  if (weekday === "Sun") return true;
  if (weekday === "Mon") return true;
  if (weekday === "Tue") return hour <= 12;
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
  // This runs on a route the cron hits EVERY MINUTE. The platform maxDuration (vercel.json) is now
  // 300s so the on-demand admin audit/reconcile endpoints can do a whole week in one call - but this
  // loop deliberately keeps its own 45s budget regardless: a tick that ran past 60s would overlap the
  // next minute's tick, and two ticks writing the same games concurrently would double-credit. Do
  // not "fix" this budget up to match maxDuration. Separately: a killed invocation never reaches the
  // catch block below, so a tick that runs long doesn't even
  // get to record last_refresh_status: error, it just silently vanishes. Fixing draftedGames to look
  // at the full season schedule (see below) means a tick can suddenly find a large backlog of
  // previously-invisible unsettled games - if a single tick tried to fully reconcile all of them at
  // once, it would very likely time out again, for a different reason. This budget stops the final-
  // reconciliation loop with margin to spare (leaving room for the schedule sync and live-detection
  // pass that already ran), so a tick that runs out of time simply leaves the remainder for the next
  // one - which starts a fresh 60s budget a minute later - rather than getting killed mid-write.
  const deadlineAt = Date.now() + 45_000;
  const pastDeadline = () => Date.now() > deadlineAt;
  // pastDeadline() alone only stops us from STARTING new work once the budget is spent - it does
  // nothing once a single await is already in flight. debugRefreshTiming confirmed the pre-loop
  // stages (schedule sync, snapshot, scoreboard) only take ~9s combined, so a real-world 504 with
  // the 45s budget in place means one in-flight stage is running long uninterrupted: the first
  // processed week's getWeekPlays/getWeekPlayStats/roster fan-out (which always starts regardless
  // of pastDeadline, since the very first week must run) or a slow per-game box-score fetch. This
  // races any such stage against the time actually left, so a slow CFBD response can't by itself
  // carry the whole invocation past Vercel's 60s ceiling - we just skip that stage's results for
  // this tick and let the next tick, a minute later, retry it.
  function raceAgainstDeadline<T>(promise: Promise<T>, label: string, deadline: number = deadlineAt): Promise<T | { timedOut: true; label: string }> {
    const remainingMs = Math.max(deadline - Date.now(), 0);
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<{ timedOut: true; label: string }>(resolve => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true, label }), remainingMs);
    });
    // Whichever side wins, the loser must not keep a live timer/closure around for up to 45s after
    // the handler has otherwise finished - a big backlog week can call this 100+ times per tick.
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
  }
  // Reserve a fixed slice of the OVERALL 45s budget for backlog reconciliation, anchored to
  // invocation start rather than to whenever the live-detection loop happens to begin. A real
  // production run showed live detection alone (for 14 concurrently live games) could consume the
  // entire 45s deadline, leaving skippedWeeksForTimeBudget as every single week - the backlog loop
  // never started. Computing this sub-deadline from Date.now() at the top of the live loop instead
  // of from deadlineAt would make the reserved slice shrink by however long the pre-loop stages
  // (schedule sync, snapshot, scoreboard - ~9s measured, but not guaranteed) happened to take;
  // anchoring to deadlineAt keeps the backlog's floor fixed regardless of that variance.
  const BACKLOG_RESERVED_MS = 25_000;
  const liveDetectionDeadlineAt = deadlineAt - BACKLOG_RESERVED_MS;
  const pastLiveDetectionDeadline = () => Date.now() > liveDetectionDeadlineAt;
  try {
    const schedule = await syncFbsPoolAndSchedule(config.season);
    const snapshot = await getLeagueSnapshot();
    const selectedSchoolPositions = snapshot.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as LivePosition, draftSlotId: pick.id })));
    const scoreboard = await getLiveScoreboard();
    const scoreboardStatusById = new Map(scoreboard.filter(game => game.id).map(game => [game.id, game.status ?? null]));
    // CFBD's /scoreboard (no week/year param - see getLiveScoreboard) only ever returns TODAY's games.
    // draftedGames used to be filtered through this same-day scoreboard, which meant any drafted-school
    // game not fully reconciled before its calendar day ended became permanently invisible to every
    // future tick, forever - regardless of isCollegeFootballGamedayWindow being true days later. A real
    // production sweep (debugRefreshTiming) found 76 completed, drafted-school games already stuck this
    // way (4 in week 1, 68 in week 2, 4 in week 3), including a Notre Dame shutout that never got its
    // official credit because the game aged off the scoreboard before its final reconciliation tick.
    // draftedGames is now sourced from the full season schedule instead - the scoreboard is still used
    // (via scoreboardStatusById above) only to tell which of today's games are actually in progress.
    const scoreboardGames = scoreboard.filter(game => game.id).map(game => schedule.games.find(source => source.id === game.id)).filter((game): game is CfbdGame => Boolean(game));
    // Once a week is marked FINAL by the commissioner, it's permanently locked - no further
    // automatic changes, ever, regardless of later code changes. Without this, a fix to detection
    // logic can retroactively re-evaluate and alter data that was already confirmed correct, which
    // is exactly what caused a real, serious regression tonight when a fumble-detection fix changed
    // which candidates got generated for plays across multiple already-settled games.
    const lockedWeekNumbers = new Set(snapshot.weeks.filter(week => week.status === "FINAL").map(week => week.weekNumber));
    // Bound to completed games (any age - that's the actual backlog) plus near-term upcoming ones
    // (today/tomorrow), rather than the entire rest-of-season schedule. A far-future game has nothing
    // to reconcile yet and would just add dead weight to every tick until its own week arrives.
    const nearTermCutoff = Date.now() + 2 * 24 * 60 * 60_000;
    const draftedGames = schedule.games.filter(game => (game.completed || new Date(game.startDate).getTime() <= nearTermCutoff) && selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(game.homeTeam) || normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(game.awayTeam)));
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
    //
    // A real production run on a 14-concurrent-game Saturday showed this loop, sharing the same 45s
    // deadline as the backlog reconciliation below, can run to completion on its own and consume the
    // entire budget - every one of skippedWeeksForTimeBudget's weeks got skipped without the final-
    // reconciliation loop starting at all, so Notre Dame's shutout (sitting in the week 2 backlog)
    // never even got a chance that tick. On a big gameday, live scoring for today's games will always
    // have plenty of material to process, so sharing one deadline means the backlog can get starved
    // indefinitely on exactly the days people are most likely to notice. liveDetectionDeadlineAt
    // (defined above, anchored to invocation start) gives this loop its own, smaller budget so
    // backlog reconciliation is guaranteed a real slice of the 45s regardless of how many games are
    // live right now.
    const liveDebug: Array<Record<string, unknown>> = [];
    for (const game of trulyInProgress) {
      if (pastLiveDetectionDeadline()) { liveDebug.push({ gameId: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam, week: game.week, skipped: "time-budget-exceeded" }); continue; }
      const debugEntry: Record<string, unknown> = { gameId: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam, week: game.week };
      try {
        // Raced against the live-detection sub-deadline, not the overall one - a single slow
        // getLivePlays call is an in-flight await pastLiveDetectionDeadline() can't interrupt on its
        // own, and with up to ~14 games in this loop, one slow response could otherwise burn most of
        // the 20s reserved for live detection by itself.
        const liveResult = await raceAgainstDeadline(getLivePlays(game.id), `live-plays-${game.id}`, liveDetectionDeadlineAt);
        if ("timedOut" in liveResult) { debugEntry.skipped = "time-budget-exceeded"; liveDebug.push(debugEntry); continue; }
        const live = liveResult;
        const legacyPlays = adaptLiveGameToLegacyPlays(game.id, live);
        debugEntry.legacyPlayCount = legacyPlays.length;
        const existingRows = await supabaseRest<Array<{ source_event_key: string | null }>>("b36_scoring_events", { query: { select: "source_event_key", source_game_id: `eq.${game.id}`, audit_action: "eq.ENTRY" } });
        const knownLiveKeys = new Set(existingRows.filter(row => row.source_event_key).map(row => row.source_event_key));
        const weekRow = await ensureWeekRow(resolveB36WeekNumber(game), snapshot.weeks);
        debugEntry.weekRowFound = Boolean(weekRow);
        debugEntry.availableWeekNumbers = snapshot.weeks.map(item => item.weekNumber);
        let candidateCount = 0, insertedForGame = 0, skippedNoSlot = 0, skippedForTimeBudget = 0;
        for (const school of [game.homeTeam, game.awayTeam]) {
          // getLivePlays is raced above, but everything after it - roster fetch, then a real
          // Supabase POST per new candidate below - was still completely unguarded. With up to ~14
          // games in this loop and up to a few dozen candidates per game, that unraced tail is what
          // actually kept blowing through the live-detection sub-budget (and deep into the backlog's
          // reserved time) even after getLivePlays itself stopped being the bottleneck. Checked per
          // school and per candidate, not just per game, since a single game's own candidate count
          // can be large enough to matter on its own.
          if (pastLiveDetectionDeadline()) { skippedForTimeBudget += 1; break; }
          // Evaluate BOTH teams' offensive plays, not just drafted schools'. A drafted DEF earns
          // sacks/interceptions on the OPPONENT's offensive plays, so skipping an undrafted opponent
          // here silently dropped every live defensive credit unless both teams happened to be
          // drafted. The roster is only needed for offensive position attribution, so an undrafted
          // school gets an empty roster (no offensive candidates possible, no extra API call).
          const schoolIsDrafted = selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school));
          const roster = schoolIsDrafted ? await getRoster(school, config.season) : [];
          const schoolPlays = legacyPlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, legacyPlays[index + 1]));
          const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: true }));
          candidateCount += candidates.length;
          for (const candidate of candidates) {
            if (knownLiveKeys.has(candidate.sourceEventKey)) continue;
            if (pastLiveDetectionDeadline()) { skippedForTimeBudget += 1; break; }
            const slot = selectedSchoolPositions.find(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(candidate.schoolName) && selection.position === candidate.position);
            if (!slot) { skippedNoSlot += 1; continue; }
            // A single candidate's data problem (missing yardage, a rules gap, anything unexpected)
            // must never crash the whole tick and block every other game's scoring. Skip just this
            // candidate - it's not added to knownLiveKeys, so a later tick retries it once whatever
            // was wrong (often the underlying CFBD data itself) has had a chance to resolve.
            try {
              const rules = await getScoringRulesForEvent(candidate.eventType as never);
              const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
              await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: `${candidate.note} (live)`, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-detection", source_event_key: candidate.sourceEventKey, source_game_id: game.id, is_provisional: true } });
              knownLiveKeys.add(candidate.sourceEventKey); insertedEvents += 1; insertedForGame += 1;
            } catch (error) {
              console.error(`Skipping candidate ${candidate.sourceEventKey}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
        debugEntry.candidateCount = candidateCount; debugEntry.insertedForGame = insertedForGame; debugEntry.skippedNoSlot = skippedNoSlot; debugEntry.alreadyKnownCount = knownLiveKeys.size; debugEntry.skippedForTimeBudget = skippedForTimeBudget;
      } catch (error) {
        debugEntry.error = error instanceof Error ? error.message : String(error);
      }
      liveDebug.push(debugEntry);
    }

    const byWeek = new Map<number, CfbdGame[]>();
    for (const game of relevantGames) byWeek.set(game.week, [...(byWeek.get(game.week) ?? []), game]);
    // Process the most recent week first. draftedGames now draws on the full season schedule (not
    // just today's scoreboard), so a week that's been backlogged for a while - e.g. 68 unsettled week
    // 2 games found in production - can vastly outnumber today's own week's handful of games. Without
    // this ordering, an old backlog would starve the current week's own reconciliation of its share of
    // the time budget on the very days people are actually watching the site.
    const weeksDescending = Array.from(byWeek.entries()).sort(([a], [b]) => b - a);
    const skippedWeeksForTimeBudget: number[] = [];
    for (const [week, games] of weeksDescending) {
      if (pastDeadline()) { skippedWeeksForTimeBudget.push(week); continue; }
      const schools = Array.from(new Set<string>(games.flatMap(game => [game.homeTeam, game.awayTeam]).filter(school => selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school)))));
      const weekFanout = await raceAgainstDeadline(
        Promise.all([
          getWeekPlays(config.season, week),
          getWeekPlayStats(config.season, week),
          Promise.all(schools.map(async school => [school, await getRoster(school, config.season)] as [string, CfbdRosterAthlete[]])),
        ]),
        `week-${week}-fanout`,
      );
      if ("timedOut" in weekFanout) { skippedWeeksForTimeBudget.push(week); continue; }
      const [plays, stats, rosterEntries] = weekFanout;
      // Indexed once per week: this loop runs mapLivePlayToCandidates for every play of every game
      // below, and a per-play full scan of the week's stats array was costing ~20s of CPU per tick
      // (see indexPlayStatsByPlayId) - a large share of the very time budget pastDeadline() guards.
      const statsByPlayId = indexPlayStatsByPlayId(stats);
      const rosters = new Map<string, CfbdRosterAthlete[]>(rosterEntries);
      const eventRows = await supabaseRest<SourceEvent[]>("b36_scoring_events", { query: { select: "id,source_event_key,source_game_id,audit_action,week_id,draft_slot_id,event_type,stat_value,yard_distance,computed_points,is_provisional,recorded_by_open_id,correction_of_event_id", source_game_id: `in.(${games.map(game => game.id).join(",")})` } });
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
        if (pastDeadline()) { skippedWeeksForTimeBudget.push(week); break; }
        const weekRow = await ensureWeekRow(resolveB36WeekNumber(game), snapshot.weeks);
        const currentCandidateKeys = new Set<string>();
        const gameCandidates = [
          ...[game.homeTeam, game.awayTeam].flatMap(school => {
            const roster = rosters.get(school) ?? [];
            const eligibleIds = eligibleGameIdsForSchool(schedule.games, school);
            if (!eligibleIds.includes(game.id)) return [];
            return plays.filter((play, index) => play.gameId === game.id && play.offense === school && !isSupersededInterceptionPlay(play, plays[index + 1])).flatMap(play => mapLivePlayToCandidates({ play, stats: statsForPlay(statsByPlayId, play), roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }));
          }),
          ...finalShutoutCandidates({ game, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }),
        ];
        // Set when a completed game's box score fetch is cut off by the time budget below. A timed-
        // out box score falls back to play-derived fumble candidates just like a genuine CFBD error
        // does - but unlike an error (which is roughly as likely on any tick), a timeout is *most*
        // likely on exactly the backlog-drain ticks this budget exists for. If those candidates then
        // wrote as official (is_provisional: false), the game would look "settled" the moment its
        // week locks FINAL - even though the box-score correction that FUMBLE_LOST exists to apply
        // never actually ran - and no later tick would ever revisit it. Keeping this game's entries
        // provisional until a tick gets a real box score (or the game stops being completed-with-a-
        // pending-fumble-check) protects settledGameIds' "has an official entry" test from a plain
        // budget cutoff, not just from CFBD being down.
        let boxScoreIncompleteForGame = false;
        if (game.completed) {
          // Fumbles lost: the box score is authoritative once the game is over (see
          // boxScoreFumbleCandidates). When it's available for a school, drop that school's
          // play-derived fumble candidates and let the box total (net of anything already written
          // from the play feed) drive the FUMBLE_LOST entries instead.
          for (const school of [game.homeTeam, game.awayTeam]) {
            if (!selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school))) continue;
            let box: Awaited<ReturnType<typeof getGamePlayerStats>>[number] | undefined;
            try {
              // Sequential per-school call inside a per-game loop that can run 100+ times across a
              // big backlog week - a single slow CFBD response here shouldn't be able to eat the
              // whole remaining budget uninterrupted, so this is raced the same way as the week-level
              // fan-out above.
              const boxResult = await raceAgainstDeadline(getGamePlayerStats(config.season, week, school), `box-score-${school}-${game.id}`);
              if ("timedOut" in boxResult) { boxScoreIncompleteForGame = true; box = undefined; }
              else box = boxResult.find(entry => entry.id === game.id);
            } catch (error) { console.warn(`box score unavailable for ${school} game ${game.id}:`, error); }
            const alreadyWrittenBySlot = new Map<LivePosition, number>();
            const alreadyWrittenKeysBySlot = new Map<LivePosition, string[]>();
            for (const row of eventRows) {
              if (row.source_game_id !== game.id || row.event_type !== "FUMBLE_LOST" || row.audit_action !== "ENTRY" || !row.source_event_key || row.source_event_key.endsWith(":box") || reversedKeys.has(`${row.source_event_key}:reversal`)) continue;
              const slot = selectedSchoolPositions.find(selection => selection.draftSlotId === row.draft_slot_id && normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school));
              if (slot) {
                alreadyWrittenBySlot.set(slot.position, (alreadyWrittenBySlot.get(slot.position) ?? 0) + row.stat_value);
                alreadyWrittenKeysBySlot.set(slot.position, [...(alreadyWrittenKeysBySlot.get(slot.position) ?? []), row.source_event_key]);
              }
            }
            const fromBox = boxScoreFumbleCandidates({ gameId: game.id, school, box, roster: rosters.get(school) ?? [], selectedSchoolPositions, alreadyWrittenBySlot });
            if (!fromBox.available) continue;
            for (let index = gameCandidates.length - 1; index >= 0; index -= 1) {
              const candidate = gameCandidates[index];
              if (candidate.eventType === "FUMBLE_LOST" && candidate.schoolName === school && !knownKeys.has(candidate.sourceEventKey)) gameCandidates.splice(index, 1);
            }
            gameCandidates.push(...fromBox.candidates);
            // A slot the box confirms can have nothing left to add as a new candidate (shortfall <= 0
            // inside boxScoreFumbleCandidates) without that meaning the existing entry is stale - it
            // means the box confirms it exactly as already recorded. Without this, a real, box-
            // confirmed fumble with no shortfall would fall out of gameCandidates entirely (replaced by
            // nothing) and get wrongly reversed below as "no longer confirmed by final data".
            for (const position of fromBox.confirmedPositions) {
              for (const key of alreadyWrittenKeysBySlot.get(position) ?? []) currentCandidateKeys.add(key);
            }
          }
        }
        gameCandidates.forEach(candidate => currentCandidateKeys.add(candidate.sourceEventKey));
        // Team-level defensive/special-teams events (unlike offensive touchdowns, which legitimately
        // split across two positions like QB+WR on the same play) should only ever have ONE credit
        // per play, no matter which athlete CFBD's stats happen to attribute it to. If stats were
        // available on an earlier tick (producing an athlete-ID-suffixed key) but come back
        // incomplete on a later tick, the text-based ":unit" fallback fires again with a DIFFERENT
        // key for the same real event - our exact-key duplicate check doesn't catch this, since the
        // keys genuinely differ. Confirmed with real production data: three separate plays (a sack,
        // two interceptions, one of them a touchdown) each got double-credited this way, roughly 18
        // hours apart, once with a real athlete ID and once via the "unit" fallback.
        const perPlaySingleCreditTypes = new Set(["SACK", "DEFENSIVE_TURNOVER", "DEFENSIVE_TOUCHDOWN", "BLOCKED_PUNT", "BLOCKED_FIELD_GOAL", "SPECIAL_TEAMS_SAFETY", "KICK_RETURN_TOUCHDOWN", "PUNT_RETURN_TOUCHDOWN", "BLOCKED_KICK_RETURN_TOUCHDOWN", "OTHER_SPECIAL_TEAMS_TOUCHDOWN"]);
        const alreadyCreditedPlayEventPrefixes = new Set(Array.from(knownKeys).filter((key): key is string => Boolean(key) && perPlaySingleCreditTypes.has(key!.split(":")[1] ?? "")).map(key => key.split(":").slice(0, 2).join(":")));
        for (const candidate of gameCandidates) {
          if (perPlaySingleCreditTypes.has(candidate.eventType)) {
            const prefix = candidate.sourceEventKey.split(":").slice(0, 2).join(":");
            if (alreadyCreditedPlayEventPrefixes.has(prefix) && !knownKeys.has(candidate.sourceEventKey)) continue;
          }
          // A box-score-derived FUMBLE_LOST (keyed by game+position, e.g. "401858213:FUMBLE_LOST:WR:box")
          // and a play-level one (keyed by the specific play, e.g. "401858213660:FUMBLE_LOST:WR") use
          // completely different key formats for the SAME real event, so neither the exact-key check
          // above nor the per-play prefix check catches this overlap. Real Miami/FAMU play: a box-score
          // fumble for Burton (WR) already existed; a new play-level one for the same fumble got added
          // independently once the play's own possession-change detection started correctly excluding
          // it from the (wrong) offensive touchdown credit, double-counting the same real fumble.
          if (candidate.eventType === "FUMBLE_LOST" && !candidate.sourceEventKey.endsWith(":box")) {
            const boxScoreKeyForThisPosition = `${candidate.sourceGameId}:FUMBLE_LOST:${candidate.position}:box`;
            if (knownKeys.has(boxScoreKeyForThisPosition)) continue;
          }
          const slot = selectedSchoolPositions.find(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(candidate.schoolName) && selection.position === candidate.position);
          if (!slot) continue;
          // A single candidate's data problem (missing yardage, a rules gap, anything unexpected)
          // must never crash the whole tick and block every other game's scoring. Skip just this
          // candidate and move on - a later tick retries it once whatever was wrong has resolved.
          try {
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            const original = originalByKey.get(candidate.sourceEventKey);
            if (!original) {
              await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: candidate.note, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-refresh", source_event_key: candidate.sourceEventKey, source_game_id: candidate.sourceGameId, is_provisional: !game.completed || boxScoreIncompleteForGame } });
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
            } else if (game.completed && sourceEventNeedsCorrection({ ...original, computed_points: currentEffectivePoints(original, eventRows) }, { points: score.points, yardDistance: candidate.yardDistance, statValue: candidate.statValue })) {
              const effectivePoints = currentEffectivePoints(original, eventRows);
              const correctionKey = `${candidate.sourceEventKey}:correction:${score.points}:${candidate.yardDistance ?? "none"}:${candidate.statValue}`;
              if (!knownKeys.has(correctionKey)) {
                await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points - effectivePoints, note: `Official CFBD final correction updated source event ${candidate.sourceEventKey}`, audit_action: "CORRECTION", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: correctionKey, source_game_id: candidate.sourceGameId, is_provisional: false } });
                knownKeys.add(correctionKey); insertedEvents += 1;
              }
              // Don't confirm the original entry official while this game's box score is still
              // outstanding (see boxScoreIncompleteForGame above) - the correction amount itself is
              // still applied, just without letting the row count toward "this game is settled" yet.
              if (!boxScoreIncompleteForGame) await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
            }
          } catch (error) {
            console.error(`Skipping candidate ${candidate.sourceEventKey}: ${error instanceof Error ? error.message : String(error)}`);
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
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: original.event_type, stat_value: original.stat_value, yard_distance: original.yard_distance, computed_points: sourceEventReversalPoints(currentEffectivePoints(original, eventRows)), note: `Official CFBD final correction reversed source event ${original.source_event_key}`, audit_action: "REVERSAL", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: reversalKey, source_game_id: game.id, is_provisional: false } });
            reversedKeys.add(reversalKey); insertedEvents += 1;
          }
          // Same reasoning as the correction path above: don't flip a previously live-detected entry
          // to official while this game's box score is still outstanding, or it would count toward
          // "this game is settled" before the box-derived fumble correction ever actually ran.
          if (!boxScoreIncompleteForGame) {
            for (const original of originalEvents.filter(event => currentCandidateKeys.has(event.source_event_key!))) {
              await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
            }
          }
        }
      }
    }
    const uniqueSkippedWeeks = Array.from(new Set(skippedWeeksForTimeBudget));
    await writeRefreshStatus({ last_refresh_status: "ok", last_refresh_detail: { active_games: trulyInProgress.length, relevant_games: relevantGames.length, inserted_events: insertedEvents, team_count: schedule.teamCount, live_debug: liveDebug, match_debug: matchDebug, skipped_weeks_for_time_budget: uniqueSkippedWeeks } });
    return { activeGames: trulyInProgress.length, relevantGames: relevantGames.length, insertedEvents, teamCount: schedule.teamCount, liveDebug, matchDebug, skippedWeeksForTimeBudget: uniqueSkippedWeeks };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    await writeRefreshStatus({ last_refresh_status: "error", last_refresh_detail: { message } });
    throw error;
  }
}

export type ReconcileEventRow = { id: string; source_event_key: string | null; audit_action: string; week_id: string; draft_slot_id: string; event_type: string; stat_value: number; yard_distance: number | null; computed_points: number; is_provisional: boolean; recorded_by_open_id: string; correction_of_event_id: string | null };
export type ReconcilePlannedAction = { action: "insert" | "correction" | "reversal" | "confirm-official"; eventType: string; school: string; position: string; owner: string; points: number; note: string; key: string };

// Shared by the admin reconcileGameFromFinalData (one named game) and reconcileWeekFromFinalData
// (every completed game in a week) endpoints - both exist to clean up a completed game's scoring
// events after a code fix landed too late for the main automation to ever revisit it (a completed
// game with any official ENTRY is permanently "settled" and dropped from relevantGames by design,
// so an ordinary bugfix can't reach its stale rows on its own - see settledGameIds above). This is
// the same regenerate-every-candidate-from-final-data-and-diff logic the main per-game loop above
// runs (lines ~328-474), just scoped to one game, run on demand rather than every tick, and
// reporting every planned action instead of only writing them - dryRun defaults true upstream.
export async function reconcileGameAgainstFinalData(params: {
  game: CfbdGame;
  schedule: CfbdGame[];
  season: number;
  weekRowId: string;
  selectedSchoolPositions: Array<{ schoolName: string; position: LivePosition; draftSlotId: string; ownerName: string }>;
  dryRun: boolean;
}): Promise<{ planned: ReconcilePlannedAction[]; boxScoreUnavailableFor: string[] }> {
  const { game, schedule, season, weekRowId, selectedSchoolPositions, dryRun } = params;
  const [plays, stats] = await Promise.all([getWeekPlays(season, game.week), getWeekPlayStats(season, game.week)]);
  const gamePlays = plays.filter(play => play.gameId === game.id);
  // Indexed once here rather than scanning the whole week's stats per play - that scan was ~0.8s of
  // CPU per game (see indexPlayStatsByPlayId), which is most of why reconcileWeekFromFinalData could
  // only fit a handful of games per 60s call.
  const statsByPlayId = indexPlayStatsByPlayId(stats);
  const eventRows = await supabaseRest<ReconcileEventRow[]>("b36_scoring_events", { query: { select: "id,source_event_key,audit_action,week_id,draft_slot_id,event_type,stat_value,yard_distance,computed_points,is_provisional,recorded_by_open_id,correction_of_event_id", source_game_id: `eq.${game.id}` } });
  const knownKeys = new Set(eventRows.filter(row => row.source_event_key && row.audit_action !== "REVERSAL").map(row => row.source_event_key));
  const reversedKeys = new Set(eventRows.filter(row => row.audit_action === "REVERSAL" && row.source_event_key).map(row => row.source_event_key));
  const originalByKey = new Map(eventRows.filter(row => row.source_event_key && row.audit_action === "ENTRY").map(row => [row.source_event_key!, row]));
  // Live-detected entries use a synthetic play id (a "9" prepended to the real CFBD play id, see
  // adaptLiveGameToLegacyPlays) specifically so they never collide with the eventual official
  // entry's key, which uses the real id straight from CFBD's final /plays feed. That means a
  // live-detected TOUCHDOWN and its final-data-confirmed counterpart for the SAME real play never
  // share a source_event_key - so matching on exact key alone (as the insert/correction logic
  // below does) can never find the live one as "already known" and would insert a brand new
  // duplicate official entry right next to it instead of replacing it. Tracked here exactly like
  // the main loop's pendingLiveByGameSlotType above, and consulted the same way.
  const pendingLiveBySlotEventType = new Map<string, ReconcileEventRow[]>();
  for (const row of eventRows) {
    if (row.audit_action !== "ENTRY" || row.recorded_by_open_id !== "cfbd-live-detection" || !row.source_event_key || reversedKeys.has(`${row.source_event_key}:reversal`)) continue;
    const groupKey = `${row.draft_slot_id}:${row.event_type}`;
    pendingLiveBySlotEventType.set(groupKey, [...(pendingLiveBySlotEventType.get(groupKey) ?? []), row]);
  }
  const eligibleSchools = [game.homeTeam, game.awayTeam].filter(school => eligibleGameIdsForSchool(schedule, school).includes(game.id));
  // getRoster is cached day-long, so resolving these sequentially here (rather than Promise.all,
  // which the hot automation path uses for volume) costs nothing meaningful for an on-demand,
  // per-game reconciliation and keeps this straightforward to read.
  const offensiveCandidatesBySchool = new Map<string, ReturnType<typeof mapLivePlayToCandidates>>();
  for (const school of eligibleSchools) {
    const roster = await getRoster(school, season);
    const schoolPlays = gamePlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, gamePlays[index + 1]));
    offensiveCandidatesBySchool.set(school, schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: statsForPlay(statsByPlayId, play), roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: false })));
  }
  let candidates = [
    ...Array.from(offensiveCandidatesBySchool.values()).flat(),
    ...finalShutoutCandidates({ game, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: false }),
  ];
  // Box-score fumbles: same override as the main automation - the box score is authoritative once
  // the game is over, replacing play-derived fumble candidates for schools it's available for.
  const boxScoreUnavailableFor: string[] = [];
  // Fumbles-lost keys the box score confirms as still valid even though they produced no NEW
  // candidate (shortfall <= 0 - the box's authoritative total is already fully accounted for by
  // these existing ENTRY rows). Merged into currentCandidateKeys below once it exists, so the
  // "no longer confirmed by final data" reversal sweep doesn't treat a real, box-confirmed fumble
  // as stale just because nothing new represents it in `candidates`.
  const boxConfirmedExistingKeys = new Set<string>();
  for (const school of [game.homeTeam, game.awayTeam]) {
    if (!selectedSchoolPositions.some(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school))) continue;
    const roster = await getRoster(school, season);
    const box = (await getGamePlayerStats(season, game.week, school)).find(entry => entry.id === game.id);
    const alreadyWrittenBySlot = new Map<LivePosition, number>();
    const alreadyWrittenKeysBySlot = new Map<LivePosition, string[]>();
    for (const row of eventRows) {
      if (row.event_type !== "FUMBLE_LOST" || row.audit_action !== "ENTRY" || !row.source_event_key || row.source_event_key.endsWith(":box") || reversedKeys.has(`${row.source_event_key}:reversal`)) continue;
      const slot = selectedSchoolPositions.find(selection => selection.draftSlotId === row.draft_slot_id && normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(school));
      if (slot) {
        alreadyWrittenBySlot.set(slot.position, (alreadyWrittenBySlot.get(slot.position) ?? 0) + row.stat_value);
        alreadyWrittenKeysBySlot.set(slot.position, [...(alreadyWrittenKeysBySlot.get(slot.position) ?? []), row.source_event_key]);
      }
    }
    const fromBox = boxScoreFumbleCandidates({ gameId: game.id, school, box, roster, selectedSchoolPositions, alreadyWrittenBySlot });
    if (!fromBox.available) { boxScoreUnavailableFor.push(school); continue; }
    candidates = candidates.filter(candidate => !(candidate.eventType === "FUMBLE_LOST" && candidate.schoolName === school && !knownKeys.has(candidate.sourceEventKey)));
    candidates.push(...fromBox.candidates);
    for (const position of fromBox.confirmedPositions) {
      for (const key of alreadyWrittenKeysBySlot.get(position) ?? []) boxConfirmedExistingKeys.add(key);
    }
  }
  // Same per-play single-credit collapse the main automation applies, so a unit event that's
  // already been credited under one key format (an athlete-ID stat key vs a text-based ":unit"
  // fallback key) doesn't get double-counted here just because the keys genuinely differ.
  const perPlaySingleCreditTypes = new Set(["SACK", "DEFENSIVE_TURNOVER", "DEFENSIVE_TOUCHDOWN", "BLOCKED_PUNT", "BLOCKED_FIELD_GOAL", "SPECIAL_TEAMS_SAFETY", "KICK_RETURN_TOUCHDOWN", "PUNT_RETURN_TOUCHDOWN", "BLOCKED_KICK_RETURN_TOUCHDOWN", "OTHER_SPECIAL_TEAMS_TOUCHDOWN"]);
  const alreadyCreditedPlayEventPrefixes = new Set(Array.from(knownKeys).filter((key): key is string => Boolean(key) && perPlaySingleCreditTypes.has(key!.split(":")[1] ?? "")).map(key => key.split(":").slice(0, 2).join(":")));
  const currentCandidateKeys = new Set<string>(boxConfirmedExistingKeys);
  const planned: ReconcilePlannedAction[] = [];
  for (const candidate of candidates) {
    if (perPlaySingleCreditTypes.has(candidate.eventType)) {
      const prefix = candidate.sourceEventKey.split(":").slice(0, 2).join(":");
      if (alreadyCreditedPlayEventPrefixes.has(prefix) && !knownKeys.has(candidate.sourceEventKey)) continue;
    }
    if (candidate.eventType === "FUMBLE_LOST" && !candidate.sourceEventKey.endsWith(":box")) {
      const boxScoreKeyForThisPosition = `${candidate.sourceGameId}:FUMBLE_LOST:${candidate.position}:box`;
      if (knownKeys.has(boxScoreKeyForThisPosition)) continue;
    }
    const slot = selectedSchoolPositions.find(selection => normalizeSchoolForComparison(selection.schoolName) === normalizeSchoolForComparison(candidate.schoolName) && selection.position === candidate.position);
    if (!slot) continue;
    currentCandidateKeys.add(candidate.sourceEventKey);
    const rules = await getScoringRulesForEvent(candidate.eventType as never);
    const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
    const original = originalByKey.get(candidate.sourceEventKey);
    if (!original) {
      planned.push({ action: "insert", eventType: candidate.eventType, school: candidate.schoolName, position: candidate.position, owner: slot.ownerName, points: score.points, note: candidate.note, key: candidate.sourceEventKey });
      if (!dryRun) await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRowId, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: candidate.note, audit_action: "ENTRY", recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: candidate.sourceEventKey, source_game_id: candidate.sourceGameId, is_provisional: false } });
      // This "new" official candidate may just be the final-data confirmation of a real play a
      // live-detected entry already covers under its synthetic key - if one's still active for
      // this exact (slot, eventType), it's now a confirmed duplicate. Reverse it (FIFO, same as
      // the main automation) rather than leaving both rows counting toward the total.
      const pendingGroupKey = `${slot.draftSlotId}:${candidate.eventType}`;
      const stalePending = pendingLiveBySlotEventType.get(pendingGroupKey)?.shift();
      if (stalePending) {
        const staleReversalKey = `${stalePending.source_event_key}:reversal`;
        if (!reversedKeys.has(staleReversalKey)) {
          planned.push({ action: "reversal", eventType: stalePending.event_type, school: candidate.schoolName, position: candidate.position, owner: slot.ownerName, points: sourceEventReversalPoints(stalePending.computed_points), note: `superseded by confirmed official play ${candidate.sourceEventKey}`, key: stalePending.source_event_key! });
          if (!dryRun) await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: stalePending.week_id, draft_slot_id: stalePending.draft_slot_id, event_type: stalePending.event_type, stat_value: stalePending.stat_value, yard_distance: stalePending.yard_distance, computed_points: sourceEventReversalPoints(stalePending.computed_points), note: `Superseded by confirmed official play ${candidate.sourceEventKey} (via reconcileGameAgainstFinalData)`, audit_action: "REVERSAL", correction_of_event_id: stalePending.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: staleReversalKey, source_game_id: game.id, is_provisional: false } });
          reversedKeys.add(staleReversalKey);
        }
      }
    } else if (sourceEventNeedsCorrection({ ...original, computed_points: currentEffectivePoints(original, eventRows) }, { points: score.points, yardDistance: candidate.yardDistance, statValue: candidate.statValue })) {
      const effectivePoints = currentEffectivePoints(original, eventRows);
      planned.push({ action: "correction", eventType: candidate.eventType, school: candidate.schoolName, position: candidate.position, owner: slot.ownerName, points: score.points - effectivePoints, note: `corrects ${effectivePoints} -> ${score.points}`, key: candidate.sourceEventKey });
      if (!dryRun) {
        // The correction key is deterministic (sourceEventKey + target points/yardage/statValue), so a
        // correction that already ran once - most often because points now match (the effective total
        // already reflects an earlier correction) but stat_value or yard_distance still differs from the
        // original ENTRY's own stored value, which sourceEventNeedsCorrection also checks - produces the
        // exact same key on every subsequent run and hits b36_scoring_events_source_event_key_unique.
        // The main automation loop already guards this with the same knownKeys check; this path never
        // had it. Confirmed live: applying Old Dominion QB post-fix 500'd on this exact collision.
        const correctionKey = `${candidate.sourceEventKey}:correction:${score.points}:${candidate.yardDistance ?? "none"}:${candidate.statValue}`;
        if (!knownKeys.has(correctionKey)) {
          await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points - effectivePoints, note: `Official CFBD final correction updated source event ${candidate.sourceEventKey} (via reconcileGameAgainstFinalData)`, audit_action: "CORRECTION", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: correctionKey, source_game_id: candidate.sourceGameId, is_provisional: false } });
          knownKeys.add(correctionKey);
        }
        await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
      }
    } else if (original.is_provisional) {
      planned.push({ action: "confirm-official", eventType: candidate.eventType, school: candidate.schoolName, position: candidate.position, owner: slot.ownerName, points: currentEffectivePoints(original, eventRows), note: "matches final data, already correct - just marking official", key: candidate.sourceEventKey });
      if (!dryRun) await supabaseRest("b36_scoring_events", { method: "PATCH", query: { id: `eq.${original.id}` }, body: { is_provisional: false } });
    }
  }
  // The reversal step this tool exists for: any PROVISIONAL entry from an earlier (possibly buggy)
  // tick that final data no longer confirms. Never touches an already-official row - a wrong
  // official entry needs the correction path above (which requires a fresh matching candidate) or
  // a manual reverseScoreEvent, not a blanket reversal.
  for (const original of eventRows.filter(row => row.audit_action === "ENTRY" && row.is_provisional && row.source_event_key && !currentCandidateKeys.has(row.source_event_key))) {
    const reversalKey = `${original.source_event_key}:reversal`;
    if (reversedKeys.has(reversalKey)) continue;
    const slot = selectedSchoolPositions.find(selection => selection.draftSlotId === original.draft_slot_id);
    planned.push({ action: "reversal", eventType: original.event_type, school: slot?.schoolName ?? "Unknown", position: slot?.position ?? "?", owner: slot?.ownerName ?? "Unknown", points: sourceEventReversalPoints(currentEffectivePoints(original, eventRows)), note: `no longer confirmed by final data - ${original.recorded_by_open_id} entry is stale`, key: original.source_event_key! });
    if (!dryRun) await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: original.event_type, stat_value: original.stat_value, yard_distance: original.yard_distance, computed_points: sourceEventReversalPoints(currentEffectivePoints(original, eventRows)), note: `Reconciled against final CFBD data via reconcileGameAgainstFinalData, reversed source event ${original.source_event_key}`, audit_action: "REVERSAL", correction_of_event_id: original.id, recorded_by_open_id: "cfbd-final-reconciliation", source_event_key: reversalKey, source_game_id: game.id, is_provisional: false } });
  }
  return { planned, boxScoreUnavailableFor };
}
