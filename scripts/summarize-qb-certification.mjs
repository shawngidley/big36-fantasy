import { readFile, writeFile } from "node:fs/promises";

const inventory = JSON.parse(await readFile("/home/ubuntu/full_qb_certification_inventory.json", "utf8"));
const rows = inventory.results.map(result => ({ school_name: result.output?.school_name ?? result.input, status: result.output?.status ?? "BLOCKED", selected_game_count: result.output?.selected_game_count ?? null, team_passing_touchdowns: result.output?.team_passing_touchdowns ?? null, team_interceptions: result.output?.team_interceptions ?? null, qb_passing_touchdowns: result.output?.qb_passing_touchdowns ?? null, qb_rushing_touchdowns: result.output?.qb_rushing_touchdowns ?? null, qb_interceptions: result.output?.qb_interceptions ?? null, ambiguity_note: result.output?.ambiguity_note ?? result.error ?? "None", source_url: result.output?.source_url ?? null, error: result.error ?? null }));
const summary = {
  totals: {
    schools: rows.length,
    pass: rows.filter(row => row.status === "PASS").length,
    review: rows.filter(row => row.status === "REVIEW").length,
    blocked: rows.filter(row => row.status === "BLOCKED").length,
  },
  exceptions: rows.filter(row => row.status !== "PASS" || row.selected_game_count !== 12 || row.team_passing_touchdowns !== row.qb_passing_touchdowns || row.team_interceptions !== row.qb_interceptions),
  rows,
};
await writeFile("/tmp/qb_certification_inventory_summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ totals: summary.totals, exception_count: summary.exceptions.length, exceptions: summary.exceptions.slice(0, 25) }, null, 2));
