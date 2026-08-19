import { readFile, writeFile } from "node:fs/promises";

const season = 2025;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");
const report = JSON.parse(await readFile("/tmp/non_qb_2025_boxscore_certification.json", "utf8"));
const fields = {
  RB: ["touchdowns", "fumbles_lost"], WR: ["touchdowns", "fumbles_lost"], TE: ["touchdowns", "fumbles_lost"],
  K_ST: ["field_goals_made", "extra_points", "kick_return_touchdowns", "punt_return_touchdowns"],
  DEF: ["sacks", "interceptions", "defensive_touchdowns", "shutouts"],
};
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=in.(RB,WR,TE,K_ST,DEF)&select=school_name,position,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Catalog read failed (${response.status}).`);
const rows = await response.json();
const current = new Map(rows.map(row => [`${row.school_name}::${row.position}`, row]));
const mismatches = report.rows.filter(row => {
  const stored = current.get(`${row.school_name}::${row.position}`)?.stat_summary ?? {};
  return stored.non_qb_stat_line_certified !== true || stored.non_qb_tier_point_hold !== true || fields[row.position].some(field => Number(stored[field] ?? 0) !== Number(row.control[field] ?? 0));
}).map(row => ({ school_name: row.school_name, position: row.position, expected: Object.fromEntries(fields[row.position].map(field => [field, row.control[field]])), stored: current.get(`${row.school_name}::${row.position}`)?.stat_summary ?? null }));
const output = { season, expected_units: report.rows.length, stored_units: rows.length, matching_units: report.rows.length - mismatches.length, mismatch_count: mismatches.length, mismatches };
await writeFile("/tmp/non_qb_2025_stat_overlay_verification.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, expected_units: output.expected_units, stored_units: output.stored_units, matching_units: output.matching_units, mismatch_count: output.mismatch_count, sample_mismatches: mismatches.slice(0, 10) }, null, 2));
