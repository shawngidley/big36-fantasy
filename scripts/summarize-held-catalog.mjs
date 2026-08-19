const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are required.');
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.2025&select=school_name,position,stat_summary,source_note`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Held-catalog read failed (${response.status}): ${(await response.text()).slice(0, 180)}`);
const held = (await response.json()).filter(row => row.stat_summary?.historical_points_hold === true);
const byPosition = {};
for (const row of held) {
  const position = row.position;
  const reason = row.stat_summary?.historical_points_hold_reason ?? row.source_note ?? 'No explicit reason recorded';
  byPosition[position] ??= { held_units: 0, reasons: {} };
  byPosition[position].held_units += 1;
  byPosition[position].reasons[reason] = (byPosition[position].reasons[reason] ?? 0) + 1;
}
console.log(JSON.stringify({ season: 2025, held_units: held.length, by_position: byPosition }, null, 2));
