import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const fieldGoalPoints = distance => distance <= 29 ? 3 : distance <= 39 ? 6 : distance <= 49 ? 9 : 12;
const teamIdFromRef = ref => String(ref ?? '').match(/\/teams\/(\d+)/)?.[1] ?? null;
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const controls = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8')).rows;
const schools = teams.map(team => team.school);
const selectedBySchool = new Map();
const selectedGames = new Map();
for (const school of schools) {
  const selected = games.filter(game => game.seasonType === 'regular' && [game.homeTeam, game.awayTeam].some(team => normal(team) === normal(school)))
    .sort((left, right) => new Date(left.startDate) - new Date(right.startDate) || Number(left.id) - Number(right.id))
    .slice(0, 12)
    .filter(game => game.completed);
  selectedBySchool.set(school, new Set(selected.map(game => Number(game.id))));
  selected.forEach(game => selectedGames.set(Number(game.id), game));
}
const controlBySchool = new Map(controls.filter(row => row.position === 'K_ST').map(row => [row.school_name, row.control]));
const ledger = new Map(schools.map(school => [school, { school_name: school, points: 0, events: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0 }, event_points: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0 }, unresolved: [], evidence: [] }]));

for (const [gameId, game] of selectedGames) {
  const summary = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/espn_summaries/${gameId}.json`, 'utf8'));
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
  const teamById = new Map(competitors.map(competitor => [String(competitor.team?.id), competitor.homeAway === 'home' ? game.homeTeam : game.awayTeam]));
  const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${gameId}.json`, 'utf8'));
  for (const play of core.items ?? []) {
    if (!play.scoringPlay) continue;
    const school = teamById.get(teamIdFromRef(play.team?.$ref));
    if (!school || !selectedBySchool.get(school)?.has(gameId)) continue;
    const type = normal(play.type?.text);
    const text = String(play.text ?? '');
    const item = ledger.get(school);
    if (type === 'field goal good' && Number(play.scoreValue) === 3) {
      const match = text.match(/(?:field goal attempt from\s+)(\d+)\s+yards?|(?:\b)(\d+)\s+yd\s+(?:fg|field goal)/i);
      if (!match) item.unresolved.push({ game_id: gameId, reason: 'ESPN core made field goal lacks a distance', text });
      else {
        const points = fieldGoalPoints(Number(match[1] ?? match[2]));
        item.points += points; item.events.FIELD_GOAL += 1; item.event_points.FIELD_GOAL += points;
        item.evidence.push({ game_id: gameId, event: 'FIELD_GOAL', points, text });
      }
    } else {
      const successfulPat = Number(play.scoreValue) === 6 && (/(?:\b|\()kick attempt good\b/i.test(text) || /\([^)]*\bkick\b[^)]*\)/i.test(text)) && !/(no good|missed|failed)/i.test(text);
      const kstReturnTouchdown = Number(play.scoreValue) === 6 && /^(kickoff|kickoff return touchdown|punt|punt return|punt return touchdown)$/.test(type) && !/fumbled/i.test(text);
      if (successfulPat) {
        item.points += 1; item.events.EXTRA_POINT += 1; item.event_points.EXTRA_POINT += 1;
        item.evidence.push({ game_id: gameId, event: 'EXTRA_POINT', points: 1, text });
      }
      if (kstReturnTouchdown) {
        item.points += 12; item.events.RETURN_TOUCHDOWN += 1; item.event_points.RETURN_TOUCHDOWN += 12;
        item.evidence.push({ game_id: gameId, event: 'RETURN_TOUCHDOWN', points: 12, text });
      }
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
  return { ...item, comparisons, matches_visible_controls: Object.values(comparisons).every(value => value.control === value.ledger) };
});
const output = { season: 2025, summary: { units: rows.length, visible_control_matches: rows.filter(row => row.matches_visible_controls).length, unresolved_units: rows.filter(row => row.unresolved.length).length }, rows };
await writeFile('/tmp/espn_core_2025_kst_ledger.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/espn_core_2025_kst_ledger.json', summary: output.summary }, null, 2));
