import { readFile, writeFile } from 'node:fs/promises';

const season = 2025;
const cfbdCache = '/tmp/big36_2025_cfbd_cache';
const espnCache = '/tmp/espn_core_2025_scoring_plays';
const positions = ['QB', 'RB', 'WR', 'TE', 'K_ST', 'DEF'];
const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile(`${cfbdCache}/regular_games.json`, 'utf8'));
const nonQbControls = JSON.parse(await readFile('/tmp/non_qb_2025_boxscore_certification.json', 'utf8')).rows;
const qbControls = JSON.parse(await readFile('/tmp/qb_2025_espn_boxscore_certification.json', 'utf8')).rows;

const eligibleBySchool = new Map();
for (const team of teams) {
  const selected = games
    .filter((game) => game.seasonType === 'regular' && (normalize(game.homeTeam) === normalize(team.school) || normalize(game.awayTeam) === normalize(team.school)))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate) || Number(a.id) - Number(b.id))
    .slice(0, 12);
  eligibleBySchool.set(normalize(team.school), new Set(selected.map((game) => Number(game.id))));
}

const rosterBySchool = new Map();
for (const team of teams) {
  const cacheKey = String(team.school ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9]+/g, '_');
  const cacheName = `roster_${cacheKey}.json`;
  const roster = JSON.parse(await readFile(`${cfbdCache}/${cacheName}`, 'utf8'));
  rosterBySchool.set(normalize(team.school), roster.map((player) => ({
    position: ({ QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', K: 'K_ST', P: 'K_ST' }[String(player.position ?? '').toUpperCase()] ?? null),
    full: normalize(`${player.firstName ?? ''} ${player.lastName ?? ''}`),
    short: normalize(`${String(player.firstName ?? '').slice(0, 1)} ${player.lastName ?? ''}`),
  })));
}

function playerPosition(text, school) {
  const normalized = ` ${normalize(text)} `;
  const roster = rosterBySchool.get(normalize(school)) ?? [];
  const matched = roster.find((player) => player.position && ((player.full.length >= 5 && normalized.includes(` ${player.full} `)) || (player.short.length >= 3 && normalized.includes(` ${player.short} `))));
  return matched?.position ?? null;
}

function extractOwnership(text, school) {
  const clean = String(text ?? '');
  const passFrom = clean.match(/^(.+?)\s+\d+\s+Yd\s+pass\s+from\s+(.+?)(?:\s*\(|$)/i);
  if (passFrom) return { scorer: playerPosition(passFrom[1], school), passer: playerPosition(passFrom[2], school), kind: 'pass' };
  const passTo = clean.match(/^(.+?)\s+pass(?:\s+complete)?\s+to\s+(.+?)\s+for\s+\d+\s+yds?,\s*for\s+a\s+td/i);
  if (passTo) return { scorer: playerPosition(passTo[2], school), passer: playerPosition(passTo[1], school), kind: 'pass' };
  const rush = clean.match(/^(.+?)(?:\s+\d+\s+Yd)?\s+(?:Run|Rush)(?:\s+for\s+\d+\s+yds?)?/i);
  if (rush) return { scorer: playerPosition(rush[1], school), passer: null, kind: 'rush' };
  return { scorer: null, passer: null, kind: 'other' };
}

const ledger = new Map();
const unclassifiedEvents = [];
const entry = (school, position) => {
  const key = `${normalize(school)}::${position}`;
  if (!ledger.has(key)) ledger.set(key, { school_name: school, position, touchdowns: 0, passing_touchdowns: 0, rushing_touchdowns: 0, extra_points: 0, field_goals_made: 0, kick_return_touchdowns: 0, punt_return_touchdowns: 0, tier_events_missing_distance: 0, tier_points: 0, events: [] });
  return ledger.get(key);
};
const addTouchdown = (school, position, kind, play, gameId) => {
  if (!position || !positions.includes(position)) return;
  const row = entry(school, position);
  const start = Number(play.start?.yardsToEndzone);
  const distance = Number.isFinite(start) && start > 0 ? start : Number(play.statYardage) > 0 ? Number(play.statYardage) : null;
  row.touchdowns += 1;
  if (kind === 'pass' && position === 'QB') row.passing_touchdowns += 1;
  if (kind === 'rush') row.rushing_touchdowns += 1;
  if (distance === null) row.tier_events_missing_distance += 1;
  else row.tier_points += distance <= 9 ? 6 : distance <= 29 ? 8 : distance <= 59 ? 10 : 12;
  row.events.push({ game_id: gameId, id: play.id, type: play.type?.text ?? null, text: play.text ?? null, distance });
};

for (const game of games) {
  const homeFbs = eligibleBySchool.get(normalize(game.homeTeam))?.has(Number(game.id));
  const awayFbs = eligibleBySchool.get(normalize(game.awayTeam))?.has(Number(game.id));
  if (!homeFbs && !awayFbs) continue;
  const payload = JSON.parse(await readFile(`${espnCache}/${game.id}.json`, 'utf8'));
  for (const play of payload.items ?? []) {
    if (!play.scoringPlay || play.isPenalty || play.scoringType?.name !== 'touchdown') continue;
    const candidates = [game.homeTeam, game.awayTeam].map((candidate) => ({ school: candidate, ownership: extractOwnership(play.text, candidate) }));
    const match = candidates.find((candidate) => candidate.ownership.scorer || candidate.ownership.passer);
    const school = match?.school;
    if (!school || !eligibleBySchool.get(normalize(school))?.has(Number(game.id))) {
      unclassifiedEvents.push({
        game_id: Number(game.id),
        home_team: game.homeTeam,
        away_team: game.awayTeam,
        id: play.id,
        type: play.type?.text ?? null,
        text: play.text ?? null,
        candidates,
      });
      continue;
    }
    const ownership = extractOwnership(play.text, school);
    if (ownership.kind === 'pass') {
      addTouchdown(school, ownership.passer, 'pass', play, Number(game.id));
      addTouchdown(school, ownership.scorer, 'receive', play, Number(game.id));
    } else if (ownership.kind === 'rush') addTouchdown(school, ownership.scorer, 'rush', play, Number(game.id));
  }
}

const control = new Map();
for (const row of nonQbControls) control.set(`${normalize(row.school_name)}::${row.position}`, row.control);
for (const row of qbControls) control.set(`${normalize(row.school_name)}::QB`, { touchdowns: row.official_boxscore.passing_touchdowns + row.official_boxscore.rushing_touchdowns, passing_touchdowns: row.official_boxscore.passing_touchdowns, rushing_touchdowns: row.official_boxscore.rushing_touchdowns });

const rows = [...ledger.values()].map((row) => {
  const expected = control.get(`${normalize(row.school_name)}::${row.position}`) ?? {};
  return {
    ...row,
    control_touchdowns: expected.touchdowns ?? null,
    control_passing_touchdowns: expected.passing_touchdowns ?? null,
    control_rushing_touchdowns: expected.rushing_touchdowns ?? null,
    matches_control: expected.touchdowns === row.touchdowns,
  };
});
const summary = Object.fromEntries(['QB', 'RB', 'WR', 'TE'].map((position) => {
  const group = rows.filter((row) => row.position === position);
  return [position, { rows: group.length, control_matches: group.filter((row) => row.matches_control).length, unmatched: group.filter((row) => !row.matches_control).length, tier_events_missing_distance: group.reduce((sum, row) => sum + row.tier_events_missing_distance, 0) }];
}));
await writeFile('/tmp/espn_core_all_unit_td_ledger.json', JSON.stringify({ season, summary, rows, unclassified_events: unclassifiedEvents }, null, 2));
console.log(JSON.stringify({ output: '/tmp/espn_core_all_unit_td_ledger.json', summary }, null, 2));
