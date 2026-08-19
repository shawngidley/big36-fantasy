import { readFile, writeFile } from 'node:fs/promises';

const season = 2025;
const cache = '/tmp/big36_2025_cfbd_cache';
const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const schools = new Map(teams.map((team) => [normalize(team.school), team.school]));
const games = JSON.parse(await readFile(`${cache}/regular_games.json`, 'utf8'));

const eligibleBySchool = new Map();
for (const school of schools.values()) {
  const selected = games
    .filter((game) => game.seasonType === 'regular' && (normalize(game.homeTeam) === normalize(school) || normalize(game.awayTeam) === normalize(school)))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || Number(a.id) - Number(b.id))
    .slice(0, 12);
  eligibleBySchool.set(normalize(school), new Set(selected.map((game) => Number(game.id))));
}

const gaps = [];
for (const week of [...new Set(games.map((game) => game.week))].sort((a, b) => a - b)) {
  const plays = JSON.parse(await readFile(`${cache}/plays_week_${week}.json`, 'utf8'));
  for (const play of plays) {
    const offense = schools.get(normalize(play.offense));
    const defense = schools.get(normalize(play.defense));
    const eligible = (offense && eligibleBySchool.get(normalize(offense))?.has(Number(play.gameId))) || (defense && eligibleBySchool.get(normalize(defense))?.has(Number(play.gameId)));
    if (!eligible) continue;
    const type = String(play.playType ?? '').toLowerCase();
    const text = String(play.playText ?? '').toLowerCase();
    const scoring = Boolean(play.scoring) || /(touchdown|\btd\b|field goal good|made field goal|extra point good|pat good|safety)/.test(`${type} ${text}`);
    if (!scoring) continue;
    const requiresDistance = /(touchdown|\btd\b|field goal good|made field goal)/.test(`${type} ${text}`);
    const distance = play.yardsToGoal ?? play.yardsGained ?? null;
    if (requiresDistance && (distance === null || distance === undefined || Number(distance) <= 0)) {
      gaps.push({
        week,
        game_id: Number(play.gameId),
        play_id: String(play.id),
        offense: play.offense,
        defense: play.defense,
        play_type: play.playType,
        play_text: play.playText,
        cfbd_yards_to_goal: play.yardsToGoal ?? null,
        cfbd_yards_gained: play.yardsGained ?? null,
      });
    }
  }
}

const summary = {
  season,
  scoring_evidence_gaps: gaps.length,
  affected_games: new Set(gaps.map((gap) => gap.game_id)).size,
  affected_offenses: new Set(gaps.map((gap) => normalize(gap.offense))).size,
};
const output = { summary, gaps };
await writeFile('/tmp/historical_scoring_evidence_gaps.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/historical_scoring_evidence_gaps.json', summary }, null, 2));
