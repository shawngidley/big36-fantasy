import { readFile } from "node:fs/promises";

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");
const certification = JSON.parse(await readFile("/tmp/qb_2025_espn_boxscore_certification.json", "utf8"));
const expected = new Set(certification.rows.filter(row => !row.boxscore_match).map(row => row.school_name));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.2025&position=eq.QB&select=school_name,stat_summary`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`QB hold verification read failed (${response.status}).`);
const held = new Set((await response.json()).filter(row => row.stat_summary?.qb_tier_point_hold === true).map(row => row.school_name));
const missing = [...expected].filter(school => !held.has(school));
const unexpected = [...held].filter(school => !expected.has(school));
console.log(JSON.stringify({ expected_count: expected.size, held_count: held.size, missing, unexpected, valid: missing.length === 0 && unexpected.length === 0 }, null, 2));
