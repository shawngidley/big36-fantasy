import { readFile, writeFile } from "node:fs/promises";

const resultPath = process.argv[2] ?? "/home/ubuntu/.mcp/tool-results/2026-08-19_00-44-47.779829321_supabase_execute_sql_313a367e.json";
const result = JSON.parse(await readFile(resultPath, "utf8")).result;
const payload = result.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/)?.[1];
if (!payload) throw new Error("Could not extract the persisted catalog result.");
const persisted = JSON.parse(payload);
const calculated = JSON.parse(await readFile("/tmp/big36_2025_research_summary.json", "utf8")).rows;
const keyFor = row => `${row.school_name}::${row.position}`;
const persistedByKey = new Map(persisted.map(row => [keyFor(row), row]));
const mismatches = calculated.flatMap(row => {
  const stored = persistedByKey.get(keyFor(row));
  if (!stored) return [{ key: keyFor(row), reason: "missing persisted row" }];
  const fields = ["official_points", "normalized_points", "eligible_games", "normalization_factor"];
  const different = fields.filter(field => Number(stored[field]) !== Number(row[field]));
  return different.length === 0 ? [] : [{ key: keyFor(row), fields: different, expected: Object.fromEntries(different.map(field => [field, row[field]])), actual: Object.fromEntries(different.map(field => [field, stored[field]])) }];
});
const report = { calculated_units: calculated.length, persisted_units: persisted.length, mismatch_count: mismatches.length, mismatches };
await writeFile("/tmp/big36_2025_research_persist_verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ calculated_units: report.calculated_units, persisted_units: report.persisted_units, mismatch_count: report.mismatch_count, samples: report.mismatches.slice(0, 10) }, null, 2));
