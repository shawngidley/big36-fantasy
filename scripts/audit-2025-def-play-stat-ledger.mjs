import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const controls = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8')).rows;
const normalized = JSON.parse(await readFile('/tmp/cfbfastR_2025_kst_def_ledger.json', 'utf8')).rows;
const schools = teams.map(team => team.school);
const schoolsBySpecificity = [...schools].sort((left, right) => normal(right).length - normal(left).length);
const selectedBySchool = new Map();
const eligibleGameIds = new Set();
for (const school of schools) {
  const selected = games.filter(game => game.seasonType === 'regular' && [game.homeTeam, game.awayTeam].some(team => normal(team) === normal(school)))
    .sort((left, right) => new Date(left.startDate) - new Date(right.startDate) || Number(left.id) - Number(right.id))
    .slice(0, 12)
    .filter(game => game.completed);
  selectedBySchool.set(school, new Set(selected.map(game => Number(game.id))));
  selected.forEach(game => eligibleGameIds.add(Number(game.id)));
}
const schoolForTeam = value => schoolsBySpecificity.find(school => normal(value) === normal(school) || normal(value).startsWith(`${normal(school)} `));
const controlBySchool = new Map(controls.filter(row => row.position === 'DEF').map(row => [row.school_name, row.control]));
const normalizedBySchool = new Map(normalized.filter(row => row.position === 'DEF').map(row => [row.school_name, row]));
const ledger = new Map(schools.map(school => [school, { school_name: school, events: { SACK: 0, INTERCEPTION: 0, FUMBLE_RECOVERY: 0, DEFENSIVE_TOUCHDOWN: 0, DEFENSIVE_SAFETY: 0, SHUTOUT: 0 }, points: 0, unresolved: [] }]));

for (const school of schools) {
  for (const game of games.filter(game => selectedBySchool.get(school)?.has(Number(game.id)))) {
    const opponentPoints = normal(game.homeTeam) === normal(school) ? Number(game.awayPoints) : Number(game.homePoints);
    if (opponentPoints === 0) {
      const item = ledger.get(school); item.events.SHUTOUT += 1; item.points += 15;
    }
  }
}

const weeks = [...new Set(games.map(game => Number(game.week)))].sort((left, right) => left - right);
for (const week of weeks) {
  const [plays, stats] = await Promise.all([
    readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, 'utf8').then(JSON.parse),
    readFile(`/tmp/big36_2025_cfbd_cache/play_stats_week_${week}.json`, 'utf8').then(JSON.parse),
  ]);
  const playById = new Map(plays.map(play => [String(play.id), play]));
  for (const stat of stats) {
    const gameId = Number(stat.gameId);
    if (!eligibleGameIds.has(gameId) || Number(stat.stat ?? 0) === 0) continue;
    const school = schoolForTeam(stat.team);
    if (!school || !selectedBySchool.get(school)?.has(gameId)) continue;
    const type = normal(stat.statType);
    const item = ledger.get(school);
    if (type === 'sack') {
      item.events.SACK += Number(stat.stat); item.points += Number(stat.stat);
    } else if (type === 'interception') {
      item.events.INTERCEPTION += Number(stat.stat); item.points += Number(stat.stat) * 3;
    } else if (type === 'fumble recovered') {
      const play = playById.get(String(stat.playId));
      if (play && normal(play.defense) === normal(stat.team)) {
        item.events.FUMBLE_RECOVERY += Number(stat.stat); item.points += Number(stat.stat) * 3;
      }
    }
  }
  console.log(`processed week ${week}`);
}

for (const school of schools) {
  const item = ledger.get(school);
  const scoring = normalizedBySchool.get(school);
  if (!scoring) { item.unresolved.push('Normalized defensive scoring ledger row is unavailable.'); continue; }
  for (const [event, count] of Object.entries(scoring.events ?? {})) {
    if (!['DEFENSIVE_TOUCHDOWN', 'DEFENSIVE_SAFETY'].includes(event)) continue;
    item.events[event] += Number(count);
    item.points += Number(scoring.event_points?.[event] ?? 0);
  }
  for (const unresolved of scoring.unresolved ?? []) item.unresolved.push(unresolved.reason);
}

const rows = schools.map(school => {
  const item = ledger.get(school);
  const control = controlBySchool.get(school) ?? {};
  const comparisons = {
    sacks: { control: Number(control.sacks ?? 0), ledger: item.events.SACK },
    interceptions: { control: Number(control.interceptions ?? 0), ledger: item.events.INTERCEPTION },
    defensive_touchdowns: { control: Number(control.defensive_touchdowns ?? 0), ledger: item.events.DEFENSIVE_TOUCHDOWN },
    shutouts: { control: Number(control.shutouts ?? 0), ledger: item.events.SHUTOUT },
  };
  return { ...item, comparisons, matches_visible_controls: Object.values(comparisons).every(value => value.control === value.ledger) };
});
const output = { season: 2025, summary: { units: rows.length, visible_control_matches: rows.filter(row => row.matches_visible_controls).length, unresolved_units: rows.filter(row => row.unresolved.length).length }, rows };
await writeFile('/tmp/cfbd_2025_def_play_stat_ledger.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/cfbd_2025_def_play_stat_ledger.json', summary: output.summary }, null, 2));
