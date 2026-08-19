import { readFile } from 'node:fs/promises';

const types = new Map();
const samples = new Map();
for (let week = 1; week <= 16; week += 1) {
  const stats = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/play_stats_week_${week}.json`, 'utf8'));
  for (const stat of stats) {
    const type = String(stat.statType ?? '');
    if (!/block/i.test(type)) continue;
    types.set(type, (types.get(type) ?? 0) + Number(stat.stat ?? 0));
    const entries = samples.get(type) ?? [];
    if (entries.length < 8) entries.push({ game_id: stat.gameId, play_id: stat.playId, team: stat.team, athlete: stat.athleteName, stat: stat.stat });
    samples.set(type, entries);
  }
}
console.log(JSON.stringify({ totals: Object.fromEntries([...types.entries()].sort((left, right) => left[0].localeCompare(right[0]))), samples: Object.fromEntries(samples) }, null, 2));
