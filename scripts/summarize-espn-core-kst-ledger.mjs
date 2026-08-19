import { readFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('/tmp/espn_core_2025_kst_ledger.json', 'utf8'));
const rows = report.rows;
const categories = ['field_goals_made', 'extra_points', 'return_touchdowns'];
const mismatchCounts = Object.fromEntries(categories.map(category => [category, rows.filter(row => row.comparisons[category].control !== row.comparisons[category].ledger).length]));
const samples = rows.filter(row => !row.matches_visible_controls).slice(0, 16).map(row => ({ school_name: row.school_name, comparisons: row.comparisons }));
console.log(JSON.stringify({ summary: report.summary, mismatch_counts: mismatchCounts, samples }, null, 2));
