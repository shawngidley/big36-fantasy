import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Air Force";
const categoryName = process.argv[3] ?? "kicking";
const safeName = school.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const rosterRows = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safeName}.json`, "utf8"));
const boxes = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/boxscores/${safeName}.json`, "utf8"));
const roster = rosterRows.filter(player => ["K", "PK", "P", "RB", "FB", "WR", "TE"].includes(String(player.position ?? "").toUpperCase())).map(player => ({ id: player.id, name: `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim(), position: player.position }));
const games = boxes.slice(0, 2).map(box => {
  const team = box.teams?.find(item => normal(item.team) === normal(school));
  const category = team?.categories?.find(item => normal(item.name) === normal(categoryName));
  return { game_id: box.id, team: team?.team, category: category?.name, types: (category?.types ?? []).map(type => ({ name: type.name, athletes: type.athletes })) };
});
console.log(JSON.stringify({ school, categoryName, roster, games }, null, 2));
