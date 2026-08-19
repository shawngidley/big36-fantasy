import { readFile, writeFile } from 'node:fs/promises';

const season = 2025;
const apply = process.env.APPLY === 'true';
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');

const requestedPosition = process.env.POSITION?.trim().toUpperCase();
const allPositions = ['QB', 'RB', 'WR', 'TE'];
if (requestedPosition && !allPositions.includes(requestedPosition)) throw new Error(`POSITION must be one of ${allPositions.join(', ')}.`);
const positions = requestedPosition ? [requestedPosition] : allPositions;
const ledger = JSON.parse(await readFile('/tmp/cfbfastR_2025_offensive_td_ledger.json', 'utf8'));
const qbCertification = JSON.parse(await readFile('/tmp/qb_2025_espn_boxscore_certification.json', 'utf8'));
const nonQbCertification = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8'));

const currentResponse = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=in.(QB,RB,WR,TE)&select=school_name,position,official_points,eligible_games,normalization_factor,normalized_points,event_counts,stat_summary,source_note`, {
  headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
});
if (!currentResponse.ok) throw new Error(`Research catalog read failed (${currentResponse.status}): ${(await currentResponse.text()).slice(0, 180)}`);
const currentByKey = new Map((await currentResponse.json()).map(row => [`${row.school_name}::${row.position}`, row]));

const qbTurnovers = new Map(qbCertification.rows.map(row => [row.school_name, row.official_boxscore]));
const nonQbTurnovers = new Map(nonQbCertification.rows.filter(row => positions.includes(row.position)).map(row => [`${row.school_name}::${row.position}`, row.control]));
const unresolvedSchools = new Map();
for (const event of ledger.unassigned_events) {
  if (!['two_point_pass', 'two_point_rush'].includes(event.kind)) continue;
  const reasons = unresolvedSchools.get(event.school_name) ?? [];
  reasons.push(`${event.kind} ownership is incomplete in the normalized event feed`);
  unresolvedSchools.set(event.school_name, reasons);
}

const changes = ledger.rows.filter(row => positions.includes(row.position)).map(row => {
  const key = `${row.school_name}::${row.position}`;
  const current = currentByKey.get(key);
  if (!current) throw new Error(`Missing ${key} from b36_draft_research_units.`);
  const turnoverControl = row.position === 'QB' ? qbTurnovers.get(row.school_name) : nonQbTurnovers.get(key);
  if (!turnoverControl) throw new Error(`Missing official turnover control for ${key}.`);
  const holdReasons = [];
  if (!row.matches_control) holdReasons.push('normalized touchdown ownership does not yet exactly match the official first-12-game box-score control');
  if (row.tier_events_missing_distance > 0) holdReasons.push(`${row.tier_events_missing_distance} touchdown event(s) lack a verified pre-snap goal-line distance`);
  if (unresolvedSchools.has(row.school_name)) holdReasons.push(...unresolvedSchools.get(row.school_name));
  const certified = holdReasons.length === 0;
  const turnovers = Number(turnoverControl.interceptions ?? 0) + Number(turnoverControl.fumbles_lost ?? 0);
  const officialPoints = Number(row.tier_points) - (turnovers * 3);
  const normalizedPoints = Number((officialPoints * Number(current.normalization_factor ?? 1)).toFixed(2));
  const nextSummary = {
    ...(current.stat_summary ?? {}),
    historical_points_certified: certified,
    historical_points_hold: !certified,
    historical_points_source: row.position === 'TE'
      ? 'cfbfastR normalized 2025 play-by-play for touchdown events and conversions; every TE touchdown is worth the commissioner-approved flat 12 points; CFBD first-12-game player box scores for turnovers'
      : 'cfbfastR normalized 2025 play-by-play for touchdown goal-line tiers and conversions; CFBD first-12-game player box scores for turnovers',
    historical_points_hold_reason: certified ? null : holdReasons.join('; '),
    historical_points_scope: 'First 12 eligible 2025 regular-season games',
  };
  if (row.position === 'QB') nextSummary.qb_tier_point_hold = !certified;
  else nextSummary.non_qb_tier_point_hold = !certified;
  const nextEventCounts = {
    ...(current.event_counts ?? {}),
    TOUCHDOWN: Number(row.touchdowns),
    PASSING_TOUCHDOWN: Number(row.passing_touchdowns),
    RUSHING_TOUCHDOWN: Number(row.rushing_touchdowns),
    TWO_POINT_CONVERSION: Number(row.two_point_conversions),
    INTERCEPTION_THROWN: Number(turnoverControl.interceptions ?? 0),
    FUMBLE_LOST: Number(turnoverControl.fumbles_lost ?? 0),
  };
  const changed = current.stat_summary?.historical_points_certified !== certified
    || current.stat_summary?.historical_points_hold !== !certified
    || (certified && (Number(current.official_points) !== officialPoints || Number(current.normalized_points) !== normalizedPoints))
    || (!certified && (current.official_points !== null || current.normalized_points !== null));
  return {
    school_name: row.school_name,
    position: row.position,
    certified,
    hold_reasons: holdReasons,
    official_points: officialPoints,
    normalized_points: normalizedPoints,
    event_counts: nextEventCounts,
    stat_summary: nextSummary,
    source_note: certified
      ? row.position === 'TE'
        ? 'Certified 2025 first-12-game total: normalized cfbfastR scoring events and conversions reconciled to CFBD official player box-score controls; every TE touchdown is worth the approved flat 12 points.'
        : 'Certified 2025 first-12-game total: normalized cfbfastR scoring-event tiers and conversions reconciled to CFBD official player box-score controls.'
      : 'Historical tiered total held pending complete event ownership and control reconciliation; no unsupported point total is displayed.',
    changed,
  };
});

if (apply) {
  for (const change of changes) {
    const payload = {
      event_counts: change.event_counts,
      stat_summary: change.stat_summary,
      source_note: change.source_note,
      ...(change.certified ? { official_points: change.official_points, normalized_points: change.normalized_points } : { official_points: null, normalized_points: null }),
    };
    const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&school_name=eq.${encodeURIComponent(change.school_name)}&position=eq.${change.position}`, {
      method: 'PATCH',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Historical publication failed for ${change.school_name} ${change.position} (${response.status}): ${(await response.text()).slice(0, 180)}`);
  }
}

const output = {
  season,
  apply,
  totals: {
    audited_units: changes.length,
    certified_units: changes.filter(change => change.certified).length,
    held_units: changes.filter(change => !change.certified).length,
    changed_units: changes.filter(change => change.changed).length,
  },
  by_position: Object.fromEntries(positions.map(position => [position, {
    certified: changes.filter(change => change.position === position && change.certified).length,
    held: changes.filter(change => change.position === position && !change.certified).length,
  }])),
  changes,
};
await writeFile('/tmp/certified_offensive_points_publication.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ season, apply, totals: output.totals, by_position: output.by_position, sample_certified: changes.filter(change => change.certified).slice(0, 8).map(change => ({ school: change.school_name, position: change.position, points: change.official_points })), sample_holds: changes.filter(change => !change.certified).slice(0, 8).map(change => ({ school: change.school_name, position: change.position, reasons: change.hold_reasons })) }, null, 2));
