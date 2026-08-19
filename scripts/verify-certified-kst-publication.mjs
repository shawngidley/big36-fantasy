import { readFile, writeFile } from 'node:fs/promises';

const season = 2025;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');
const ledger = JSON.parse(await readFile('/tmp/espn_core_2025_kst_full_ledger.json', 'utf8'));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.K_ST&select=school_name,official_points,normalized_points,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`K/ST catalog read failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
const storedBySchool = new Map((await response.json()).map(row => [row.school_name, row]));
const errors = [];
for (const row of ledger.rows) {
  const stored = storedBySchool.get(row.school_name);
  if (!stored) { errors.push(`${row.school_name}: missing K/ST catalog row`); continue; }
  const certified = row.certifiable === true;
  const storedCertified = stored.stat_summary?.historical_points_certified === true && stored.stat_summary?.historical_points_hold !== true;
  if (certified && (Number(row.events.BLOCK ?? 0) > 0 || Number(row.events.SPECIAL_TEAMS_SAFETY ?? 0) > 0)) errors.push(`${row.school_name}: block or special-teams safety component cannot be certified without authoritative control`);
  if (storedCertified !== certified) errors.push(`${row.school_name}: stored certification state does not match ledger gate`);
  if (certified && (Number(stored.official_points) !== Number(row.points) || !Number.isFinite(Number(stored.normalized_points)))) errors.push(`${row.school_name}: certified stored total does not match ledger`);
  if (!certified && (stored.official_points !== null || stored.normalized_points !== null)) errors.push(`${row.school_name}: held K/ST row retains a numerical total`);
}
const output = { season, audited_units: ledger.rows.length, certified_units: ledger.rows.filter(row => row.certifiable).length, held_units: ledger.rows.filter(row => !row.certifiable).length, errors };
await writeFile('/tmp/certified_kst_publication_verification.json', JSON.stringify(output, null, 2));
if (errors.length) throw new Error(`K/ST publication verification failed: ${errors.slice(0, 8).join(' | ')}`);
console.log(JSON.stringify(output, null, 2));
