import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('/tmp/espn_core_2025_def_ledger.json', 'utf8'));
const categories = ['sacks', 'interceptions', 'defensive_touchdowns', 'shutouts'];
const mismatchCounts = Object.fromEntries(categories.map(category => [category, report.rows.filter(row => row.comparisons[category].control !== row.comparisons[category].ledger).length]));
const samples = report.rows.filter(row => !row.matches_visible_controls).slice(0, 16).map(row => ({ school_name: row.school_name, comparisons: row.comparisons, unresolved_events: row.unresolved.length }));
console.log(JSON.stringify({ summary: report.summary, mismatch_counts: mismatchCounts, samples }, null, 2));
