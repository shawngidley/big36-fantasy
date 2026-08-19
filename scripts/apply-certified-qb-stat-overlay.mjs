import { readFile, writeFile } from "node:fs/promises";

const season = 2025;
const apply = process.env.APPLY === "true";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");
const certification = JSON.parse(await readFile("/tmp/qb_2025_espn_boxscore_certification.json", "utf8"));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.QB&select=school_name,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`QB catalog read failed (${response.status}).`);
const currentBySchool = new Map((await response.json()).map(row => [row.school_name, row]));
const changes = certification.rows.map(row => {
  const current = currentBySchool.get(row.school_name);
  if (!current) throw new Error(`Missing current QB row for ${row.school_name}.`);
  const totalTouchdowns = row.official_boxscore.passing_touchdowns + row.official_boxscore.rushing_touchdowns;
  const tierPointHold = !row.boxscore_match;
  const nextSummary = { ...(current.stat_summary ?? {}), touchdowns: totalTouchdowns, passing_touchdowns: row.official_boxscore.passing_touchdowns, interceptions: row.official_boxscore.interceptions, qb_stat_line_certified: true, qb_stat_line_source: "CFBD 2025 per-game player box scores · first 12 regular-season games", qb_tier_point_hold: tierPointHold };
  const changed = Number(current.stat_summary?.touchdowns ?? 0) !== totalTouchdowns || Number(current.stat_summary?.passing_touchdowns ?? 0) !== row.official_boxscore.passing_touchdowns || Number(current.stat_summary?.interceptions ?? 0) !== row.official_boxscore.interceptions || current.stat_summary?.qb_tier_point_hold !== tierPointHold;
  return { school_name: row.school_name, changed, certified: { touchdowns: totalTouchdowns, passing_touchdowns: row.official_boxscore.passing_touchdowns, interceptions: row.official_boxscore.interceptions }, next_summary: nextSummary };
});
if (apply) {
  for (const change of changes) {
    const patch = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&school_name=eq.${encodeURIComponent(change.school_name)}&position=eq.QB`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ stat_summary: change.next_summary }) });
    if (!patch.ok) throw new Error(`QB stat overlay failed for ${change.school_name} (${patch.status}): ${(await patch.text()).slice(0, 180)}`);
  }
}
const output = { season, apply, schools: changes.length, changed_rows: changes.filter(change => change.changed).length, unchanged_rows: changes.filter(change => !change.changed).length, changes };
await writeFile("/tmp/qb_2025_stat_overlay_result.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, apply, schools: output.schools, changed_rows: output.changed_rows, unchanged_rows: output.unchanged_rows, sample: changes.filter(change => change.changed).slice(0, 12).map(change => ({ school: change.school_name, certified: change.certified })) }, null, 2));
