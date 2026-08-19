import { writeFile } from 'node:fs/promises';

const season = 2025;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&select=school_name,position,official_points,normalized_points,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Historical catalog read failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
const rows = await response.json();
const heldRows = rows.filter(row => row.stat_summary?.historical_points_hold === true);
const leaked = heldRows.filter(row => row.official_points !== null || row.normalized_points !== null).map(row => ({ school_name: row.school_name, position: row.position, official_points: row.official_points, normalized_points: row.normalized_points }));
const output = { season, total_units: rows.length, held_units: heldRows.length, certified_units: rows.length - heldRows.length, leaked_held_totals: leaked };
await writeFile('/tmp/held_catalog_suppression_verification.json', JSON.stringify(output, null, 2));
if (leaked.length) throw new Error(`Held-total suppression failed for ${leaked.slice(0, 8).map(row => `${row.school_name} ${row.position}`).join(', ')}`);
console.log(JSON.stringify(output, null, 2));
