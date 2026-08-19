import { readFile, writeFile } from "node:fs/promises";

const beforeResult = JSON.parse(await readFile("/home/ubuntu/.mcp/tool-results/2026-08-19_00-32-29.804916950_supabase_execute_sql_b5782054.json", "utf8")).result;
const beforePayload = beforeResult.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/)?.[1];
if (!beforePayload) throw new Error("Could not extract the pre-audit catalog snapshot.");
const beforeRows = JSON.parse(beforePayload);
const afterRows = JSON.parse(await readFile("/tmp/big36_2025_research_summary.json", "utf8")).rows;
const keyFor = row => `${row.school_name}::${row.position}`;
const beforeByKey = new Map(beforeRows.map(row => [keyFor(row), row]));
const changes = afterRows.map(after => {
  const before = beforeByKey.get(keyFor(after));
  if (!before) throw new Error(`Missing pre-audit row for ${keyFor(after)}.`);
  const officialDelta = Number(after.official_points) - Number(before.official_points);
  const normalizedDelta = Number(after.normalized_points) - Number(before.normalized_points);
  return { school_name: after.school_name, position: after.position, before_official_points: Number(before.official_points), after_official_points: Number(after.official_points), official_delta: officialDelta, before_normalized_points: Number(before.normalized_points), after_normalized_points: Number(after.normalized_points), normalized_delta: normalizedDelta, before_event_counts: before.event_counts, after_event_counts: after.event_counts };
}).filter(change => change.official_delta !== 0 || change.normalized_delta !== 0);
const byPosition = Object.fromEntries(["QB", "RB", "WR", "TE", "K_ST", "DEF"].map(position => {
  const unitChanges = changes.filter(change => change.position === position);
  return [position, { units_changed: unitChanges.length, official_point_delta: unitChanges.reduce((sum, change) => sum + change.official_delta, 0), normalized_point_delta: Number(unitChanges.reduce((sum, change) => sum + change.normalized_delta, 0).toFixed(2)) }];
}));
const report = { total_units: afterRows.length, changed_units: changes.length, by_position: byPosition, largest_absolute_changes: [...changes].sort((a, b) => Math.abs(b.official_delta) - Math.abs(a.official_delta)).slice(0, 25), all_changes: changes };
await writeFile("/tmp/big36_2025_research_audit_comparison.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total_units: report.total_units, changed_units: report.changed_units, by_position: report.by_position, largest_absolute_changes: report.largest_absolute_changes.slice(0, 10) }, null, 2));
