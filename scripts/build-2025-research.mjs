import { mkdir, readFile, writeFile } from "node:fs/promises";

const season = 2025;
const base = "https://api.collegefootballdata.com";
const key = process.env.CFBD_API_KEY;
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!key || !supabaseUrl || !supabaseKey) throw new Error("CFBD and Supabase credentials must be configured.");
const cacheDirectory = "/tmp/big36_2025_cfbd_cache";
await mkdir(cacheDirectory, { recursive: true });

async function get(path, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined).map(([name, value]) => [name, String(value)]));
  const url = `${base}${path}${query.size ? `?${query}` : ""}`;
  let failure;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(180000) });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`CFBD ${path} failed (${response.status}): ${body.slice(0, 250)}`);
        error.status = response.status;
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 900));
      return JSON.parse(body);
    } catch (error) {
      failure = error;
      await new Promise(resolve => setTimeout(resolve, (error?.status === 429 ? 8000 : 1200) * (attempt + 1)));
    }
  }
  throw failure;
}

async function cached(name, load) {
  const path = `${cacheDirectory}/${name}.json`;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch { const data = await load(); await writeFile(path, JSON.stringify(data)); return data; }
}

async function upsertCatalog(rows) {
  const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?on_conflict=season,school_name,position`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase research catalog write failed (${response.status}): ${body.slice(0, 250)}`);
}

const rosterPosition = (value) => ({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", K: "K_ST", P: "K_ST" }[String(value ?? "").toUpperCase()] ?? null);
const unitPositions = ["QB", "RB", "WR", "TE", "K_ST", "DEF"];
const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const pointForTouchdown = distance => distance === null || distance === undefined ? 0 : distance <= 9 ? 6 : distance <= 29 ? 8 : distance <= 59 ? 10 : 12;
const pointForFieldGoal = distance => distance < 10 ? 0 : distance <= 29 ? 3 : distance <= 39 ? 6 : distance <= 49 ? 9 : 12;
const pointForDefensiveTouchdown = distance => distance === null || distance === undefined ? 0 : distance <= 19 ? 9 : distance <= 59 ? 12 : 15;
const specialTeamsTouchdown = playType => {
  const type = String(playType ?? "").toLowerCase();
  if (!/(touchdown|\btd\b)/.test(type)) return null;
  if (type.includes("kickoff return")) return "KICK_RETURN_TOUCHDOWN";
  if (type.includes("punt return")) return "PUNT_RETURN_TOUCHDOWN";
  if (type.includes("blocked") && (type.includes("kick") || type.includes("punt") || type.includes("field goal"))) return "BLOCKED_KICK_RETURN_TOUCHDOWN";
  if (type.includes("return") && (type.includes("kick") || type.includes("punt") || type.includes("field goal"))) return "OTHER_SPECIAL_TEAMS_TOUCHDOWN";
  return null;
};
const isSpecialTeamsPlayType = playType => /kickoff|punt|field goal|extra point|\bpat\b|blocked kick/i.test(String(playType ?? ""));
const hasMadePat = (playType, playText) => {
  const type = String(playType ?? "").toLowerCase();
  const text = String(playText ?? "").toLowerCase();
  if (type.includes("extra point good") || type.includes("pat good")) return true;
  return /(touchdown|\btd\b)/.test(type) && /\([^)]*\bkick\b[^)]*\)/.test(text) && !/(no good|missed|failed)/.test(text);
};

function entry(catalog, school, position) {
  const key = `${normal(school)}::${position}`;
  if (!catalog.has(key)) catalog.set(key, { season, school_name: school, position, official_points: 0, event_counts: {}, stat_summary: {}, source_note: "CollegeFootballData 2025 regular-season games, play records, play statistics, and official rosters", calculated_at: new Date().toISOString() });
  return catalog.get(key);
}
function add(catalog, school, position, event, points, extra = {}) {
  const row = entry(catalog, school, position);
  row.official_points += points;
  row.event_counts[event] = (row.event_counts[event] ?? 0) + 1;
  for (const [name, value] of Object.entries(extra)) row.stat_summary[name] = (row.stat_summary[name] ?? 0) + Number(value);
}

const teams = JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8"));
const schools = new Map(teams.map(team => [normal(team.school), team.school]));
const catalog = new Map();
for (const school of schools.values()) for (const position of unitPositions) entry(catalog, school, position);

const games = await cached("regular_games", () => get("/games", { year: season, seasonType: "regular" }));
const eligibleGames = new Map();
const completedEligibleGameCounts = new Map();
for (const school of schools.values()) {
  const selected = games.filter(game => game.seasonType === "regular" && (normal(game.homeTeam) === normal(school) || normal(game.awayTeam) === normal(school))).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12);
  eligibleGames.set(normal(school), new Set(selected.map(game => game.id)));
  completedEligibleGameCounts.set(normal(school), selected.filter(game => game.completed).length);
  for (const game of selected.filter(game => game.completed)) {
    const opponentPoints = normal(game.homeTeam) === normal(school) ? game.awayPoints : game.homePoints;
    if (Number(opponentPoints) === 0) add(catalog, school, "DEF", "SHUTOUT", 15, { shutouts: 1 });
  }
}

const rosters = new Map();
for (const school of schools.values()) {
  const roster = await cached(`roster_${normal(school).replace(/[^a-z0-9]+/g, "_")}`, () => get("/roster", { team: school, year: season }));
  rosters.set(normal(school), new Map(roster.map(player => [player.id, rosterPosition(player.position)])));
}

const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
for (const week of weeks) {
  const [plays, stats] = await Promise.all([
    cached(`plays_week_${week}`, () => get("/plays", { year: season, week, seasonType: "regular" })),
    cached(`play_stats_week_${week}`, () => get("/plays/stats", { year: season, week, seasonType: "regular" })),
  ]);
  const statsByPlay = new Map();
  for (const stat of stats) statsByPlay.set(stat.playId, [...(statsByPlay.get(stat.playId) ?? []), stat]);
  for (const play of plays) {
    const offense = schools.get(normal(play.offense));
    const defense = schools.get(normal(play.defense));
    const sourceStats = statsByPlay.get(play.id) ?? [];
    if (offense && eligibleGames.get(normal(offense))?.has(play.gameId)) {
      const positions = rosters.get(normal(offense)) ?? new Map();
      const text = `${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase();
      const playType = String(play.playType ?? "").toLowerCase();
      const scoringDistance = play.yardsToGoal ?? null;
      const offensiveStats = sourceStats.filter(stat => normal(stat.team) === normal(offense));
      const qbTd = offensiveStats.some(stat => positions.get(stat.athleteId) === "QB" && /touchdown|pass/i.test(String(stat.statType))) && offensiveStats.some(stat => ["RB", "WR", "TE"].includes(positions.get(stat.athleteId)) && /touchdown|reception|rush/i.test(String(stat.statType)));
      const credited = new Set();
      for (const stat of offensiveStats) {
        const position = positions.get(stat.athleteId);
        const statType = String(stat.statType).toLowerCase();
        if (play.scoring && position && ["QB", "RB", "WR", "TE"].includes(position) && /touchdown|reception|rush/i.test(statType) && !credited.has(`${position}:${stat.athleteId}`)) { add(catalog, offense, position, "TOUCHDOWN", pointForTouchdown(scoringDistance), { touchdowns: 1 }); credited.add(`${position}:${stat.athleteId}`); }
        if (position && ["QB", "RB", "WR", "TE"].includes(position) && statType.includes("two point")) add(catalog, offense, position, "TWO_POINT_CONVERSION", 4, { two_point_conversions: 1 });
        if (position === "QB" && statType.includes("interception")) add(catalog, offense, "QB", "INTERCEPTION_THROWN", -3, { interceptions: 1 });
        if (position && ["QB", "RB", "WR", "TE"].includes(position) && statType.includes("fumble") && statType.includes("lost")) add(catalog, offense, position, "FUMBLE_LOST", -3, { fumbles_lost: 1 });
        if (position === "K_ST" && statType.includes("extra point") && /good|made/.test(statType)) add(catalog, offense, "K_ST", "EXTRA_POINT", 1, { extra_points: 1 });
        if (position === "K_ST" && statType.includes("field goal") && /good|made/.test(statType)) { const distance = Number(play.yardsToGoal ?? 0) + 17; add(catalog, offense, "K_ST", "FIELD_GOAL", pointForFieldGoal(distance), { field_goals_made: 1 }); }
      }
      if (playType.includes("field goal good") || playType.includes("made field goal")) { const distance = Number(play.yardsToGoal ?? 0) + 17; add(catalog, offense, "K_ST", "FIELD_GOAL", pointForFieldGoal(distance), { field_goals_made: 1 }); }
      if (hasMadePat(play.playType, play.playText)) add(catalog, offense, "K_ST", "EXTRA_POINT", 1, { extra_points: 1 });
      if (play.scoring && qbTd && !credited.has("QB:pass")) add(catalog, offense, "QB", "TOUCHDOWN", pointForTouchdown(scoringDistance), { passing_touchdowns: 1 });
      const special = specialTeamsTouchdown(play.playType);
      if (special) add(catalog, offense, "K_ST", special, 12, { special_teams_touchdowns: 1 });
    }
    if (defense && eligibleGames.get(normal(defense))?.has(play.gameId)) {
      const defensiveStats = sourceStats.filter(stat => normal(stat.team) === normal(defense));
      const text = `${play.playType ?? ""} ${play.playText ?? ""}`.toLowerCase();
      const specialTeamsPlay = isSpecialTeamsPlayType(play.playType);
      if (text.includes("blocked field goal") || text.includes("field goal blocked")) add(catalog, defense, "K_ST", "BLOCKED_FIELD_GOAL", 3, { blocked_field_goals: 1 });
      if (text.includes("blocked punt") || text.includes("punt blocked")) add(catalog, defense, "K_ST", "BLOCKED_PUNT", 3, { blocked_punts: 1 });
      if (text.includes("safety")) {
        if (specialTeamsPlay) add(catalog, defense, "K_ST", "SPECIAL_TEAMS_SAFETY", 6, { special_teams_safeties: 1 });
        else add(catalog, defense, "DEF", "DEFENSIVE_SAFETY", 6, { defensive_safeties: 1 });
      }
      for (const stat of defensiveStats) {
        const statType = String(stat.statType).toLowerCase();
        if (statType.includes("sack")) add(catalog, defense, "DEF", "SACK", 1, { sacks: 1 });
        if (statType.includes("interception") || statType.includes("fumble recovery")) add(catalog, defense, "DEF", "DEFENSIVE_TURNOVER", 3, { turnovers: 1 });
        if (play.scoring && !specialTeamsPlay && statType.includes("touchdown")) add(catalog, defense, "DEF", "DEFENSIVE_TOUCHDOWN", pointForDefensiveTouchdown(play.yardsGained ?? null), { defensive_touchdowns: 1 });
      }
    }
  }
  console.log(`processed week ${week}`);
}

const rows = [...catalog.values()].map(row => {
  const eligibleGames = completedEligibleGameCounts.get(normal(row.school_name)) ?? 0;
  const normalizationFactor = eligibleGames > 0 && eligibleGames < 12 ? 12 / eligibleGames : 1;
  const officialPoints = Number(row.official_points.toFixed(2));
  return { ...row, official_points: officialPoints, eligible_games: eligibleGames, normalization_factor: Number(normalizationFactor.toFixed(4)), normalized_points: Number((officialPoints * normalizationFactor).toFixed(2)) };
});
for (let index = 0; index < rows.length; index += 250) await upsertCatalog(rows.slice(index, index + 250));
await writeFile("/tmp/big36_2025_research_summary.json", JSON.stringify({ season, units: rows.length, rows }, null, 2));
console.log(JSON.stringify({ season, units: rows.length }));
