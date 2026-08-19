import { readFile } from 'node:fs/promises';

const stats = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/play_stats_week_1.json', 'utf8'));
const interesting = stats.filter(stat => /sack|interception|fumble/i.test(String(stat.statType ?? ''))).slice(0, 30);
console.log(JSON.stringify(interesting, null, 2));
