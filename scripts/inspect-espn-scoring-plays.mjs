import { readFile } from "node:fs/promises";

const gameId = process.argv[2] ?? "401754525";
const summary = JSON.parse(await readFile(`/tmp/espn_game_${gameId}_summary.json`, "utf8"));
const plays = summary.scoringPlays ?? [];
const competitors = summary.header?.competitions?.[0]?.competitors?.map(competitor => ({ id: competitor.team?.id, display_name: competitor.team?.displayName, home_away: competitor.homeAway, winner: competitor.winner })) ?? [];
console.log(JSON.stringify({ competitors, plays: plays.map(play => ({ id: play.id, period: play.period?.number, clock: play.clock?.displayValue, team_id: play.team?.id, team: play.team?.displayName, type: play.type?.text, text: play.text, score_value: play.scoreValue, home_score: play.homeScore, away_score: play.awayScore })) }, null, 2));
