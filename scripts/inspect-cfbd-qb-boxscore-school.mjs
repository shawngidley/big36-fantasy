import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Akron";
const safe = school.toLowerCase().replace(/[^a-z0-9]+/g, "_");
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8")).filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].includes(school)).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12);
const roster = new Map(JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safe}.json`, "utf8")).map(player => [String(player.id), String(player.position).toUpperCase()]));
const boxes = new Map(JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/boxscores/${school.replace(/[^a-z0-9]+/gi, "_")}.json`, "utf8")).map(box => [Number(box.id), box]));
const collect = (team, categoryName, typeName) => {
  const type = team?.categories?.find(category => String(category.name).toLowerCase() === categoryName)?.types?.find(item => String(item.name).toLowerCase() === typeName);
  return (type?.athletes ?? []).filter(athlete => roster.get(String(athlete.id)) === "QB").map(athlete => ({ name: athlete.name, stat: Number(String(athlete.stat ?? 0).replace(/[^0-9.-]/g, "")) }));
};
const rows = games.map(game => {
  const team = boxes.get(game.id)?.teams?.find(item => String(item.team).toLowerCase() === school.toLowerCase());
  return { game_id: game.id, week: game.week, opponent: game.homeTeam === school ? game.awayTeam : game.homeTeam, passing_td: collect(team, "passing", "td"), rushing_td: collect(team, "rushing", "td"), interceptions: collect(team, "passing", "int") };
});
console.log(JSON.stringify({ school, rows }, null, 2));
