import { getFbsTeams, getLivePlays, getLiveScoreboard, getRegularSeasonGames, getRoster, getWeekPlays, getWeekPlayStats, type CfbdGame, type CfbdLiveGame, type CfbdPlay, type CfbdRosterAthlete } from "./cfbd";
import { getLeagueSnapshot, getScoringRulesForEvent } from "./league-data";
import { calculateEventScore } from "./league-scoring";
import { eligibleGameIdsForSchool, finalShutoutCandidates, isSupersededInterceptionPlay, mapLivePlayToCandidates, type LivePosition } from "./live-scoring";
import { supabaseRest } from "./supabase";

type AutomationConfig = { season: number; enabled: boolean; last_refresh_at: string | null; schedule_cron_task_uid: string | null };
type SourceEvent = { id: string; source_event_key: string | null; source_game_id: number | null; audit_action: string; week_id: string; draft_slot_id: string; event_type: string; stat_value: number; yard_distance: number | null; computed_points: number; is_provisional: boolean };

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
  if (weekday === "Thu" || weekday === "Fri") return hour >= 16 || hour <= 2;
  if (weekday === "Sat") return hour >= 10;
  if (weekday === "Sun") return hour <= 3;
  return false;
}

async function writeRefreshStatus(values: Record<string, unknown>) {
  await supabaseRest("b36_automation_config", { method: "PATCH", query: { id: "eq.true" }, body: { ...values, last_refresh_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
}

// /plays only populates once a game finishes, so it's useless for detecting scoring as it happens.
// /live/plays has the real in-progress data, but nests plays under drives with a different shape
// (no offense/defense/gameId/scoring fields) — this adapts it into the shape mapLivePlayToCandidates
// already understands, so that function doesn't need to change at all.
export function adaptLiveGameToLegacyPlays(gameId: number, live: CfbdLiveGame): CfbdPlay[] {
  const teamNames = (live.teams ?? []).map(team => team.team);
  let previousHome = 0, previousAway = 0;
  return (live.drives ?? []).flatMap(drive => drive.plays).map(play => {
    const scoring = play.homeScore !== previousHome || play.awayScore !== previousAway;
    previousHome = play.homeScore; previousAway = play.awayScore;
    const defense = teamNames.find(name => name !== play.team) ?? "";
    // Live play ids are strings (e.g. "4018567663"); keep them distinct from /plays' numeric ids so a
    // provisional live-detected event and its eventual final-confirmed counterpart never collide —
    // the existing reversal logic already cleanly replaces provisional entries once a game completes.
    return { id: Number(`9${play.id}`.slice(0, 15)), gameId, offense: play.team, defense, yardsToGoal: play.yardsToGoal ?? null, yardsGained: play.yardsGained ?? null, scoring, playType: play.playType ?? null, playText: play.playText ?? null, period: play.period ?? null, clock: null };
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
    const relevantGames = scoreboardGames.filter(game => selectedSchoolPositions.some(selection => selection.schoolName === game.homeTeam || selection.schoolName === game.awayTeam));
    const trulyInProgress = relevantGames.filter(game => scoreboardStatusById.get(game.id) === "in_progress");
    let insertedEvents = 0;

    // Live detection: for games actually happening right now, use the real live-play feed to catch
    // scoring as it happens, rather than waiting for the game to finish (when /plays finally populates).
    // These insert as provisional events; once the game completes, the existing final-reconciliation
    // pass below naturally supersedes them (its keys differ, so old provisional entries get reversed
    // and replaced with the official confirmed ones — no double-counting).
    for (const game of trulyInProgress) {
      try {
        const live = await getLivePlays(game.id);
        const legacyPlays = adaptLiveGameToLegacyPlays(game.id, live);
        const existingRows = await supabaseRest<Array<{ source_event_key: string | null }>>("b36_scoring_events", { query: { select: "source_event_key", source_game_id: `eq.${game.id}`, audit_action: "eq.ENTRY" } });
        const knownLiveKeys = new Set(existingRows.filter(row => row.source_event_key).map(row => row.source_event_key));
        for (const school of [game.homeTeam, game.awayTeam]) {
          if (!selectedSchoolPositions.some(selection => selection.schoolName === school)) continue;
          const roster = await getRoster(school, config.season);
          const schoolPlays = legacyPlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, legacyPlays[index + 1]));
          const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: true }));
          for (const candidate of candidates) {
            if (knownLiveKeys.has(candidate.sourceEventKey)) continue;
            const slot = selectedSchoolPositions.find(selection => selection.schoolName === candidate.schoolName && selection.position === candidate.position);
            if (!slot) continue;
            const weekRow = snapshot.weeks.find(item => item.weekNumber === game.week);
            if (!weekRow) continue;
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: `${candidate.note} (live)`, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-detection", source_event_key: candidate.sourceEventKey, source_game_id: game.id, is_provisional: true } });
            knownLiveKeys.add(candidate.sourceEventKey); insertedEvents += 1;
          }
        }
      } catch { /* one game's live feed failing shouldn't block the rest of the refresh */ }
    }

    const byWeek = new Map<number, CfbdGame[]>();
    for (const game of relevantGames) byWeek.set(game.week, [...(byWeek.get(game.week) ?? []), game]);
    for (const [week, games] of Array.from(byWeek.entries())) {
      const [plays, stats] = await Promise.all([getWeekPlays(config.season, week), getWeekPlayStats(config.season, week)]);
      const schools = Array.from(new Set<string>(games.flatMap(game => [game.homeTeam, game.awayTeam]).filter(school => selectedSchoolPositions.some(selection => selection.schoolName === school))));
      const rosterEntries: Array<[string, CfbdRosterAthlete[]]> = await Promise.all(schools.map(async school => [school, await getRoster(school, config.season)]));
      const rosters = new Map<string, CfbdRosterAthlete[]>(rosterEntries);
      const weekRow = snapshot.weeks.find(item => item.weekNumber === week);
      if (!weekRow) continue;
      const eventRows = await supabaseRest<SourceEvent[]>("b36_scoring_events", { query: { select: "id,source_event_key,source_game_id,audit_action,week_id,draft_slot_id,event_type,stat_value,yard_distance,computed_points,is_provisional", source_game_id: `in.(${games.map(game => game.id).join(",")})` } });
      const knownKeys = new Set(eventRows.filter(row => row.source_event_key && row.audit_action !== "REVERSAL").map(row => row.source_event_key));
      const reversedKeys = new Set(eventRows.filter(row => row.audit_action === "REVERSAL" && row.source_event_key).map(row => row.source_event_key));
      const originalByKey = new Map(eventRows.filter(row => row.source_event_key && row.audit_action === "ENTRY").map(row => [row.source_event_key!, row]));
      for (const game of games) {
        const currentCandidateKeys = new Set<string>();
        const gameCandidates = [
          ...[game.homeTeam, game.awayTeam].flatMap(school => {
            const roster = rosters.get(school) ?? [];
            const eligibleIds = eligibleGameIdsForSchool(schedule.games, school);
            if (!eligibleIds.includes(game.id)) return [];
            return plays.filter((play, index) => play.gameId === game.id && play.offense === school && !isSupersededInterceptionPlay(play, plays[index + 1])).flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => stat.playId === play.id), roster, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }));
          }),
          ...finalShutoutCandidates({ game, selectedSchoolPositions: selectedSchoolPositions.map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: !game.completed }),
        ];
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
          const originalEvents = eventRows.filter(row => row.source_game_id === game.id && row.source_event_key && row.audit_action === "ENTRY");
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
    await writeRefreshStatus({ last_refresh_status: "ok", last_refresh_detail: { active_games: trulyInProgress.length, relevant_games: relevantGames.length, inserted_events: insertedEvents, team_count: schedule.teamCount } });
    return { activeGames: trulyInProgress.length, relevantGames: relevantGames.length, insertedEvents, teamCount: schedule.teamCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    await writeRefreshStatus({ last_refresh_status: "error", last_refresh_detail: { message } });
    throw error;
  }
}
