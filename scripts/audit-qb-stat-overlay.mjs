import { readFile, writeFile } from "node:fs/promises";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");
const certification = JSON.parse(await readFile("/tmp/qb_2025_espn_boxscore_certification.json", "utf8"));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.2025&position=eq.QB&select=school_name,official_points,event_counts,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Published QB catalog read failed (${response.status}).`);
const publishedBySchool = new Map((await response.json()).map(row => [row.school_name, row]));
const differences = certification.rows.map(row => {
  const published = publishedBySchool.get(row.school_name);
  const summary = published?.stat_summary ?? {};
  const certified = { touchdowns: row.official_boxscore.passing_touchdowns + row.official_boxscore.rushing_touchdowns, passing_touchdowns: row.official_boxscore.passing_touchdowns, interceptions: row.official_boxscore.interceptions };
  const visible = { touchdowns: Number(summary.touchdowns ?? 0), passing_touchdowns: Number(summary.passing_touchdowns ?? 0), interceptions: Number(summary.interceptions ?? 0) };
  return { school_name: row.school_name, certified, visible, differs: JSON.stringify(certified) !== JSON.stringify(visible), source_match: row.boxscore_match };
});
const report = { total: differences.length, exact_visible_stats: differences.filter(row => !row.differs).length, differences: differences.filter(row => row.differs), source_certified_rows: certification.rows.filter(row => row.boxscore_match).length, source_exception_rows: certification.rows.filter(row => !row.boxscore_match).length };
await writeFile("/tmp/qb_2025_stat_overlay_audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, exact_visible_stats: report.exact_visible_stats, visible_stat_differences: report.differences.length, source_certified_rows: report.source_certified_rows, source_exception_rows: report.source_exception_rows, sample: report.differences.slice(0, 20) }, null, 2));
