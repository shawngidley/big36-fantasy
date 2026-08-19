import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Baylor";
const playReport = JSON.parse(await readFile("/tmp/qb_2025_certification_report.json", "utf8"));
const boxReport = JSON.parse(await readFile("/tmp/qb_2025_boxscore_certification.json", "utf8"));
const play = playReport.rows.find(row => row.school_name === school);
const box = boxReport.rows.find(row => row.school_name === school);
if (!play || !box) throw new Error(`Missing data for ${school}`);
const playByGame = new Map();
for (const event of play.events) {
  const totals = playByGame.get(event.game_id) ?? { passing_touchdowns: 0, rushing_touchdowns: 0, interceptions: 0, events: [] };
  totals.passing_touchdowns += event.qb_pass_td ? 1 : 0;
  totals.rushing_touchdowns += event.qb_rush_td ? 1 : 0;
  totals.interceptions += event.qb_interception ? 1 : 0;
  totals.events.push({ type: event.type, text: event.text, qb_pass_td: event.qb_pass_td, qb_rush_td: event.qb_rush_td, qb_interception: event.qb_interception });
  playByGame.set(event.game_id, totals);
}
const result = box.game_totals.map(game => ({ game_id: game.game_id, boxscore: game, play_by_play: playByGame.get(game.game_id) ?? { passing_touchdowns: 0, rushing_touchdowns: 0, interceptions: 0, events: [] } })).filter(row => row.boxscore.qb_passing_touchdowns !== row.play_by_play.passing_touchdowns || row.boxscore.qb_rushing_touchdowns !== row.play_by_play.rushing_touchdowns || row.boxscore.qb_interceptions !== row.play_by_play.interceptions);
console.log(JSON.stringify({ school, mismatches: result }, null, 2));
