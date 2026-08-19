import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const teamIdFromRef = ref => String(ref ?? '').match(/\/teams\/(\d+)/)?.[1] ?? null;
const defensiveTouchdownPoints = distance => distance <= 19 ? 9 : distance <= 59 ? 12 : 15;
const returnDistance = text => {
  const clean = String(text ?? '');
  return clean.match(/return(?:ed)?\s+(?:for\s+)?(\d+)\s+(?:yd(?:s)?|yards?)/i)?.[1]
    ?? clean.match(/(\d+)\s+(?:yd(?:s)?|yards?)\s+return/i)?.[1]
    ?? null;
};
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
const controlBySchool = new Map(controls.filter(row => row.position === 'DEF').map(row => [row.school_name, row.control]));
const ledger = new Map(schools.map(school => [school, { school_name: school, points: 0, events: { SACK: 0, INTERCEPTION: 0, FUMBLE_RECOVERY: 0, DEFENSIVE_TOUCHDOWN: 0, DEFENSIVE_SAFETY: 0, SHUTOUT: 0 }, event_points: { SACK: 0, INTERCEPTION: 0, FUMBLE_RECOVERY: 0, DEFENSIVE_TOUCHDOWN: 0, DEFENSIVE_SAFETY: 0, SHUTOUT: 0 }, unresolved: [], evidence: [] }]));
const add = (school, event, points, evidence) => {
  const item = ledger.get(school);
  if (!item) return;
  item.points += points; item.events[event] += 1; item.event_points[event] += points; item.evidence.push(evidence);
};
const verifiedSupplementalEvents = [
  {
    school: 'Eastern Michigan',
    gameId: 401761594,
    event: 'SACK',
    points: 1,
    text: 'Brad Jackson sacked by Messiah Blair for a loss of 9 yards to the Texas State 41; fumble on the play.',
    source: 'Official Eastern Michigan–Texas State game book: https://dxbhsrqyrr690.cloudfront.net/sidearm.nextgen.sites/emueagles.com/stats/football/2025/pdf/20250830104119-41229.pdf',
  },
];
const roleSchool = (play, role, teamById) => {
  const participant = (play.teamParticipants ?? []).find(item => item.type === role);
  return teamById.get(String(participant?.id ?? teamIdFromRef(participant?.team?.$ref))) ?? null;
};
for (const school of schools) {
  for (const game of games.filter(game => selectedBySchool.get(school)?.has(Number(game.id)))) {
    const opponentPoints = normal(game.homeTeam) === normal(school) ? Number(game.awayPoints) : Number(game.homePoints);
    if (opponentPoints === 0) add(school, 'SHUTOUT', 15, { game_id: Number(game.id), event: 'SHUTOUT', text: 'Official completed-game opponent score: 0' });
  }
}
for (const [gameId, game] of selectedGames) {
  const summary = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/espn_summaries/${gameId}.json`, 'utf8'));
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
  const teamById = new Map(competitors.map(competitor => [String(competitor.team?.id), competitor.homeAway === 'home' ? game.homeTeam : game.awayTeam]));
  const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${gameId}.json`, 'utf8'));
  for (const play of core.items ?? []) {
    const offense = roleSchool(play, 'offense', teamById);
    const defense = roleSchool(play, 'defense', teamById);
    if (!offense || !defense) continue;
    const defendingSchoolSelected = selectedBySchool.get(defense)?.has(gameId) ?? false;
    if (!defendingSchoolSelected) continue;
    if (!selectedBySchool.get(defense)?.has(gameId)) continue;
    const type = normal(play.type?.text);
    const text = String(play.text ?? '');
    if (/\bno play\b/i.test(text)) continue;
    if (type === 'sack' && defendingSchoolSelected) add(defense, 'SACK', 1, { game_id: gameId, event: 'SACK', text });
    const interception = type === 'interception' || type === 'interception return touchdown' || type === 'pass interception return';
    const fumbleRecovery = type.startsWith('fumble recovery') || type === 'fumble return touchdown';
    if (interception) add(defense, 'INTERCEPTION', 3, { game_id: gameId, event: 'INTERCEPTION', text });
    if (fumbleRecovery && play.isTurnover) add(defense, 'FUMBLE_RECOVERY', 3, { game_id: gameId, event: 'FUMBLE_RECOVERY', text });
    if (play.scoringPlay && Number(play.scoreValue) === 6 && (interception || (fumbleRecovery && play.isTurnover))) {
      const distance = returnDistance(text);
      if (distance === null) ledger.get(defense).unresolved.push({ game_id: gameId, reason: 'Defensive touchdown has no explicit return distance in ESPN core text', text });
      else add(defense, 'DEFENSIVE_TOUCHDOWN', defensiveTouchdownPoints(Number(distance)), { game_id: gameId, event: 'DEFENSIVE_TOUCHDOWN', text });
    }
    if (play.scoringPlay && Number(play.scoreValue) === 2 && type === 'safety' && !/punt[^.]{0,90}blocked/i.test(text)) add(defense, 'DEFENSIVE_SAFETY', 6, { game_id: gameId, event: 'DEFENSIVE_SAFETY', text });
  }
}
for (const event of verifiedSupplementalEvents) {
  if (!selectedBySchool.get(event.school)?.has(event.gameId)) continue;
  add(event.school, event.event, event.points, { game_id: event.gameId, event: event.event, text: event.text, source: event.source, evidence_class: 'official_game_book_supplement' });
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
await writeFile('/tmp/espn_core_2025_def_ledger.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/espn_core_2025_def_ledger.json', summary: output.summary }, null, 2));
