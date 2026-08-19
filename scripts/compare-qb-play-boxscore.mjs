import { readFile, writeFile } from "node:fs/promises";

const playReport = JSON.parse(await readFile("/tmp/qb_2025_certification_report.json", "utf8"));
const boxReport = JSON.parse(await readFile("/tmp/qb_2025_boxscore_certification.json", "utf8"));
const playBySchool = new Map(playReport.rows.map(row => [row.school_name, row]));
const rows = boxReport.rows.map(box => {
  const play = playBySchool.get(box.school_name);
  const playTotals = play?.certified ?? {};
  const boxTotals = box.official_boxscore;
  return { school_name: box.school_name, boxscore: boxTotals, play_by_play: playTotals, passing_td_match: boxTotals.qb_passing_touchdowns === playTotals.passing_touchdowns, rushing_td_match: boxTotals.qb_rushing_touchdowns === playTotals.rushing_touchdowns, interception_match: boxTotals.qb_interceptions === playTotals.interceptions, needs_tier_review: boxTotals.qb_passing_touchdowns !== playTotals.passing_touchdowns || boxTotals.qb_rushing_touchdowns !== playTotals.rushing_touchdowns };
});
const summary = { schools: rows.length, passing_td_matches: rows.filter(row => row.passing_td_match).length, rushing_td_matches: rows.filter(row => row.rushing_td_match).length, interception_matches: rows.filter(row => row.interception_match).length, tier_review_rows: rows.filter(row => row.needs_tier_review) };
await writeFile("/tmp/qb_2025_play_boxscore_comparison.json", JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ schools: summary.schools, passing_td_matches: summary.passing_td_matches, rushing_td_matches: summary.rushing_td_matches, interception_matches: summary.interception_matches, tier_review_count: summary.tier_review_rows.length, sample: summary.tier_review_rows.slice(0, 20) }, null, 2));
