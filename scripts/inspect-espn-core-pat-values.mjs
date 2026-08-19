import { readFile } from 'node:fs/promises';

const gameId = process.argv[2] ?? '401752780';
const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${gameId}.json`, 'utf8'));
console.log(JSON.stringify((core.items ?? []).filter(play => play.scoringPlay).map(play => ({ id: play.id, type: play.type?.text, score_value: play.scoreValue, text: play.text })), null, 2));
