import { readFile, writeFile } from 'node:fs/promises';
import { calculateProvisionalDef, PROVISIONAL_DEF_TD_DEFAULT_POINTS } from './provisional-def-calculation.mjs';

const season = 2025;
const apply = process.env.APPLY === 'true';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');

const ledger = JSON.parse(await readFile('/tmp/espn_core_2025_def_ledger.json', 'utf8'));
const controls = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8')).rows;
const controlBySchool = new Map(controls.filter(row => row.position === 'DEF').map(row => [row.school_name, row.control]));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.DEF&select=school_name,position,official_points,normalization_factor,normalized_points,event_counts,stat_summary,source_note`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`DEF catalog read failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
const currentBySchool = new Map((await response.json()).map(row => [row.school_name, row]));

const changes = ledger.rows.map(row => {
  const current = currentBySchool.get(row.school_name);
  const controlsForSchool = controlBySchool.get(row.school_name);
  if (!current || !controlsForSchool) throw new Error(`Missing DEF catalog row or certified control for ${row.school_name}.`);
  const provisional = calculateProvisionalDef({ controls: controlsForSchool, events: row.events ?? {}, eventPoints: row.event_points ?? {} });
  const rawPoints = provisional.points;
  const normalizedPoints = Number((rawPoints * Number(current.normalization_factor ?? 1)).toFixed(2));
  const nextSummary = {
    ...(current.stat_summary ?? {}),
    historical_points_certified: false,
    historical_points_hold: false,
    historical_points_provisional: true,
    historical_points_scope: 'First 12 eligible 2025 regular-season games',
    historical_points_source: 'Certified CFBD first-12-game controls for sacks, interceptions, defensive touchdown count, and shutouts; role-normalized ESPN core event ledger for fumble recoveries, defensive safeties, and available defensive touchdown distances.',
    historical_points_provisional_reason: `Displayed as an estimate because ${provisional.components.estimatedDefensiveTouchdowns} defensive touchdown(s) require the neutral ${PROVISIONAL_DEF_TD_DEFAULT_POINTS}-point tier and public fumble-recovery attribution is not fully certified.`,
    provisional_def_method: 'Official control counts for sacks, interceptions, defensive touchdowns, and shutouts; reconstructed ESPN recoveries, safeties, and known touchdown tiers; unobserved defensive touchdowns use a neutral 12-point tier.',
    provisional_def_default_td_tier_points: PROVISIONAL_DEF_TD_DEFAULT_POINTS,
    provisional_def_estimated_td_count: provisional.components.estimatedDefensiveTouchdowns,
    provisional_def_reconstructed_fumble_recoveries: provisional.components.fumbleRecoveries,
  };
  const nextEventCounts = {
    ...(current.event_counts ?? {}),
    SACK: provisional.components.sacks,
    INTERCEPTION: provisional.components.interceptions,
    FUMBLE_RECOVERY: provisional.components.fumbleRecoveries,
    DEFENSIVE_TOUCHDOWN: provisional.components.defensiveTouchdowns,
    DEFENSIVE_SAFETY: provisional.components.safeties,
    SHUTOUT: provisional.components.shutouts,
  };
  const sourceNote = `Provisional 2025 first-12-game DEF estimate. Official sack, interception, defensive-touchdown-count, and shutout controls are combined with role-normalized ESPN defensive events; this is not a certified historical total.`;
  const changed = Number(current.official_points) !== rawPoints
    || Number(current.normalized_points) !== normalizedPoints
    || current.stat_summary?.historical_points_provisional !== true
    || current.stat_summary?.historical_points_hold !== false;
  return { school_name: row.school_name, rawPoints, normalizedPoints, provisional, eventCounts: nextEventCounts, statSummary: nextSummary, sourceNote, changed };
});

if (apply) {
  for (const change of changes) {
    const update = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&school_name=eq.${encodeURIComponent(change.school_name)}&position=eq.DEF`, { method: 'PATCH', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ official_points: change.rawPoints, normalized_points: change.normalizedPoints, event_counts: change.eventCounts, stat_summary: change.statSummary, source_note: change.sourceNote }) });
    if (!update.ok) throw new Error(`Provisional DEF publication failed for ${change.school_name} (${update.status}): ${(await update.text()).slice(0, 180)}`);
  }
}

const output = { season, apply, methodology: 'Official controls set sacks, interceptions, defensive-touchdown counts, and shutouts. ESPN events supply fumble recoveries, defensive safeties, and known defensive-touchdown tiers. Missing defensive touchdown tiers receive a neutral 12-point estimate.', totals: { units: changes.length, changedUnits: changes.filter(change => change.changed).length, estimatedTouchdowns: changes.reduce((sum, change) => sum + change.provisional.components.estimatedDefensiveTouchdowns, 0) }, changes };
await writeFile('/tmp/provisional_def_points_publication.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, apply, totals: output.totals, sample: changes.slice(0, 8).map(change => ({ school: change.school_name, raw_points: change.rawPoints, estimated_td_count: change.provisional.components.estimatedDefensiveTouchdowns })) }, null, 2));
