import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const schools = new Map(teams.map(team => [normal(team.school), team.school]));
const eligible = new Set();
for (const school of schools.values()) {
  games.filter(game => game.seasonType === 'regular' && [game.homeTeam, game.awayTeam].some(team => normal(team) === normal(school)))
    .sort((left, right) => new Date(left.startDate) - new Date(right.startDate) || Number(left.id) - Number(right.id))
    .slice(0, 12)
    .forEach(game => eligible.add(Number(game.id)));
}
const weeks = [...new Set(games.map(game => Number(game.week)))].sort((left, right) => left - right);
const events = [];
for (const week of weeks) {
  const plays = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, 'utf8'));
  for (const play of plays) {
    if (!eligible.has(Number(play.gameId))) continue;
    const type = String(play.playType ?? '');
    const text = String(play.playText ?? '');
    const value = `${type} ${text}`.toLowerCase();
    if (!/(field goal|extra point|\bpat\b|blocked punt|blocked kick|kickoff return|punt return|safety|interception|fumble|sack)/.test(value)) continue;
    events.push({
      game_id: Number(play.gameId),
      play_id: String(play.id),
      offense: play.offense,
      defense: play.defense,
      play_type: type,
      text,
      scoring: Boolean(play.scoring),
      yards_to_goal: play.yardsToGoal ?? null,
      yards_gained: play.yardsGained ?? null,
    });
  }
  console.log(`extracted week ${week}`);
}
await writeFile('/tmp/cfbd_2025_first12_kst_def_candidate_events.json', JSON.stringify({ season: 2025, events }, null, 2));
console.log(JSON.stringify({ season: 2025, eligible_games: eligible.size, candidate_events: events.length }, null, 2));
