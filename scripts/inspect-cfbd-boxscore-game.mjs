import { readFile } from "node:fs/promises";

const school = process.argv[2] ?? "Akron";
const gameId = Number(process.argv[3] ?? 401762789);
const path = `/tmp/big36_2025_cfbd_cache/boxscores/${school.replace(/[^a-z0-9]+/gi, "_")}.json`;
const boxes = JSON.parse(await readFile(path, "utf8"));
const box = boxes.find(row => Number(row.id) === gameId);
if (!box) throw new Error(`Missing box ${gameId} in ${path}.`);
console.log(JSON.stringify(box, null, 2));
