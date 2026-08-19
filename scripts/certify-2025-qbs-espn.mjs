import { mkdir, readFile, writeFile } from "node:fs/promises";

const season = 2025;
const cacheDirectory = "/tmp/big36_2025_cfbd_cache/espn_summaries";
const key = process.env.CFBD_API_KEY;
if (!key) throw new Error("CFBD_API_KEY is required for official player box-score reads.");
await mkdir(cacheDirectory, { recursive: true });

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = value => normal(value).replace(/[^a-z0-9]+/g, " ").trim();
const safe = value => String(value).replace(/[^a-z0-9]+/gi, "_");
const qb = value => String(value ?? "").toUpperCase() === "QB";
const gameById = new Map(JSON.parse(await readFile("/tmp/big36_2025_cfbd_cache/regular_games.json", "utf8")).map(game => [Number(game.id), game]));
const teams = JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8"));

async function cachedSummary(gameId) {
  const path = `${cacheDirectory}/${gameId}.json`;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch {
    const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${gameId}`, { signal: AbortSignal.timeout(60000) });
    const body = await response.text();
    if (!response.ok) throw new Error(`ESPN summary ${gameId} failed (${response.status}): ${body.slice(0, 150)}`);
    await writeFile(path, body);
    return JSON.parse(body);
  }
}
async function cachedCfbdBoxscores(team) {
  const path = `/tmp/big36_2025_cfbd_cache/boxscores/${safe(team)}.json`;
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch {
    const response = await fetch(`https://api.collegefootballdata.com/games/players?year=${season}&team=${encodeURIComponent(team)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(120000) });
    const body = await response.text();
    if (!response.ok) throw new Error(`CFBD box scores ${team} failed (${response.status}).`);
    const parsed = JSON.parse(body); await writeFile(path, JSON.stringify(parsed)); return parsed;
  }
}
function qbNameMatcher(roster, text, mode) {
  const primary = nameKey(String(text).split("(")[0]);
  const candidate = mode === "pass" ? ` ${primary.split(" pass from ")[1] ?? primary.split(" pass ")[0] ?? ""} ` : ` ${primary.split(/\s(?:run|rush\w*)\b/)[0] ?? ""} `;
  return roster.find(player => player.isQb && ((player.name.length >= 5 && candidate.includes(` ${player.name} `)) || (player.short.length >= 3 && candidate.includes(` ${player.short} `)))) ?? null;
}
function boxStat(teamBox, categoryName, typeName, roster, onlyQb = false) {
  const category = teamBox?.categories?.find(category => normal(category.name) === categoryName);
  const type = category?.types?.find(statType => normal(statType.name) === typeName);
  return (type?.athletes ?? []).reduce((sum, athlete) => {
    if (onlyQb && !roster.byId.get(String(athlete.id))?.isQb) return sum;
    const value = Number(String(athlete.stat ?? 0).replace(/[^0-9.-]/g, ""));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

const selectedBySchool = new Map();
for (const { school } of teams) selectedBySchool.set(school, [...gameById.values()].filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].includes(school)).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12).filter(game => game.completed));
const allGameIds = [...new Set([...selectedBySchool.values()].flat().map(game => Number(game.id)))];
const summaries = new Map();
for (let index = 0; index < allGameIds.length; index += 12) {
  const ids = allGameIds.slice(index, index + 12);
  const values = await Promise.all(ids.map(async id => [id, await cachedSummary(id)]));
  values.forEach(([id, summary]) => summaries.set(id, summary));
  console.log(`cached ESPN summaries ${Math.min(index + ids.length, allGameIds.length)}/${allGameIds.length}`);
}
const cfbdPlays = [];
for (const week of [...new Set([...gameById.values()].map(game => game.week))]) cfbdPlays.push(...JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, "utf8")));
const cfbdPlayById = new Map(cfbdPlays.map(play => [String(play.id), play]));

const rows = [];
for (const { school } of teams) {
  const rosterRows = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safe(school.toLowerCase())}.json`, "utf8"));
  const roster = rosterRows.map(player => ({ id: String(player.id), isQb: qb(player.position), name: nameKey(`${player.firstName ?? ""} ${player.lastName ?? ""}`), short: nameKey(`${String(player.firstName ?? "").slice(0, 1)} ${player.lastName ?? ""}`) }));
  const rosterContext = { byId: new Map(roster.map(player => [player.id, player])), find: roster.find.bind(roster) };
  const selected = selectedBySchool.get(school) ?? [];
  const boxes = new Map((await cachedCfbdBoxscores(school)).map(box => [Number(box.id), box]));
  const events = [];
  const totals = { passing_touchdowns: 0, rushing_touchdowns: 0, interceptions: 0, tier_events_without_cfbd_match: 0 };
  for (const game of selected) {
    const summary = summaries.get(Number(game.id));
    const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
    const schoolTeamIds = new Set(competitors.filter(competitor => {
      const display = normal(competitor.team?.displayName);
      const short = normal(competitor.team?.shortDisplayName);
      return display === normal(school) || display.startsWith(`${normal(school)} `) || short === normal(school);
    }).map(competitor => String(competitor.team?.id)));
    const teamBox = boxes.get(Number(game.id))?.teams?.find(item => normal(item.team) === normal(school));
    totals.interceptions += boxStat(teamBox, "passing", "int", rosterContext, true);
    const scoringPlays = summary?.scoringPlays ?? [];
    for (const play of scoringPlays) {
      if (!schoolTeamIds.has(String(play.team?.id))) continue;
      const type = normal(play.type?.text);
      const text = String(play.text ?? "");
      const normalizedText = nameKey(String(text).split("(")[0]);
      const isPassingScore = type.includes("passing touchdown") || (/\bpass\b/.test(normalizedText) && /\bpass from\b|\bpass complete\b|\bpass to\b/.test(normalizedText));
      const isRushingScore = !isPassingScore && (type.includes("rushing touchdown") || /\b(run|rush\w*)\b/.test(normalizedText));
      const scorer = isPassingScore ? qbNameMatcher(roster, text, "pass") : isRushingScore ? qbNameMatcher(roster, text, "rush") : null;
      if (!scorer) continue;
      const cfbd = cfbdPlayById.get(String(play.id));
      const event = { game_id: game.id, source_event_id: String(play.id), type: isPassingScore ? "passing touchdown" : "rushing touchdown", text, cfbd_yards_to_goal: cfbd?.yardsToGoal ?? null, cfbd_play_matched: Boolean(cfbd) };
      if (isPassingScore) totals.passing_touchdowns += 1;
      if (isRushingScore) totals.rushing_touchdowns += 1;
      if (!cfbd) totals.tier_events_without_cfbd_match += 1;
      events.push(event);
    }
  }
  const boxTotals = selected.reduce((sum, game) => {
    const teamBox = boxes.get(Number(game.id))?.teams?.find(item => normal(item.team) === normal(school));
    sum.passing_touchdowns += boxStat(teamBox, "passing", "td", rosterContext, true);
    sum.rushing_touchdowns += boxStat(teamBox, "rushing", "td", rosterContext, true);
    sum.interceptions += boxStat(teamBox, "passing", "int", rosterContext, true);
    return sum;
  }, { passing_touchdowns: 0, rushing_touchdowns: 0, interceptions: 0 });
  rows.push({ school_name: school, eligible_games: selected.length, official_boxscore: boxTotals, espn_scoring_summary: totals, events, boxscore_match: boxTotals.passing_touchdowns === totals.passing_touchdowns && boxTotals.rushing_touchdowns === totals.rushing_touchdowns && boxTotals.interceptions === totals.interceptions });
}
const report = { season, generated_at: new Date().toISOString(), rows };
report.summary = { schools: rows.length, matched_schools: rows.filter(row => row.boxscore_match).length, mismatched_schools: rows.filter(row => !row.boxscore_match).length, tier_events_without_cfbd_match: rows.reduce((sum, row) => sum + row.espn_scoring_summary.tier_events_without_cfbd_match, 0), sample_mismatches: rows.filter(row => !row.boxscore_match).slice(0, 20) };
await writeFile("/tmp/qb_2025_espn_boxscore_certification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary, null, 2));
