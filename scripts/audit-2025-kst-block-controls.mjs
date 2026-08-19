import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
const cfbdBlocks = new Map(schools.map(school => [school, []]));
for (let week = 1; week <= 16; week += 1) {
  const [plays, stats] = await Promise.all([
    readFile(`/tmp/big36_2025_cfbd_cache/plays_week_${week}.json`, 'utf8').then(JSON.parse),
    readFile(`/tmp/big36_2025_cfbd_cache/play_stats_week_${week}.json`, 'utf8').then(JSON.parse),
  ]);
  const playById = new Map(plays.map(play => [String(play.id), play]));
  for (const stat of stats) {
    const type = normal(stat.statType);
    if (type !== 'field goal block') continue;
    const gameId = Number(stat.gameId);
    const school = schoolForTeam(stat.team);
    if (!school || !eligibleGameIds.has(gameId) || !selectedBySchool.get(school)?.has(gameId)) continue;
    cfbdBlocks.get(school).push({ game_id: gameId, play_id: String(stat.playId), type: stat.statType, athlete: stat.athleteName, text: playById.get(String(stat.playId))?.playText ?? null });
  }
}
const ledgerBySchool = new Map(ledger.rows.map(row => [row.school_name, row]));
const rows = schools.map(school => {
  const core = ledgerBySchool.get(school);
  const coreEvidence = (core?.evidence ?? []).filter(event => event.event === 'BLOCK');
  const cfbd = cfbdBlocks.get(school);
  return { school_name: school, cfbd_field_goal_blocks: cfbd, espn_core_blocks: coreEvidence, comparison: { cfbd_field_goal_block_count: cfbd.length, espn_core_total_block_count: coreEvidence.length }, field_goal_blocks_matchable: cfbd.length <= coreEvidence.length };
});
const output = { season: 2025, summary: { units: rows.length, cfbd_field_goal_blocks: rows.reduce((sum, row) => sum + row.cfbd_field_goal_blocks.length, 0), espn_core_blocks: rows.reduce((sum, row) => sum + row.espn_core_blocks.length, 0), units_with_cfbd_blocks: rows.filter(row => row.cfbd_field_goal_blocks.length).length, units_without_matchable_core_blocks: rows.filter(row => !row.field_goal_blocks_matchable).length }, rows };
await writeFile('/tmp/cfbd_2025_kst_block_control_audit.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/cfbd_2025_kst_block_control_audit.json', summary: output.summary }, null, 2));
