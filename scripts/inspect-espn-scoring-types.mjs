import { readFile } from 'node:fs/promises';

const summary = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/espn_summaries/401752780.json', 'utf8'));
console.log(JSON.stringify((summary.scoringPlays ?? []).map(play => ({ type: play.type?.text, text: play.text, score_value: play.scoreValue })), null, 2));
