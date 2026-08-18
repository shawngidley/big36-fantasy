import { getFbsTeams, getLiveScoreboard, getRegularSeasonGames, getRoster, getWeekPlays, getWeekPlayStats, type CfbdGame, type CfbdRosterAthlete } from "./cfbd";
import { getLeagueSnapshot, getScoringRulesForEvent } from "./league-data";
import { calculateEventScore } from "./league-scoring";
import { eligibleGameIdsForSchool, mapLivePlayToCandidates, type LivePosition } from "./live-scoring";
import { supabaseRest } from "./supabase";

type AutomationConfig = { season: number; enabled: boolean; last_refresh_at: string | null; schedule_cron_task_uid: string | null };
type SourceEvent = { id: string; source_event_key: string | null; source_game_id: number | null; audit_action: string };

const sourceGameValues = (game: CfbdGame) => ({ cfbd_game_id: game.id, season: game.season, week_number: game.week, season_type: game.seasonType, start_date: game.startDate, completed: game.completed, home_team: game.homeTeam, away_team: game.awayTeam, home_classification: game.homeClassification ?? null, away_classification: game.awayClassification ?? null, home_points: game.homePoints ?? null, away_points: game.awayPoints ?? null, updated_at: new Date().toISOString() });

async function writeRefreshStatus(values: Record<string, unknown>) {
  await supabaseRest("b36_automation_config", { method: "PATCH", query: { id: "eq.true" }, body: { ...values, last_refresh_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
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
  try {
    const schedule = await syncFbsPoolAndSchedule(config.season);
    const snapshot = await getLeagueSnapshot();
    const selectedSchoolPositions = snapshot.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as LivePosition, draftSlotId: pick.id })));
    const scoreboard = await getLiveScoreboard();
    const activeGames = scoreboard.filter(game => game.id && !/final|completed/i.test(game.status ?? "")).map(game => schedule.games.find(source => source.id === game.id)).filter((game): game is CfbdGame => Boolean(game));
    const relevantGames = activeGames.filter(game => selectedSchoolPositions.some(selection => selection.schoolName === game.homeTeam || selection.schoolName === game.awayTeam));
    let insertedEvents = 0;
    const byWeek = new Map<number, CfbdGame[]>();
    for (const game of relevantGames) byWeek.set(game.week, [...(byWeek.get(game.week) ?? []), game]);
    for (const [week, games] of Array.from(byWeek.entries())) {
      const [plays, stats] = await Promise.all([getWeekPlays(config.season, week), getWeekPlayStats(config.season, week)]);
      const schools = Array.from(new Set<string>(games.flatMap(game => [game.homeTeam, game.awayTeam]).filter(school => selectedSchoolPositions.some(selection => selection.schoolName === school))));
      const rosterEntries: Array<[string, CfbdRosterAthlete[]]> = await Promise.all(schools.map(async school => [school, await getRoster(school, config.season)]));
      const rosters = new Map<string, CfbdRosterAthlete[]>(rosterEntries);
      const weekRow = snapshot.weeks.find(item => item.weekNumber === week);
      if (!weekRow) continue;
      const eventRows = await supabaseRest<SourceEvent[]>("b36_scoring_events", { query: { select: "id,source_event_key,source_game_id,audit_action", source_game_id: `in.(${games.map(game => game.id).join(",")})` } });
      const knownKeys = new Set(eventRows.filter(row => row.source_event_key && row.audit_action !== "REVERSAL").map(row => row.source_event_key));
      for (const game of games) {
        for (const school of [game.homeTeam, game.awayTeam]) {
          const roster = rosters.get(school) ?? [];
          const eligibleIds = eligibleGameIdsForSchool(schedule.games, school);
          if (!eligibleIds.includes(game.id)) continue;
          const candidates = plays.filter(play => play.gameId === game.id && play.offense === school).flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => stat.playId === play.id), roster, selectedSchoolPositions: selectedSchoolPositions.filter(selection => selection.schoolName === school).map(selection => ({ schoolName: selection.schoolName, position: selection.position })), provisional: true }));
          for (const candidate of candidates.filter(candidate => !knownKeys.has(candidate.sourceEventKey))) {
            const slot = selectedSchoolPositions.find(selection => selection.schoolName === candidate.schoolName && selection.position === candidate.position);
            if (!slot) continue;
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: candidate.note, audit_action: "ENTRY", recorded_by_open_id: "cfbd-live-refresh", source_event_key: candidate.sourceEventKey, source_game_id: candidate.sourceGameId, is_provisional: true } });
            knownKeys.add(candidate.sourceEventKey); insertedEvents += 1;
          }
        }
      }
    }
    await writeRefreshStatus({ last_refresh_status: "ok", last_refresh_detail: { active_games: relevantGames.length, inserted_events: insertedEvents, team_count: schedule.teamCount } });
    return { activeGames: relevantGames.length, insertedEvents, teamCount: schedule.teamCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    await writeRefreshStatus({ last_refresh_status: "error", last_refresh_detail: { message } });
    throw error;
  }
}
