import { readFile } from 'node:fs/promises';

const types = new Map();
for (let week = 1; week <= 16; week += 1) {
  const stats = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/play_stats_week_${week}.json`, 'utf8'));
  for (const stat of stats) {
    const type = String(stat.statType ?? '');
    if (!/sack|interception|fumble/i.test(type)) continue;
    types.set(type, (types.get(type) ?? 0) + Number(stat.stat ?? 0));
  }
}
console.log(JSON.stringify(Object.fromEntries([...types.entries()].sort((left, right) => left[0].localeCompare(right[0]))), null, 2));
