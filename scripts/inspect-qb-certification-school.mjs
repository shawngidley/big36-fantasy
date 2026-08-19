import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Air Force";
const playReport = JSON.parse(await readFile("/tmp/qb_2025_certification_report.json", "utf8"));
const boxReport = JSON.parse(await readFile("/tmp/qb_2025_boxscore_certification.json", "utf8"));
const play = playReport.rows.find(row => row.school_name === school);
const box = boxReport.rows.find(row => row.school_name === school);
if (!play || !box) throw new Error(`Missing certification rows for ${school}.`);
const boxByGame = new Map(box.game_totals.map(row => [row.game_id, row]));
const eventRows = play.events.map(event => ({ game_id: event.game_id, type: event.type, text: event.text, qb_pass_td: event.qb_pass_td, qb_rush_td: event.qb_rush_td, qb_interception: event.qb_interception, attribution: event.attribution, boxscore: boxByGame.get(event.game_id) ?? null }));
console.log(JSON.stringify({ school, boxscore_totals: box.official_boxscore, play_totals: play.certified, event_rows: eventRows }, null, 2));
