import { readFile, writeFile } from "node:fs/promises";

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const report = JSON.parse(await readFile("/tmp/qb_2025_certification_report.json", "utf8"));
const external = JSON.parse(await readFile("/home/ubuntu/qb_team_control_recheck.json", "utf8"));
const externalByInput = new Map(external.results.map(result => [normal(result.input), result.output ?? {}]));
const rows = report.rows.map(row => {
  const control = externalByInput.get(normal(row.school_name)) ?? {};
  const externalPass = Number(control.team_passing_touchdowns);
  const externalInt = Number(control.team_interceptions);
  const passComparable = Number.isFinite(externalPass) && externalPass >= 0;
  const intComparable = Number.isFinite(externalInt) && externalInt >= 0;
  const passMatch = passComparable && row.controls.team_passing_touchdowns === externalPass;
  const intMatch = intComparable && row.certified.interceptions === externalInt;
  return { school_name: row.school_name, local_team_passing_touchdowns: row.controls.team_passing_touchdowns, external_team_passing_touchdowns: passComparable ? externalPass : null, local_qb_interceptions: row.certified.interceptions, external_team_interceptions: intComparable ? externalInt : null, pass_match: passMatch, interception_match: intMatch, control_source: control.source_url ?? null, control_note: control.confidence_note ?? null, published: row.published, certified: row.certified, needs_event_review: !passMatch || !intMatch };
});
const summary = { schools: rows.length, pass_controls_matching: rows.filter(row => row.pass_match).length, interception_controls_matching: rows.filter(row => row.interception_match).length, both_controls_matching: rows.filter(row => row.pass_match && row.interception_match).length, exceptions: rows.filter(row => row.needs_event_review) };
await writeFile("/tmp/qb_2025_control_reconciliation.json", JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ ...summary, exceptions: summary.exceptions.slice(0, 30) }, null, 2));
