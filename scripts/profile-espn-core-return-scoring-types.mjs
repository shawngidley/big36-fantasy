import { readFile, readdir, writeFile } from 'node:fs/promises';

const samplesByType = new Map();
for (const file of await readdir('/tmp/espn_core_2025_scoring_plays')) {
  if (!file.endsWith('.json')) continue;
  const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${file}`, 'utf8'));
  for (const play of core.items ?? []) {
    if (!play.scoringPlay || Number(play.scoreValue) !== 6 || !/return/i.test(`${play.type?.text ?? ''} ${play.text ?? ''}`)) continue;
    const type = String(play.type?.text ?? 'unknown');
    const samples = samplesByType.get(type) ?? [];
    if (samples.length < 5) samples.push({ game_id: Number(file.replace('.json', '')), team_ref: play.team?.$ref ?? null, text: play.text });
    samplesByType.set(type, samples);
  }
}
const output = Object.fromEntries([...samplesByType.entries()].sort((left, right) => left[0].localeCompare(right[0])));
await writeFile('/tmp/espn_core_2025_return_scoring_type_profile.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
