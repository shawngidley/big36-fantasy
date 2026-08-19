import { readFile } from "node:fs/promises";

const source = process.argv[2] ?? "/tmp/big36_2025_cfbd_cache/boxscores/texas.json";
const games = JSON.parse(await readFile(source, "utf8"));
const firstTeam = games.flatMap(game => game.teams ?? [])[0];
const categories = (firstTeam?.categories ?? []).map(category => ({
  category: category.name,
  types: (category.types ?? []).map(type => type.name),
}));
console.log(JSON.stringify({ source, team: firstTeam?.team, categories }, null, 2));
