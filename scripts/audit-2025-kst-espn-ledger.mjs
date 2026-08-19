import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const fieldGoalPoints = distance => distance <= 29 ? 3 : distance <= 39 ? 6 : distance <= 49 ? 9 : 12;
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const controls = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8')).rows;
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
const controlBySchool = new Map(controls.filter(row => row.position === 'K_ST').map(row => [row.school_name, row.control]));
const ledger = new Map(schools.map(school => [school, { school_name: school, points: 0, events: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0 }, event_points: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0 }, unresolved: [] }]));

for (const gameId of eligibleGameIds) {
  const summary = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/espn_summaries/${gameId}.json`, 'utf8'));
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
  const schoolByTeamId = new Map(competitors.map(competitor => {
    const candidates = [competitor.team?.displayName, competitor.team?.shortDisplayName].map(normal);
    const school = schoolsBySpecificity.find(value => candidates.some(candidate => candidate === normal(value) || candidate.startsWith(`${normal(value)} `)));
    return [String(competitor.team?.id), school];
  }));
  for (const play of summary?.scoringPlays ?? []) {
    const school = schoolByTeamId.get(String(play.team?.id));
    if (!school || !selectedBySchool.get(school)?.has(gameId)) continue;
    const type = normal(play.type?.text);
    const text = String(play.text ?? '');
    const item = ledger.get(school);
    if (type.includes('field goal') && /(good|made)/.test(`${type} ${text.toLowerCase()}`)) {
      const match = text.match(/(?:from\s+|)(\d+)\s+yd/i);
      if (!match) item.unresolved.push({ game_id: gameId, reason: 'ESPN field-goal score lacks distance', text });
      else {
        const points = fieldGoalPoints(Number(match[1]));
        item.points += points; item.events.FIELD_GOAL += 1; item.event_points.FIELD_GOAL += points;
      }
    } else if (((type.includes('extra point') || type.includes('pat')) && /(good|made)/.test(`${type} ${text.toLowerCase()}`)) || (/(touchdown|fumble recovery)/.test(type) && /\([^)]*\bkick\b[^)]*\)/i.test(text) && !/(no good|missed|failed)/i.test(text))) {
      item.points += 1; item.events.EXTRA_POINT += 1; item.event_points.EXTRA_POINT += 1;
    } else if ((type.includes('kickoff return') || type.includes('punt return') || type.includes('blocked punt') || type.includes('blocked kick')) && /(touchdown|\btd\b)/.test(`${type} ${text.toLowerCase()}`)) {
      item.points += 12; item.events.RETURN_TOUCHDOWN += 1; item.event_points.RETURN_TOUCHDOWN += 12;
    }
  }
}

const rows = schools.map(school => {
  const item = ledger.get(school);
  const control = controlBySchool.get(school) ?? {};
  const comparisons = {
    field_goals_made: { control: Number(control.field_goals_made ?? 0), ledger: item.events.FIELD_GOAL },
    extra_points: { control: Number(control.extra_points ?? 0), ledger: item.events.EXTRA_POINT },
    return_touchdowns: { control: Number(control.kick_return_touchdowns ?? 0) + Number(control.punt_return_touchdowns ?? 0), ledger: item.events.RETURN_TOUCHDOWN },
  };
  return { ...item, comparisons, matches_control: Object.values(comparisons).every(value => value.control === value.ledger) };
});
const output = { season: 2025, summary: { units: rows.length, control_matches: rows.filter(row => row.matches_control).length, unresolved_units: rows.filter(row => row.unresolved.length).length }, rows };
await writeFile('/tmp/espn_2025_kst_ledger.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/espn_2025_kst_ledger.json', summary: output.summary }, null, 2));
