import { readFile, writeFile } from 'node:fs/promises';

const season = 2025;
const apply = process.env.APPLY === 'true';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');

const ledger = JSON.parse(await readFile('/tmp/espn_core_2025_kst_full_ledger.json', 'utf8'));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.K_ST&select=school_name,position,official_points,normalization_factor,normalized_points,event_counts,stat_summary,source_note`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`K/ST catalog read failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
const currentBySchool = new Map((await response.json()).map(row => [row.school_name, row]));
const changes = ledger.rows.map(row => {
  const current = currentBySchool.get(row.school_name);
  if (!current) throw new Error(`Missing ${row.school_name} K_ST from b36_draft_research_units.`);
  const certified = row.certifiable === true;
  const officialPoints = Number(row.points);
  const normalizedPoints = Number((officialPoints * Number(current.normalization_factor ?? 1)).toFixed(2));
  const holdReason = certified ? null : 'K/ST made-kick, return-touchdown, block, and safety events do not yet fully reconcile to the authoritative first-12-game controls.';
  const nextSummary = {
    ...(current.stat_summary ?? {}),
    historical_points_certified: certified,
    historical_points_hold: !certified,
    non_qb_tier_point_hold: !certified,
    historical_points_scope: 'First 12 eligible 2025 regular-season games',
    historical_points_source: 'ESPN core 2025 play-by-play for made kicks, PATs, special-teams returns, blocks, and blocked-punt safeties; CFBD first-12-game team box-score controls for made kicks and return touchdowns',
    historical_points_hold_reason: holdReason,
  };
  const nextEventCounts = {
    ...(current.event_counts ?? {}),
    FIELD_GOAL: Number(row.events.FIELD_GOAL ?? 0),
    EXTRA_POINT: Number(row.events.EXTRA_POINT ?? 0),
    RETURN_TOUCHDOWN: Number(row.events.RETURN_TOUCHDOWN ?? 0),
    BLOCK: Number(row.events.BLOCK ?? 0),
    SPECIAL_TEAMS_SAFETY: Number(row.events.SPECIAL_TEAMS_SAFETY ?? 0),
  };
  const changed = current.stat_summary?.historical_points_certified !== certified
    || current.stat_summary?.historical_points_hold !== !certified
    || (certified && (Number(current.official_points) !== officialPoints || Number(current.normalized_points) !== normalizedPoints))
    || (!certified && (current.official_points !== null || current.normalized_points !== null));
  return { school_name: row.school_name, position: 'K_ST', certified, official_points: officialPoints, normalized_points: normalizedPoints, event_counts: nextEventCounts, stat_summary: nextSummary, source_note: certified ? 'Certified 2025 first-12-game K/ST total: ESPN core event ledger reconciled to CFBD official team-box made-kick and return controls.' : 'Historical K/ST total held pending complete event and official-control reconciliation; no unsupported point total is displayed.', changed };
});

if (apply) {
  for (const change of changes) {
    const patch = { event_counts: change.event_counts, stat_summary: change.stat_summary, source_note: change.source_note, ...(change.certified ? { official_points: change.official_points, normalized_points: change.normalized_points } : { official_points: null, normalized_points: null }) };
    const update = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&school_name=eq.${encodeURIComponent(change.school_name)}&position=eq.K_ST`, { method: 'PATCH', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    if (!update.ok) throw new Error(`K/ST publication failed for ${change.school_name} (${update.status}): ${(await update.text()).slice(0, 180)}`);
  }
}
const output = { season, apply, totals: { audited_units: changes.length, certified_units: changes.filter(change => change.certified).length, held_units: changes.filter(change => !change.certified).length, changed_units: changes.filter(change => change.changed).length }, changes };
await writeFile('/tmp/certified_kst_points_publication.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, apply, totals: output.totals, sample_certified: changes.filter(change => change.certified).slice(0, 8).map(change => ({ school: change.school_name, points: change.official_points })), sample_holds: changes.filter(change => !change.certified).slice(0, 8).map(change => change.school_name) }, null, 2));
