import { writeFile } from "node:fs/promises";

const gameId = process.argv[2] ?? "401754525";
const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${gameId}`, { signal: AbortSignal.timeout(60000) });
const body = await response.text();
await writeFile(`/tmp/espn_game_${gameId}_summary.json`, body);
console.log(JSON.stringify({ status: response.status, bytes: body.length, path: `/tmp/espn_game_${gameId}_summary.json`, preview: body.slice(0, 500) }, null, 2));
