import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const safeName = value => normal(value).replace(/[^a-z0-9]+/g, '_');
const rosterPosition = value => ({ QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE' }[String(value ?? '').toUpperCase()] ?? null);

function numberFrom(value) {
  const primary = String(value ?? '0').split('/')[0];
  const parsed = Number(primary.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function athletes(teamBox, categoryName, typeName) {
  const category = teamBox?.categories?.find(item => normal(item.name) === normal(categoryName));
  const type = category?.types?.find(item => normal(item.name) === normal(typeName));
  return type?.athletes ?? [];
}

function positionStat(teamBox, category, type, roster, accepted) {
  return athletes(teamBox, category, type)
    .filter(athlete => accepted.includes(roster.byId.get(String(athlete.id)) ?? roster.byName.get(normal(athlete.name))))
    .reduce((sum, athlete) => sum + numberFrom(athlete.stat), 0);
}

function officialFor(position, teamBox, roster) {
  const rushing = positionStat(teamBox, 'rushing', 'TD', roster, [position]);
  const passing = position === 'QB' ? positionStat(teamBox, 'passing', 'TD', roster, ['QB']) : 0;
  const receiving = position === 'QB' ? 0 : positionStat(teamBox, 'receiving', 'TD', roster, [position]);
  return { touchdowns: passing + rushing + receiving, passing_touchdowns: passing, rushing_touchdowns: rushing };
}

const [cases, ledger, games] = await Promise.all([
  readFile('/tmp/cfbfastR_2025_one_touchdown_undercounts.json', 'utf8').then(JSON.parse),
  readFile('/tmp/cfbfastR_2025_offensive_td_ledger.json', 'utf8').then(JSON.parse),
  readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8').then(JSON.parse),
]);
const ledgerByKey = new Map(ledger.rows.map(row => [`${row.school_name}::${row.position}`, row]));
const report = [];

for (const item of cases) {
  const key = `${item.school_name}::${item.position}`;
  const row = ledgerByKey.get(key);
  const rosterRows = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/roster_${safeName(item.school_name)}.json`, 'utf8'));
  const roster = {
    byId: new Map(rosterRows.map(player => [String(player.id), rosterPosition(player.position)])),
    byName: new Map(rosterRows.map(player => [normal(`${player.firstName ?? ''} ${player.lastName ?? ''}`), rosterPosition(player.position)])),
  };
  const boxes = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/boxscores/${safeName(item.school_name)}.json`, 'utf8'));
  const boxByGame = new Map(boxes.map(box => [Number(box.id), box]));
  const selected = games
    .filter(game => game.seasonType === 'regular' && [game.homeTeam, game.awayTeam].map(normal).includes(normal(item.school_name)) && game.completed)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || Number(a.id) - Number(b.id))
    .slice(0, 12);
  const eventsByGame = new Map();
  for (const event of row.events) {
    const values = eventsByGame.get(Number(event.game_id)) ?? { touchdowns: 0, passing_touchdowns: 0, rushing_touchdowns: 0, events: [] };
    values.touchdowns += event.two_point_conversion ? 0 : 1;
    values.passing_touchdowns += event.pass_td && item.position === 'QB' ? 1 : 0;
    values.rushing_touchdowns += event.rush_td ? 1 : 0;
    values.events.push(event);
    eventsByGame.set(Number(event.game_id), values);
  }
  const differences = [];
  for (const game of selected) {
    const teamBox = boxByGame.get(Number(game.id))?.teams?.find(team => normal(team.team) === normal(item.school_name));
    if (!teamBox) continue;
    const official = officialFor(item.position, teamBox, roster);
    const counted = eventsByGame.get(Number(game.id)) ?? { touchdowns: 0, passing_touchdowns: 0, rushing_touchdowns: 0, events: [] };
    const delta = Object.fromEntries(Object.keys(official).map(metric => [metric, counted[metric] - official[metric]]));
    if (Object.values(delta).some(value => value !== 0)) differences.push({ game_id: Number(game.id), opponent: normal(game.homeTeam) === normal(item.school_name) ? game.awayTeam : game.homeTeam, official, counted, delta });
  }
  report.push({ school_name: item.school_name, position: item.position, differences });
}

await writeFile('/tmp/cfbfastR_2025_one_touchdown_undercounts_by_game.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: report.length, cases_with_game_differences: report.filter(item => item.differences.length).length }, null, 2));
