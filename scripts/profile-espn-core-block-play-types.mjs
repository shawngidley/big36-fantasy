import { readFile, readdir, writeFile } from 'node:fs/promises';

const totals = new Map();
const samples = new Map();
for (const file of await readdir('/tmp/espn_core_2025_scoring_plays')) {
  if (!file.endsWith('.json')) continue;
  const gameId = Number(file.replace('.json', ''));
  const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${file}`, 'utf8'));
  for (const play of core.items ?? []) {
    const type = String(play.type?.text ?? 'unknown');
    const text = String(play.text ?? '');
    if (!/block/i.test(`${type} ${text}`)) continue;
    totals.set(type, (totals.get(type) ?? 0) + 1);
    const entries = samples.get(type) ?? [];
    if (entries.length < 8) entries.push({ game_id: gameId, scoring: Boolean(play.scoringPlay), score_value: play.scoreValue, team_ref: play.team?.$ref ?? null, text });
    samples.set(type, entries);
  }
}
const output = { totals: Object.fromEntries([...totals.entries()].sort((left, right) => left[0].localeCompare(right[0]))), samples: Object.fromEntries(samples) };
await writeFile('/tmp/espn_core_2025_block_play_type_profile.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
