import { readdir, readFile } from "node:fs/promises";

const cacheDirectory = "/tmp/big36_2025_cfbd_cache";
const files = (await readdir(cacheDirectory)).filter(file => /^plays_week_\d+\.json$/.test(file));
const normalize = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const fbsSchools = new Set(JSON.parse(await readFile("/tmp/cfbd_2025_fbs_teams.json", "utf8")).map(team => normalize(team.school)));
const scoringSamples = [];
const scoringWithStats = [];
const conversionSamples = [];
const fieldGoalSamples = [];
const touchdownStatTypes = new Map();
let totalPlays = 0;
let totalStatRows = 0;
let matchedStatRows = 0;
let normalizedMatchedStatRows = 0;
let firstPlayId = null;
let firstStatPlayId = null;
let fbsOffensiveTouchdownsWithStats = 0;
let fbsOffensiveTouchdownsWithoutStats = 0;

for (const playFile of files) {
  const week = playFile.match(/\d+/)?.[0];
  const plays = JSON.parse(await readFile(`${cacheDirectory}/${playFile}`, "utf8"));
  const stats = JSON.parse(await readFile(`${cacheDirectory}/play_stats_week_${week}.json`, "utf8"));
  const statsByPlay = new Map();
  for (const stat of stats) statsByPlay.set(stat.playId, [...(statsByPlay.get(stat.playId) ?? []), stat]);
  const normalizedStatsByPlay = new Map();
  for (const stat of stats) normalizedStatsByPlay.set(String(stat.playId), [...(normalizedStatsByPlay.get(String(stat.playId)) ?? []), stat]);
  totalStatRows += stats.length;
  firstStatPlayId ??= stats[0]?.playId ?? null;

  for (const play of plays) {
    totalPlays += 1;
    firstPlayId ??= play.id ?? null;
    const playStats = statsByPlay.get(play.id) ?? [];
    matchedStatRows += playStats.length;
    normalizedMatchedStatRows += (normalizedStatsByPlay.get(String(play.id)) ?? []).length;
    const statTypes = playStats.map(stat => stat.statType);
    if (fbsSchools.has(normalize(play.offense)) && /^(passing|rushing) touchdown$/i.test(String(play.playType ?? ""))) {
      if (playStats.length > 0) fbsOffensiveTouchdownsWithStats += 1;
      else fbsOffensiveTouchdownsWithoutStats += 1;
    }
    if (play.scoring && scoringSamples.length < 30) {
      scoringSamples.push({
        id: play.id,
        gameId: play.gameId,
        playType: play.playType,
        yardsToGoal: play.yardsToGoal,
        yardsGained: play.yardsGained,
        text: play.playText,
        statTypes,
      });
    }
    if (play.scoring && playStats.length > 0 && scoringWithStats.length < 30) {
      scoringWithStats.push({
        id: play.id,
        gameId: play.gameId,
        offense: play.offense,
        defense: play.defense,
        playType: play.playType,
        yardsToGoal: play.yardsToGoal,
        yardsGained: play.yardsGained,
        text: play.playText,
        stats: playStats.map(stat => ({ athleteId: stat.athleteId, team: stat.team, statType: stat.statType, stat: stat.stat })),
      });
    }
    if (/two point|2pt/i.test(String(play.playType)) && conversionSamples.length < 30) {
      conversionSamples.push({
        id: play.id,
        gameId: play.gameId,
        offense: play.offense,
        defense: play.defense,
        playType: play.playType,
        yardsToGoal: play.yardsToGoal,
        yardsGained: play.yardsGained,
        text: play.playText,
        stats: playStats.map(stat => ({ athleteId: stat.athleteId, team: stat.team, statType: stat.statType, stat: stat.stat })),
      });
    }
    if (/field goal/i.test(String(play.playType)) && fieldGoalSamples.length < 20) {
      fieldGoalSamples.push({
        id: play.id,
        playType: play.playType,
        yardsToGoal: play.yardsToGoal,
        yardsGained: play.yardsGained,
        text: play.playText,
        statTypes,
      });
    }
    if (play.scoring) {
      for (const type of statTypes) touchdownStatTypes.set(type, (touchdownStatTypes.get(type) ?? 0) + 1);
    }
  }
}

console.log(JSON.stringify({
  joinAudit: { totalPlays, totalStatRows, matchedStatRows, normalizedMatchedStatRows, firstPlayId, firstStatPlayId, fbsOffensiveTouchdownsWithStats, fbsOffensiveTouchdownsWithoutStats },
  scoringSamples,
  scoringWithStats,
  conversionSamples,
  fieldGoalSamples,
  scoringStatTypes: [...touchdownStatTypes.entries()].sort(([a], [b]) => a.localeCompare(b)),
}, null, 2));
