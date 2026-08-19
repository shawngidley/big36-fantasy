import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const season = 2025;
const cacheDir = '/tmp/espn_core_2025_scoring_plays';
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const selectedGameIds = new Set();
for (const team of teams) {
  const selected = games
    .filter((game) => game.seasonType === 'regular' && (normalize(game.homeTeam) === normalize(team.school) || normalize(game.awayTeam) === normalize(team.school)))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || Number(a.id) - Number(b.id))
    .slice(0, 12);
  selected.forEach((game) => selectedGameIds.add(Number(game.id)));
}

await mkdir(cacheDir, { recursive: true });
const ids = [...selectedGameIds].sort((a, b) => a - b);
const concurrency = 6;
let fetched = 0;
let reused = 0;
const failures = [];

async function loadGame(gameId) {
  const cachePath = path.join(cacheDir, `${gameId}.json`);
  try {
    JSON.parse(await readFile(cachePath, 'utf8'));
    reused += 1;
    return;
  } catch {}

  const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${gameId}/competitions/${gameId}/plays?limit=1000`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      await writeFile(cachePath, JSON.stringify(payload));
      fetched += 1;
      return;
    } catch (error) {
      if (attempt === 3) failures.push({ game_id: gameId, error: String(error) });
      else await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}

for (let index = 0; index < ids.length; index += concurrency) {
  await Promise.all(ids.slice(index, index + concurrency).map(loadGame));
  if ((index / concurrency) % 20 === 0) console.log(`processed ${Math.min(index + concurrency, ids.length)} of ${ids.length}`);
}

const summary = { season, selected_games: ids.length, fetched, reused, failures };
await writeFile('/tmp/espn_core_2025_first12_cache_summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
