import { readFile, writeFile } from "node:fs/promises";

const season = 2025;
const apply = process.env.APPLY === "true";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");

const report = JSON.parse(await readFile("/tmp/non_qb_2025_boxscore_certification.json", "utf8"));
const positions = ["RB", "WR", "TE", "K_ST", "DEF"];
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=in.(RB,WR,TE,K_ST,DEF)&select=school_name,position,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Non-QB catalog read failed (${response.status}).`);
const currentByKey = new Map((await response.json()).map(row => [`${row.school_name}::${row.position}`, row]));

const certifiedFields = {
  RB: ["touchdowns", "fumbles_lost"],
  WR: ["touchdowns", "fumbles_lost"],
  TE: ["touchdowns", "fumbles_lost"],
  K_ST: ["field_goals_made", "extra_points", "kick_return_touchdowns", "punt_return_touchdowns"],
  DEF: ["sacks", "interceptions", "defensive_touchdowns", "shutouts"],
};

const changes = report.rows.filter(row => positions.includes(row.position)).map(row => {
  const current = currentByKey.get(`${row.school_name}::${row.position}`);
  if (!current) throw new Error(`Missing current ${row.position} row for ${row.school_name}.`);
  const certified = Object.fromEntries(certifiedFields[row.position].map(field => [field, Number(row.control[field] ?? 0)]));
  const nextSummary = {
    ...(current.stat_summary ?? {}),
    ...certified,
    non_qb_stat_line_certified: true,
    non_qb_stat_line_source: "CFBD 2025 per-game player and team box scores · first 12 regular-season games",
    non_qb_tier_point_hold: true,
    non_qb_tier_point_hold_reason: "Historical touchdown distances and complete special-teams or defensive event ownership remain under audit; no tiered point total has been inferred.",
  };
  const changed = certifiedFields[row.position].some(field => Number(current.stat_summary?.[field] ?? 0) !== certified[field]) || current.stat_summary?.non_qb_stat_line_certified !== true || current.stat_summary?.non_qb_tier_point_hold !== true;
  return { school_name: row.school_name, position: row.position, changed, certified, next_summary: nextSummary };
});

if (apply) {
  for (const change of changes) {
    const patch = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&school_name=eq.${encodeURIComponent(change.school_name)}&position=eq.${change.position}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ stat_summary: change.next_summary }) });
    if (!patch.ok) throw new Error(`Non-QB stat overlay failed for ${change.school_name} ${change.position} (${patch.status}): ${(await patch.text()).slice(0, 180)}`);
  }
}

const byPosition = Object.fromEntries(positions.map(position => [position, { units: changes.filter(change => change.position === position).length, changed_rows: changes.filter(change => change.position === position && change.changed).length }]));
const output = { season, apply, units: changes.length, changed_rows: changes.filter(change => change.changed).length, by_position: byPosition, changes };
await writeFile("/tmp/non_qb_2025_stat_overlay_result.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, apply, units: output.units, changed_rows: output.changed_rows, by_position: byPosition, sample: changes.filter(change => change.changed).slice(0, 12).map(change => ({ school: change.school_name, position: change.position, certified: change.certified })) }, null, 2));
