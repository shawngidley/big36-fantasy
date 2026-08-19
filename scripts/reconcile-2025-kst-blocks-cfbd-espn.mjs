import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const ledger = JSON.parse(await readFile('/tmp/espn_core_2025_kst_full_ledger.json', 'utf8'));
const schools = teams.map(team => team.school);
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
const schoolForTeam = value => schools.find(school => normal(value) === normal(school) || normal(value).startsWith(`${normal(school)} `));
const cfbdEventsByGame = new Map();
for (let week = 1; week <= 16; week += 1) {
  const plays = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, 'utf8'));
  for (const play of plays) {
    const gameId = Number(play.gameId);
    const text = String(play.playText ?? '');
    if (!eligibleGameIds.has(gameId) || !/(punt|field goal|pat|kick attempt).{0,100}block|block.{0,100}(punt|field goal|pat|kick attempt)/i.test(text) || /no play/i.test(text)) continue;
    const school = schoolForTeam(play.defense);
    if (!school || !selectedBySchool.get(school)?.has(gameId)) continue;
    const entries = cfbdEventsByGame.get(gameId) ?? [];
    entries.push({ school_name: school, play_id: String(play.id), text, type: play.playType ?? null });
    cfbdEventsByGame.set(gameId, entries);
  }
}
const rows = [];
for (const school of schools) {
  const espnBlocks = (ledger.rows.find(row => row.school_name === school)?.evidence ?? []).filter(event => event.event === 'BLOCK');
  const matches = espnBlocks.map(event => {
    const candidates = (cfbdEventsByGame.get(Number(event.game_id)) ?? []).filter(candidate => candidate.school_name === school);
    const matched = candidates.some(candidate => {
      const lower = normal(candidate.text);
      const eventText = normal(event.text);
      const numbers = [...eventText.matchAll(/\b\d{2,3}\b/g)].map(match => match[0]);
      return numbers.some(number => lower.includes(number)) || (eventText.includes('punt blocked') && lower.includes('punt blocked')) || (eventText.includes('field goal') && lower.includes('field goal'));
    });
    return { ...event, cfbd_candidates: candidates, matched };
  });
  const mismatched = matches.filter(event => !event.matched);
  rows.push({ school_name: school, espn_block_count: espnBlocks.length, matched_block_count: matches.length - mismatched.length, unmatched: mismatched, matches });
}
const output = { season: 2025, summary: { units_with_blocks: rows.filter(row => row.espn_block_count).length, espn_blocks: rows.reduce((sum, row) => sum + row.espn_block_count, 0), matched_blocks: rows.reduce((sum, row) => sum + row.matched_block_count, 0), units_with_unmatched_blocks: rows.filter(row => row.unmatched.length).length }, rows };
await writeFile('/tmp/cfbd_espn_2025_kst_block_reconciliation.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/cfbd_espn_2025_kst_block_reconciliation.json', summary: output.summary }, null, 2));
