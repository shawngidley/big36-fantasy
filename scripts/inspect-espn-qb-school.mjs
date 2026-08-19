import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Akron";
const report = JSON.parse(await readFile("/tmp/qb_2025_espn_boxscore_certification.json", "utf8"));
const row = report.rows.find(item => item.school_name === school);
if (!row) throw new Error(`Missing ${school}`);
const roster = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${school.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.json`, "utf8"));
const eventsByGame = new Map();
for (const event of row.events) eventsByGame.set(event.game_id, [...(eventsByGame.get(event.game_id) ?? []), event]);
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8")).filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].includes(school)).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12);
console.log(JSON.stringify({ school, official_boxscore: row.official_boxscore, espn_scoring_summary: row.espn_scoring_summary, qbs: roster.filter(player => String(player.position).toUpperCase() === "QB").map(player => ({ id: player.id, name: `${player.firstName} ${player.lastName}` })), games: games.map(game => ({ id: game.id, week: game.week, home: game.homeTeam, away: game.awayTeam, espn_events: eventsByGame.get(game.id) ?? [] })) }, null, 2));
