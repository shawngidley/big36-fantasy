import { readFile, writeFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('/tmp/cfbfastR_2025_offensive_td_ledger.json', 'utf8'));
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const summary = new Map();
for (const event of report.unassigned_events) {
  const text = String(event.text ?? '');
  const category = event.kind === 'pass'
    ? `pass:${event.passer_position ?? 'missing-passer'}:${event.receiver_position ?? 'missing-receiver'}`
    : `rush:${event.rusher_position ?? 'missing-rusher'}`;
  const key = `${category}::${normalize(text).replace(/\d+/g, '#').slice(0, 180)}`;
  const entry = summary.get(key) ?? { category, count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 4) entry.examples.push(event);
  summary.set(key, entry);
}
const groups = [...summary.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
const output = { total: report.unassigned_events.length, categories: groups };
await writeFile('/tmp/cfbfastR_2025_unassigned_offensive_events_summary.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/cfbfastR_2025_unassigned_offensive_events_summary.json', total: output.total, categories: groups.slice(0, 20) }, null, 2));
