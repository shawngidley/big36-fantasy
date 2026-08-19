import { readFile, writeFile } from "node:fs/promises";

const report = JSON.parse(await readFile("/tmp/non_qb_2025_boxscore_certification.json", "utf8"));
const visibleFields = {
  RB: ["touchdowns", "fumbles_lost"],
  WR: ["touchdowns", "fumbles_lost"],
  TE: ["touchdowns", "fumbles_lost"],
  K_ST: ["field_goals_made", "extra_points", "kick_return_touchdowns", "punt_return_touchdowns"],
  DEF: ["sacks", "interceptions", "defensive_touchdowns", "shutouts"],
};

const byPosition = {};
for (const position of Object.keys(visibleFields)) {
  const rows = report.rows.filter(row => row.position === position);
  const visibleMismatches = rows.filter(row => visibleFields[position].some(field => row.comparisons[field]?.delta !== 0));
  byPosition[position] = {
    units: rows.length,
    exact_visible_matches: rows.length - visibleMismatches.length,
    visible_mismatch_count: visibleMismatches.length,
    field_deltas: Object.fromEntries(visibleFields[position].map(field => [field, {
      mismatches: visibleMismatches.filter(row => row.comparisons[field]?.delta !== 0).length,
      net_delta: rows.reduce((sum, row) => sum + Number(row.comparisons[field]?.delta ?? 0), 0),
    }])),
    sample_visible_mismatches: visibleMismatches.slice(0, 12).map(row => ({ school_name: row.school_name, comparisons: Object.fromEntries(visibleFields[position].filter(field => row.comparisons[field]?.delta !== 0).map(field => [field, row.comparisons[field]])), missing_boxscore_game_ids: row.missing_boxscore_game_ids })),
  };
}
const output = { season: report.season, generated_at: new Date().toISOString(), by_position: byPosition };
await writeFile("/tmp/non_qb_2025_visible_stat_summary.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
