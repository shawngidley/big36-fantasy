import { readFile, writeFile } from "node:fs/promises";

const season = 2025;
const cacheDirectory = "/tmp/big36_2025_cfbd_cache/boxscores";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required.");

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const safeName = value => normal(value).replace(/[^a-z0-9]+/g, "_");
const rosterPosition = value => ({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", K: "K_ST", PK: "K_ST", P: "K_ST" }[String(value ?? "").toUpperCase()] ?? null);
const positions = ["RB", "WR", "TE", "K_ST", "DEF"];

const teams = JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8"));
const games = JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8"));
const response = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=in.(RB,WR,TE,K_ST,DEF)&select=school_name,position,official_points,event_counts,stat_summary,eligible_games`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!response.ok) throw new Error(`Catalog read failed (${response.status}).`);
const catalog = await response.json();
const catalogByKey = new Map(catalog.map(row => [`${normal(row.school_name)}::${row.position}`, row]));

function numberFrom(value) {
  const primary = String(value ?? "0").split("/")[0];
  const parsed = Number(primary.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function typeAthletes(teamBox, categoryName, typeName) {
  const category = teamBox?.categories?.find(item => normal(item.name) === normal(categoryName));
  const type = category?.types?.find(item => normal(item.name) === normal(typeName));
  return type?.athletes ?? [];
}

function positionForBoxAthlete(athlete, roster) {
  return roster.byId.get(String(athlete.id)) ?? roster.byName.get(normal(athlete.name)) ?? null;
}

function positionStat(teamBox, categoryName, typeName, roster, accepted) {
  return typeAthletes(teamBox, categoryName, typeName)
    .filter(athlete => accepted.includes(positionForBoxAthlete(athlete, roster)))
    .reduce((sum, athlete) => sum + numberFrom(athlete.stat), 0);
}

function allAthleteStat(teamBox, categoryName, typeName) {
  return typeAthletes(teamBox, categoryName, typeName).reduce((sum, athlete) => sum + numberFrom(athlete.stat), 0);
}

function publishedSummary(row) {
  const summary = row?.stat_summary ?? {};
  const events = row?.event_counts ?? {};
  return { summary, events };
}

function compare(published, controls, keys) {
  return Object.fromEntries(keys.map(key => [key, { published: Number(published[key] ?? 0), control: Number(controls[key] ?? 0), delta: Number(published[key] ?? 0) - Number(controls[key] ?? 0) }]));
}

function controlFor(position, teamBox, roster, opponentPoints) {
  const offensiveTouchdowns = accepted => positionStat(teamBox, "rushing", "TD", roster, accepted) + positionStat(teamBox, "receiving", "TD", roster, accepted);
  if (["RB", "WR", "TE"].includes(position)) {
    const accepted = [position];
    return {
      touchdowns: offensiveTouchdowns(accepted),
      rushing_touchdowns: positionStat(teamBox, "rushing", "TD", roster, accepted),
      receiving_touchdowns: positionStat(teamBox, "receiving", "TD", roster, accepted),
      fumbles_lost: positionStat(teamBox, "fumbles", "LOST", roster, accepted),
    };
  }
  if (position === "K_ST") {
    return {
      field_goals_made: allAthleteStat(teamBox, "kicking", "FG"),
      extra_points: allAthleteStat(teamBox, "kicking", "XP"),
      kick_return_touchdowns: allAthleteStat(teamBox, "kickReturns", "TD"),
      punt_return_touchdowns: allAthleteStat(teamBox, "puntReturns", "TD"),
    };
  }
  return {
    sacks: allAthleteStat(teamBox, "defensive", "SACKS"),
    interceptions: allAthleteStat(teamBox, "interceptions", "INT"),
    defensive_touchdowns: allAthleteStat(teamBox, "defensive", "TD") + allAthleteStat(teamBox, "interceptions", "TD"),
    shutouts: Number(opponentPoints) === 0 ? 1 : 0,
  };
}

function publishedFor(position, row) {
  const { summary, events } = publishedSummary(row);
  if (["RB", "WR", "TE"].includes(position)) {
    return {
      touchdowns: Number(summary.touchdowns ?? events.TOUCHDOWN ?? 0),
      rushing_touchdowns: Number(summary.rushing_touchdowns ?? 0),
      receiving_touchdowns: Number(summary.receiving_touchdowns ?? 0),
      fumbles_lost: Number(summary.fumbles_lost ?? events.FUMBLE_LOST ?? 0),
    };
  }
  if (position === "K_ST") {
    return {
      field_goals_made: Number(summary.field_goals_made ?? events.FIELD_GOAL ?? 0),
      extra_points: Number(summary.extra_points ?? events.EXTRA_POINT ?? 0),
      kick_return_touchdowns: Number(summary.kick_return_touchdowns ?? 0),
      punt_return_touchdowns: Number(summary.punt_return_touchdowns ?? 0),
    };
  }
  return {
    sacks: Number(summary.sacks ?? events.SACK ?? 0),
    interceptions: Number(summary.interceptions ?? 0),
    defensive_touchdowns: Number(summary.defensive_touchdowns ?? events.DEFENSIVE_TOUCHDOWN ?? 0),
    shutouts: Number(summary.shutouts ?? events.SHUTOUT ?? 0),
  };
}

const rows = [];
for (const [index, team] of teams.entries()) {
  const school = team.school;
  const selectedGames = games
    .filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].map(normal).includes(normal(school)))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || Number(a.id) - Number(b.id))
    .slice(0, 12)
    .filter(game => game.completed);
  const rosterRows = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safeName(school)}.json`, "utf8"));
  const roster = {
    byId: new Map(rosterRows.map(player => [String(player.id), rosterPosition(player.position)])),
    byName: new Map(rosterRows.map(player => [normal(`${player.firstName ?? ""} ${player.lastName ?? ""}`), rosterPosition(player.position)])),
  };
  const boxes = JSON.parse(await readFile(`${cacheDirectory}/${safeName(school)}.json`, "utf8"));
  const boxByGame = new Map(boxes.map(box => [Number(box.id), box]));
  const totalsByPosition = Object.fromEntries(positions.map(position => [position, {}]));
  const missingBoxscoreGameIds = [];
  for (const game of selectedGames) {
    const box = boxByGame.get(Number(game.id));
    const teamBox = box?.teams?.find(item => normal(item.team) === normal(school));
    if (!teamBox) { missingBoxscoreGameIds.push(game.id); continue; }
    const opponentPoints = normal(game.homeTeam) === normal(school) ? game.awayPoints : game.homePoints;
    for (const position of positions) {
      const values = controlFor(position, teamBox, roster, opponentPoints);
      for (const [key, value] of Object.entries(values)) totalsByPosition[position][key] = Number(totalsByPosition[position][key] ?? 0) + Number(value);
    }
  }
  for (const position of positions) {
    const published = catalogByKey.get(`${normal(school)}::${position}`);
    const control = totalsByPosition[position];
    const shown = publishedFor(position, published);
    const fields = Object.keys(control);
    const comparisons = compare(shown, control, fields);
    const matchedVisibleControls = Object.values(comparisons).every(item => item.delta === 0);
    rows.push({ school_name: school, position, eligible_games: selectedGames.length, missing_boxscore_game_ids: missingBoxscoreGameIds, control, published: shown, comparisons, matched_visible_controls: matchedVisibleControls, source_limit: position === "K_ST" ? "Blocks, special-teams safeties, and some return ownership require event-level review." : position === "DEF" ? "Fumble recoveries, safeties, and return ownership require event-level review." : null });
  }
  console.log(`audited ${index + 1}/${teams.length}`);
}

const byPosition = Object.fromEntries(positions.map(position => {
  const positionRows = rows.filter(row => row.position === position);
  return [position, { units: positionRows.length, exact_visible_control_matches: positionRows.filter(row => row.matched_visible_controls && row.missing_boxscore_game_ids.length === 0).length, exception_count: positionRows.filter(row => !row.matched_visible_controls || row.missing_boxscore_game_ids.length > 0).length }];
}));
const report = { season, generated_at: new Date().toISOString(), positions: byPosition, rows };
await writeFile("/tmp/non_qb_2025_boxscore_certification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ season, positions: byPosition, total_units: rows.length }, null, 2));
