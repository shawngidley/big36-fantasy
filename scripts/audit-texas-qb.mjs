import { readFile, writeFile } from "node:fs/promises";

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = value => normal(value).replace(/[^a-z0-9]+/g, " ").trim();
const rosterPosition = value => ({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", K: "K_ST", P: "K_ST" }[String(value ?? "").toUpperCase()] ?? null);
const school = "Texas";
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8"));
const selected = games.filter(game => game.seasonType === "regular" && (normal(game.homeTeam) === normal(school) || normal(game.awayTeam) === normal(school))).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12);
const rawRoster = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/roster_texas.json", "utf8"));
const roster = new Map(rawRoster.map(player => [String(player.id), { position: rosterPosition(player.position), name: nameKey(`${player.firstName ?? ""} ${player.lastName ?? ""}`), short: nameKey(`${String(player.firstName ?? "").slice(0, 1)} ${player.lastName ?? ""}`) }]));
const offensivePositions = ["QB", "RB", "WR", "TE"];
const positionForAthlete = athleteId => roster.get(String(athleteId))?.position ?? null;
const mentioned = text => {
  const value = ` ${nameKey(text)} `;
  const positions = new Set();
  for (const athlete of roster.values()) if (athlete.position && ((athlete.name.length >= 5 && value.includes(` ${athlete.name} `)) || (athlete.short.length >= 3 && value.includes(` ${athlete.short} `)))) positions.add(athlete.position);
  return [...positions];
};
const entries = [];
for (const game of selected) {
  const week = game.week;
  const plays = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, "utf8"));
  const stats = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/play_stats_week_${week}.json`, "utf8"));
  const statsByPlay = new Map();
  for (const stat of stats) statsByPlay.set(stat.playId, [...(statsByPlay.get(stat.playId) ?? []), stat]);
  for (const play of plays.filter(play => play.gameId === game.id && normal(play.offense) === normal(school) && /passing touchdown|rushing touchdown|interception/.test(`${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase()))) {
    const sourceStats = (statsByPlay.get(play.id) ?? []).filter(stat => normal(stat.team) === normal(school) && Number(stat.stat) !== 0);
    const type = String(play.playType ?? "").toLowerCase();
    const statTypes = sourceStats.map(stat => ({ type: stat.statType, value: stat.stat, position: positionForAthlete(stat.athleteId), athlete: roster.get(String(stat.athleteId))?.name ?? String(stat.athleteId) }));
    const completionPositions = new Set(statTypes.filter(stat => String(stat.type).toLowerCase().includes("completion") || String(stat.type).toLowerCase().includes("passing touchdown")).map(stat => stat.position).filter(Boolean));
    const rushPositions = new Set(statTypes.filter(stat => String(stat.type).toLowerCase().includes("rush")).map(stat => stat.position).filter(Boolean));
    entries.push({ game_id: game.id, date: game.startDate.slice(0, 10), opponent: normal(game.homeTeam) === normal(school) ? game.awayTeam : game.homeTeam, play_id: play.id, play_type: play.playType, scoring_flag: Boolean(play.scoring), yards_to_goal: play.yardsToGoal, play_text: play.playText, mentioned_positions: mentioned(play.playText), completion_positions: [...completionPositions], rush_positions: [...rushPositions], current_passing: type.includes("passing touchdown") || completionPositions.has("QB"), current_rushing: type.includes("rushing touchdown") || rushPositions.size > 0, interception_play: /interception/.test(`${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase()), interception_qb_stat: statTypes.some(stat => String(stat.type).toLowerCase().includes("interception") && stat.position === "QB"), source_stats: statTypes });
  }
}
const report = { selected_games: selected.map(game => ({ id: game.id, date: game.startDate.slice(0, 10), opponent: normal(game.homeTeam) === normal(school) ? game.awayTeam : game.homeTeam })), scoring_plays: entries, counts: { canonical_passing: entries.filter(entry => String(entry.play_type).toLowerCase().includes("passing touchdown")).length, canonical_rushing: entries.filter(entry => String(entry.play_type).toLowerCase().includes("rushing touchdown")).length, interception_plays: entries.filter(entry => entry.interception_play).length, interception_qb_stats: entries.filter(entry => entry.interception_qb_stat).length, scoring_flag_false: entries.filter(entry => !entry.scoring_flag).length, current_passing: entries.filter(entry => entry.current_passing).length, current_rushing: entries.filter(entry => entry.current_rushing).length } };
await writeFile("/tmp/texas_qb_attribution_audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ selected_games: report.selected_games, counts: report.counts, scoring_plays: entries.map(entry => ({ date: entry.date, type: entry.play_type, current_passing: entry.current_passing, current_rushing: entry.current_rushing, mentioned_positions: entry.mentioned_positions, text: entry.play_text })) }, null, 2));
