import { mkdir, readFile, writeFile } from "node:fs/promises";

const season = 2025;
const cacheDirectory = "/tmp/big36_2025_cfbd_cache/boxscores";
const key = process.env.CFBD_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!key || !supabaseUrl || !supabaseKey) throw new Error("CFBD and Supabase credentials are required.");
await mkdir(cacheDirectory, { recursive: true });

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const pos = value => ({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" }[String(value ?? "").toUpperCase()] ?? null);
const safeName = value => normal(value).replace(/[^a-z0-9]+/g, "_");
async function cached(name, fetcher) {
  const path = `${cacheDirectory}/${name}.json`;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { const value = await fetcher(); await writeFile(path, JSON.stringify(value)); return value; }
}
async function fetchTeamBoxscores(team) {
  const response = await fetch(`https://api.collegefootballdata.com/games/players?year=${season}&team=${encodeURIComponent(team)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(180000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${team}: CFBD games/players failed (${response.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body);
}
const teams = JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8"));
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8"));
const catalogResponse = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.QB&select=school_name,official_points,event_counts,stat_summary,eligible_games`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!catalogResponse.ok) throw new Error(`Catalog read failed (${catalogResponse.status}).`);
const catalogBySchool = new Map((await catalogResponse.json()).map(row => [normal(row.school_name), row]));

function athleteStat(teamBox, categoryName, typeName, roster, onlyQb = false) {
  const category = teamBox?.categories?.find(category => normal(category.name) === normal(categoryName));
  const type = category?.types?.find(statType => normal(statType.name) === normal(typeName));
  return (type?.athletes ?? []).reduce((sum, athlete) => {
    const playerPosition = roster.get(String(athlete.id));
    if (onlyQb && playerPosition !== "QB") return sum;
    const value = Number(String(athlete.stat ?? "0").replace(/[^0-9.-]/g, ""));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

const concurrency = 4;
const rows = [];
for (let start = 0; start < teams.length; start += concurrency) {
  const batch = teams.slice(start, start + concurrency);
  const results = await Promise.all(batch.map(async team => {
    const school = team.school;
    const selectedGames = games.filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].map(normal).includes(normal(school))).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12).filter(game => game.completed);
    const rosterRows = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safeName(school)}.json`, "utf8"));
    const roster = new Map(rosterRows.map(player => [String(player.id), pos(player.position)]));
    const boxes = await cached(safeName(school), () => fetchTeamBoxscores(school));
    const boxByGame = new Map(boxes.map(box => [Number(box.id), box]));
    const missingGames = selectedGames.filter(game => !boxByGame.has(Number(game.id))).map(game => game.id);
    const totals = { team_passing_touchdowns: 0, team_interceptions: 0, qb_passing_touchdowns: 0, qb_rushing_touchdowns: 0, qb_interceptions: 0 };
    const gameTotals = [];
    for (const game of selectedGames) {
      const box = boxByGame.get(Number(game.id));
      const teamBox = box?.teams?.find(item => normal(item.team) === normal(school));
      const values = { game_id: game.id, passing_touchdowns: athleteStat(teamBox, "passing", "TD", roster), interceptions: athleteStat(teamBox, "passing", "INT", roster), qb_passing_touchdowns: athleteStat(teamBox, "passing", "TD", roster, true), qb_rushing_touchdowns: athleteStat(teamBox, "rushing", "TD", roster, true), qb_interceptions: athleteStat(teamBox, "passing", "INT", roster, true) };
      totals.team_passing_touchdowns += values.passing_touchdowns;
      totals.team_interceptions += values.interceptions;
      totals.qb_passing_touchdowns += values.qb_passing_touchdowns;
      totals.qb_rushing_touchdowns += values.qb_rushing_touchdowns;
      totals.qb_interceptions += values.qb_interceptions;
      gameTotals.push(values);
    }
    const published = catalogBySchool.get(normal(school));
    const summary = published?.stat_summary ?? {};
    return { school_name: school, eligible_games: selectedGames.length, missing_boxscore_game_ids: missingGames, official_boxscore: totals, published: { passing_touchdowns: Number(summary.passing_touchdowns ?? 0), touchdowns: Number(summary.touchdowns ?? 0), interceptions: Number(summary.interceptions ?? 0), official_points: Number(published?.official_points ?? 0) }, game_totals: gameTotals };
  }));
  rows.push(...results);
  console.log(`certified ${Math.min(start + concurrency, teams.length)}/${teams.length}`);
}
const report = { season, generated_at: new Date().toISOString(), rows };
report.summary = { schools: rows.length, rows_with_missing_boxes: rows.filter(row => row.missing_boxscore_game_ids.length > 0).length, published_matching_boxscore: rows.filter(row => row.published.passing_touchdowns === row.official_boxscore.qb_passing_touchdowns && row.published.touchdowns === row.official_boxscore.qb_passing_touchdowns + row.official_boxscore.qb_rushing_touchdowns && row.published.interceptions === row.official_boxscore.qb_interceptions).length, exceptions: rows.filter(row => row.published.passing_touchdowns !== row.official_boxscore.qb_passing_touchdowns || row.published.touchdowns !== row.official_boxscore.qb_passing_touchdowns + row.official_boxscore.qb_rushing_touchdowns || row.published.interceptions !== row.official_boxscore.qb_interceptions) };
await writeFile("/tmp/qb_2025_boxscore_certification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ schools: report.summary.schools, rows_with_missing_boxes: report.summary.rows_with_missing_boxes, published_matching_boxscore: report.summary.published_matching_boxscore, exception_count: report.summary.exceptions.length, sample_exceptions: report.summary.exceptions.slice(0, 10).map(row => ({ school: row.school_name, official_boxscore: row.official_boxscore, published: row.published, missing: row.missing_boxscore_game_ids })) }, null, 2));
