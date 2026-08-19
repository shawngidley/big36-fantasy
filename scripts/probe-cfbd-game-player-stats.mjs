import { writeFile } from "node:fs/promises";

const key = process.env.CFBD_API_KEY;
if (!key) throw new Error("CFBD_API_KEY is required.");
const gameId = 401752677;
const response = await fetch(`https://api.collegefootballdata.com/games/players?year=2025&week=1&team=Texas&gameId=${gameId}`, { headers: { Authorization: `Bearer ${key}` } });
const body = await response.text();
await writeFile("/tmp/cfbd_texas_week1_player_stats.json", body);
console.log(JSON.stringify({ status: response.status, bytes: body.length, path: "/tmp/cfbd_texas_week1_player_stats.json" }, null, 2));
