import { readFile, writeFile } from "node:fs/promises";

const report = JSON.parse(await readFile("/tmp/qb_2025_espn_boxscore_certification.json", "utf8"));
const exceptions = report.rows.filter(row => !row.boxscore_match).map(row => ({
  school_name: row.school_name,
  passing_delta: row.espn_scoring_summary.passing_touchdowns - row.official_boxscore.passing_touchdowns,
  rushing_delta: row.espn_scoring_summary.rushing_touchdowns - row.official_boxscore.rushing_touchdowns,
  interception_delta: row.espn_scoring_summary.interceptions - row.official_boxscore.interceptions,
  unmatched_tiers: row.espn_scoring_summary.tier_events_without_cfbd_match,
}));
const byPattern = Object.values(exceptions.reduce((groups, row) => {
  const key = `pass:${row.passing_delta}|rush:${row.rushing_delta}|int:${row.interception_delta}|unmatched:${row.unmatched_tiers}`;
  (groups[key] ??= { pattern: key, count: 0, schools: [] }).count += 1;
  groups[key].schools.push(row.school_name);
  return groups;
}, {})).sort((a, b) => b.count - a.count);
const output = { summary: { exceptions: exceptions.length, by_pattern: byPattern }, exceptions };
await writeFile("/tmp/qb_2025_espn_exception_summary.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ exceptions: exceptions.length, by_pattern: byPattern.slice(0, 20) }, null, 2));
