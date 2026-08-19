import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const teamIdFromRef = ref => String(ref ?? '').match(/\/teams\/(\d+)/)?.[1] ?? null;
const fieldGoalPoints = distance => distance <= 29 ? 3 : distance <= 39 ? 6 : distance <= 49 ? 9 : 12;
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
const ledger = new Map(schools.map(school => [school, { school_name: school, points: 0, events: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0, BLOCK: 0, SPECIAL_TEAMS_SAFETY: 0 }, event_points: { FIELD_GOAL: 0, EXTRA_POINT: 0, RETURN_TOUCHDOWN: 0, BLOCK: 0, SPECIAL_TEAMS_SAFETY: 0 }, unresolved: [], evidence: [] }]));
const seen = new Set();
const add = (school, event, points, evidence) => {
  const item = ledger.get(school);
  if (!item) return;
  item.points += points; item.events[event] += 1; item.event_points[event] += points; item.evidence.push(evidence);
};

for (const [gameId, game] of selectedGames) {
  const summary = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/espn_summaries/${gameId}.json`, 'utf8'));
  const competitors = summary?.header?.competitions?.[0]?.competitors ?? [];
  const teamById = new Map(competitors.map(competitor => [String(competitor.team?.id), competitor.homeAway === 'home' ? game.homeTeam : game.awayTeam]));
  const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${gameId}.json`, 'utf8'));
  for (const play of core.items ?? []) {
    const type = normal(play.type?.text);
    const text = String(play.text ?? '');
    const teamSchool = teamById.get(teamIdFromRef(play.team?.$ref));
    const eventKey = `${gameId}:${play.id ?? `${type}:${text}`}`;
    if (seen.has(eventKey) || /\bno play\b/i.test(text)) continue;
    seen.add(eventKey);
    const selectedTeam = teamSchool && selectedBySchool.get(teamSchool)?.has(gameId) ? teamSchool : null;
    const opponent = selectedTeam ? [game.homeTeam, game.awayTeam].find(team => normal(team) !== normal(selectedTeam)) : null;
    if (play.scoringPlay && selectedTeam && type === 'field goal good' && Number(play.scoreValue) === 3) {
      const match = text.match(/(?:field goal attempt from\s+)(\d+)\s+yards?|(?:\b)(\d+)\s+yd\s+(?:fg|field goal)/i);
      if (!match) ledger.get(selectedTeam).unresolved.push({ game_id: gameId, reason: 'ESPN core made field goal lacks a distance', text });
      else add(selectedTeam, 'FIELD_GOAL', fieldGoalPoints(Number(match[1] ?? match[2])), { game_id: gameId, event: 'FIELD_GOAL', text });
    }
    if (play.scoringPlay && Number(play.scoreValue) === 2 && selectedTeam && type === 'safety' && /punt[^.]{0,90}blocked/i.test(text)) add(selectedTeam, 'SPECIAL_TEAMS_SAFETY', 6, { game_id: gameId, event: 'SPECIAL_TEAMS_SAFETY', text });
    if (!play.scoringPlay || Number(play.scoreValue) !== 6 || !selectedTeam) {
      if (selectedTeam && (type === 'blocked field goal' || type === 'blocked punt' || (type === 'punt' && /punt[^.]{0,90}blocked by/i.test(text)))) add(selectedTeam, 'BLOCK', 3, { game_id: gameId, event: 'BLOCK', text });
      continue;
    }
    const successfulPat = (/(?:\b|\()kick attempt good\b/i.test(text) || /\([^)]*\bkick\b[^)]*\)/i.test(text)) && !/(no good|missed|failed)/i.test(text);
    const regularReturn = /^(kickoff|kickoff return touchdown|punt|punt return|punt return touchdown)$/.test(type) && !/fumbled/i.test(text);
    const blockedReturn = /^(blocked punt|blocked punt touchdown|blocked field goal touchdown)$/.test(type);
    const patBlocked = /\bpat blocked\b|kick attempt failed\s*\(\s*blocked by/i.test(text);
    if (successfulPat) add(selectedTeam, 'EXTRA_POINT', 1, { game_id: gameId, event: 'EXTRA_POINT', text });
    if (regularReturn || blockedReturn) add(selectedTeam, 'RETURN_TOUCHDOWN', 12, { game_id: gameId, event: 'RETURN_TOUCHDOWN', text });
    if (type === 'blocked field goal' || type === 'blocked punt' || blockedReturn || (type === 'punt' && /punt[^.]{0,90}blocked by/i.test(text))) add(selectedTeam, 'BLOCK', 3, { game_id: gameId, event: 'BLOCK', text });
    if (patBlocked) {
      if (opponent && selectedBySchool.get(opponent)?.has(gameId)) add(opponent, 'BLOCK', 3, { game_id: gameId, event: 'BLOCK', text });
    }
  }
}

const rows = schools.map(school => {
  const item = ledger.get(school);
  const control = controlBySchool.get(school) ?? {};
  const regularReturns = item.evidence.filter(event => event.event === 'RETURN_TOUCHDOWN' && !/return of blocked/i.test(event.text) && !/punt blocked/i.test(event.text) && !/fg blocked/i.test(event.text)).length;
  const comparisons = {
    field_goals_made: { control: Number(control.field_goals_made ?? 0), ledger: item.events.FIELD_GOAL },
    extra_points: { control: Number(control.extra_points ?? 0), ledger: item.events.EXTRA_POINT },
    return_touchdowns: { control: Number(control.kick_return_touchdowns ?? 0) + Number(control.punt_return_touchdowns ?? 0), ledger: regularReturns },
  };
  const matchesVisibleControls = Object.values(comparisons).every(value => value.control === value.ledger);
  const requiresUnreconciledComponentControl = Number(item.events.BLOCK ?? 0) > 0 || Number(item.events.SPECIAL_TEAMS_SAFETY ?? 0) > 0;
  return { ...item, comparisons, matches_visible_controls: matchesVisibleControls, requires_unreconciled_component_control: requiresUnreconciledComponentControl, certifiable: matchesVisibleControls && !requiresUnreconciledComponentControl && !item.unresolved.length };
});
const output = { season: 2025, summary: { units: rows.length, visible_control_matches: rows.filter(row => row.matches_visible_controls).length, certifiable_units: rows.filter(row => row.certifiable).length, unresolved_units: rows.filter(row => row.unresolved.length).length }, rows };
await writeFile('/tmp/espn_core_2025_kst_full_ledger.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/espn_core_2025_kst_full_ledger.json', summary: output.summary }, null, 2));
