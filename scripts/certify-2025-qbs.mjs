import { readFile, writeFile } from "node:fs/promises";

const season = 2025;
const cache = "/tmp/big36_2025_cfbd_cache";
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase credentials are required for certification comparison.");

const normal = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const nameKey = value => normal(value).replace(/[^a-z0-9]+/g, " ").trim();
const position = value => ({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" }[String(value ?? "").toUpperCase()] ?? null);
const hasTextName = (text, player) => (player.name.length >= 5 && text.includes(` ${player.name} `)) || (player.short.length >= 3 && text.includes(` ${player.short} `));
const beforeVerbPositions = (playText, roster, pattern) => {
  const before = ` ${nameKey(playText).split(pattern)[0] ?? ""} `;
  return new Set([...roster.values()].filter(player => player.position && hasTextName(before, player)).map(player => player.position));
};
const afterPhrasePositions = (playText, roster, phrase) => {
  const after = ` ${nameKey(playText).split(phrase)[1] ?? ""} `;
  return new Set([...roster.values()].filter(player => player.position && hasTextName(after, player)).map(player => player.position));
};
const isSupersededInterception = (play, nextPlay) => /interception/i.test(String(play.playType ?? "")) && play.gameId === nextPlay?.gameId && play.driveId && play.driveId === nextPlay?.driveId && normal(play.offense) === normal(nextPlay?.offense) && play.period === nextPlay?.period && play.clock?.minutes === nextPlay?.clock?.minutes && play.clock?.seconds === nextPlay?.clock?.seconds && !/interception/i.test(String(nextPlay?.playType ?? "")) && Number(nextPlay?.playNumber ?? 0) > Number(play.playNumber ?? 0);

const teams = JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8"));
const games = JSON.parse(await readFile(`${cache}/regular_games.json`, "utf8"));
const weeks = [...new Set(games.map(game => game.week))].sort((a, b) => a - b);
const weekly = await Promise.all(weeks.map(async week => ({ plays: JSON.parse(await readFile(`${cache}/plays_week_${week}.json`, "utf8")), stats: JSON.parse(await readFile(`${cache}/play_stats_week_${week}.json`, "utf8")) })));
const plays = weekly.flatMap(week => week.plays);
const statsByPlay = new Map();
for (const stat of weekly.flatMap(week => week.stats)) statsByPlay.set(stat.playId, [...(statsByPlay.get(stat.playId) ?? []), stat]);

const catalogResponse = await fetch(`${supabaseUrl}/rest/v1/b36_draft_research_units?season=eq.${season}&position=eq.QB&select=school_name,official_points,event_counts,stat_summary,eligible_games`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
if (!catalogResponse.ok) throw new Error(`Catalog read failed (${catalogResponse.status}).`);
const publishedBySchool = new Map((await catalogResponse.json()).map(row => [normal(row.school_name), row]));

const rows = [];
for (const team of teams) {
  const school = team.school;
  const selectedGames = games.filter(game => game.seasonType === "regular" && [game.homeTeam, game.awayTeam].map(normal).includes(normal(school))).sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || a.id - b.id).slice(0, 12);
  const eligibleGameIds = new Set(selectedGames.filter(game => game.completed).map(game => game.id));
  const rosterRows = JSON.parse(await readFile(`${cache}/roster_${normal(school).replace(/[^a-z0-9]+/g, "_")}.json`, "utf8"));
  const roster = new Map(rosterRows.map(player => [String(player.id), { position: position(player.position), name: nameKey(`${player.firstName ?? ""} ${player.lastName ?? ""}`), short: nameKey(`${String(player.firstName ?? "").slice(0, 1)} ${player.lastName ?? ""}`) }]));
  const schoolPlays = plays.filter(play => eligibleGameIds.has(play.gameId) && normal(play.offense) === normal(school));
  const events = [];
  const seenSourcePlays = new Set();
  for (let index = 0; index < schoolPlays.length; index += 1) {
    const play = schoolPlays[index];
    if (isSupersededInterception(play, schoolPlays[index + 1])) continue;
    const type = String(play.playType ?? "").toLowerCase();
    const text = nameKey(play.playText);
    const sourceKey = [play.gameId, play.period, play.clock?.minutes, play.clock?.seconds, type, text].join("|");
    if (seenSourcePlays.has(sourceKey)) continue;
    seenSourcePlays.add(sourceKey);
    if (/two[ -]?point/.test(`${type} ${text}`)) continue;
    const td = /(touchdown|\btd\b)/.test(`${type} ${text}`) && !/(kickoff return|punt return|field goal return|blocked kick)/.test(type);
    const stats = (statsByPlay.get(play.id) ?? []).filter(stat => normal(stat.team) === normal(school) && Number(stat.stat) !== 0);
    const positionsFor = matcher => new Set(stats.flatMap(stat => matcher(String(stat.statType).toLowerCase()) ? [roster.get(String(stat.athleteId))?.position] : []).filter(Boolean));
    const passingPositions = positionsFor(value => value.includes("passing touchdown"));
    const rushingPositions = positionsFor(value => value.includes("rushing touchdown"));
    const namedPasser = new Set([...beforeVerbPositions(play.playText, roster, /\spass\b/), ...afterPhrasePositions(play.playText, roster, " pass from ")]);
    const namedRusher = beforeVerbPositions(play.playText, roster, /\s(?:rush\w*|ran|run)\b/);
    const passTd = passingPositions.size > 0 || (td && /\bpass\b/.test(`${type} ${text}`));
    const rushTd = !passTd && (rushingPositions.size > 0 || (td && /\b(rush\w*|ran|run)\b/.test(`${type} ${text}`)));
    const qbPassTd = passTd && (passingPositions.has("QB") || namedPasser.has("QB"));
    const qbRushTd = rushTd && (rushingPositions.has("QB") || namedRusher.has("QB"));
    const interception = /interception/.test(type) && (positionsFor(value => value.includes("interception")).has("QB") || namedPasser.has("QB"));
    if (passTd || rushTd || interception) events.push({ play_id: play.id, game_id: play.gameId, type: play.playType, text: play.playText, team_pass_td: passTd, team_rush_td: rushTd, qb_pass_td: qbPassTd, qb_rush_td: qbRushTd, qb_interception: interception, attribution: { passing_positions: [...passingPositions], rushing_positions: [...rushingPositions], named_passer: [...namedPasser], named_rusher: [...namedRusher] } });
  }
  const certified = {
    passing_touchdowns: events.filter(event => event.qb_pass_td).length,
    rushing_touchdowns: events.filter(event => event.qb_rush_td).length,
    touchdowns: events.filter(event => event.qb_pass_td || event.qb_rush_td).length,
    interceptions: events.filter(event => event.qb_interception).length,
  };
  const controls = {
    team_passing_touchdowns: events.filter(event => event.team_pass_td).length,
    team_rushing_touchdowns: events.filter(event => event.team_rush_td).length,
    unattributed_passing_touchdowns: events.filter(event => event.team_pass_td && !event.qb_pass_td).length,
    unattributed_rushing_touchdowns: events.filter(event => event.team_rush_td && !event.qb_rush_td).length,
  };
  const published = publishedBySchool.get(normal(school));
  const publishedSummary = published?.stat_summary ?? {};
  const publishedCounts = { passing_touchdowns: Number(publishedSummary.passing_touchdowns ?? 0), touchdowns: Number(publishedSummary.touchdowns ?? 0), interceptions: Number(publishedSummary.interceptions ?? 0) };
  const discrepancy = publishedCounts.passing_touchdowns !== certified.passing_touchdowns || publishedCounts.touchdowns !== certified.touchdowns || publishedCounts.interceptions !== certified.interceptions;
  rows.push({ school_name: school, selected_games: selectedGames.length, completed_games: eligibleGameIds.size, controls, certified, published: { ...publishedCounts, official_points: Number(published?.official_points ?? 0) }, discrepancy, needs_event_review: discrepancy || controls.unattributed_passing_touchdowns > 0 || controls.unattributed_rushing_touchdowns > 0, events });
}
const report = { season, generated_at: new Date().toISOString(), schools: rows.length, summary: { matching_published_rows: rows.filter(row => !row.discrepancy).length, discrepant_published_rows: rows.filter(row => row.discrepancy).length, rows_with_unattributed_events: rows.filter(row => row.controls.unattributed_passing_touchdowns > 0 || row.controls.unattributed_rushing_touchdowns > 0).length }, rows };
await writeFile("/tmp/qb_2025_certification_report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report.summary, first_exceptions: rows.filter(row => row.needs_event_review).slice(0, 20).map(row => ({ school: row.school_name, controls: row.controls, certified: row.certified, published: row.published })) }, null, 2));
