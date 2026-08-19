import { mkdir, readFile, writeFile } from 'node:fs/promises';

const year = '2025';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const normal = value => String(value ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const ncaaName = value => normal(value)
  .replace(/\bfla\b/g, 'florida')
  .replace(/\bst\b/g, 'state')
  .replace(/\bmiss\b/g, 'mississippi')
  .replace(/\bsouthern mississippi\b/g, 'southern mississippi')
  .replace(/\bsouth florida\b/g, 'south florida')
  .replace(/\bnorthwestern state\b/g, 'northwestern state');
const sourceAliases = new Map([
  ['army west point', 'Army'], ['fla atlantic', 'Florida Atlantic'], ['fresno state', 'Fresno State'], ['hawaii', "Hawai'i"], ['louisiana monroe', 'ULM'], ['missouri state', 'Missouri State'], ['sam houston', 'Sam Houston State'], ['southern mississippi', 'Southern Miss'], ['south florida', 'USF'], ['texas el paso', 'UTEP'], ['texas san antonio', 'UTSA'], ['western kentucky', 'Western Kentucky'], ['western michigan', 'Western Michigan'],
]);
const periods = new Map([
  ['2025-08-23', '2.0'], ['2025-08-28', '3.0'], ['2025-08-29', '4.0'], ['2025-08-30', '5.0'], ['2025-08-31', '6.0'], ['2025-09-01', '7.0'], ['2025-09-05', '8.0'], ['2025-09-06', '9.0'], ['2025-09-11', '10.0'], ['2025-09-12', '11.0'], ['2025-09-13', '12.0'], ['2025-09-18', '13.0'], ['2025-09-19', '14.0'], ['2025-09-20', '15.0'], ['2025-09-25', '16.0'], ['2025-09-26', '18.0'], ['2025-09-27', '19.0'], ['2025-10-02', '20.0'], ['2025-10-03', '21.0'], ['2025-10-04', '22.0'], ['2025-10-08', '23.0'], ['2025-10-09', '24.0'], ['2025-10-10', '25.0'], ['2025-10-11', '26.0'], ['2025-10-15', '28.0'], ['2025-10-16', '29.0'], ['2025-10-17', '30.0'], ['2025-10-18', '31.0'], ['2025-10-21', '32.0'], ['2025-10-22', '33.0'], ['2025-10-23', '34.0'], ['2025-10-24', '35.0'], ['2025-10-25', '36.0'], ['2025-10-28', '37.0'], ['2025-10-29', '38.0'], ['2025-10-30', '39.0'], ['2025-10-31', '40.0'], ['2025-11-01', '41.0'], ['2025-11-04', '42.0'], ['2025-11-05', '43.0'], ['2025-11-06', '44.0'], ['2025-11-07', '45.0'], ['2025-11-08', '46.0'], ['2025-11-11', '47.0'], ['2025-11-12', '48.0'], ['2025-11-13', '49.0'], ['2025-11-14', '50.0'], ['2025-11-15', '51.0'], ['2025-11-18', '52.0'], ['2025-11-19', '53.0'], ['2025-11-20', '54.0'], ['2025-11-21', '55.0'], ['2025-11-22', '56.0'], ['2025-11-25', '57.0'], ['2025-11-27', '58.0'], ['2025-11-28', '59.0'], ['2025-11-29', '60.0'],
]);
const stats = { blocks: '785.0', defensiveTouchdowns: '926.0', fumbleRecoveries: '456.0', interceptions: '457.0', sacks: '466.0' };
const strip = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const teamRecords = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const teams = teamRecords.map(row => row.school);
const alternateNameToSchool = new Map();
for (const team of teamRecords) {
  for (const name of [team.school, ...(team.alternateNames ?? [])]) alternateNameToSchool.set(ncaaName(name), team.school);
}
const games = JSON.parse(await readFile('/tmp/big36_2025_cfbd_cache/regular_games.json', 'utf8'));
const kst = JSON.parse(await readFile('/tmp/espn_core_2025_kst_full_ledger.json', 'utf8'));
const def = JSON.parse(await readFile('/tmp/cfbfastr_2025_def_ledger.json', 'utf8'));
const kstBySchool = new Map(kst.rows.map(row => [row.school_name, row]));
const defBySchool = new Map(def.rows.map(row => [row.school_name, row]));
const resolveSchool = teamName => {
  const target = ncaaName(String(teamName).replace(/\s*\([^)]*\)/g, '').trim());
  const direct = sourceAliases.get(target) ?? alternateNameToSchool.get(target);
  if (direct) return direct;
  const candidates = teams.filter(school => target.startsWith(`${ncaaName(school)} `) || ncaaName(school).startsWith(`${target} `));
  return candidates.sort((a, b) => ncaaName(b).length - ncaaName(a).length)[0] ?? null;
};
const schoolTwelfthDates = new Map();
for (const school of teams) {
  const selected = games.filter(game => game.seasonType === 'regular' && [game.homeTeam, game.awayTeam].map(normal).includes(normal(school))).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).filter(game => game.completed).slice(0, 12);
  schoolTwelfthDates.set(school, selected.length === 12 ? String(selected.at(-1).startDate).slice(0, 10) : null);
}
const cache = new Map();
async function fetchSnapshot(period, statSeq) {
  const key = `${period}:${statSeq}`;
  if (cache.has(key)) return cache.get(key);
  const cachePath = `/tmp/ncaa_2025_snapshot_cache/${period}_${statSeq}.json`;
  try {
    const stored = JSON.parse(await readFile(cachePath, 'utf8'));
    const values = new Map(stored);
    cache.set(key, values);
    return values;
  } catch {}
  await mkdir('/tmp/ncaa_2025_snapshot_cache', { recursive: true });
  await sleep(1_000);
  const url = `https://stats.ncaa.org/rankings/national_ranking?academic_year=2026.0&division=11.0&ranking_period=${period}&sport_code=MFB&stat_seq=${statSeq}`;
  let response;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    response = await fetch(url, { headers: { 'User-Agent': '36 Football historical audit (public NCAA statistics verification)', Accept: 'text/html' } });
    if (response.ok) break;
    await sleep(5_000 * (attempt + 1));
  }
  if (!response?.ok) throw new Error(`NCAA snapshot failed for ${key}: ${response?.status}`);
  const html = await response.text();
  const values = new Map();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => strip(match[1]));
    if (cells.length < 5 || !/^\d+$/.test(cells[2] ?? '')) continue;
    const school = resolveSchool(cells[1]);
    const value = Number(String(cells[4]).replace(/,/g, ''));
    if (school && Number.isFinite(value)) {
      values.set(school, { games: Number(cells[2]), value, listed_name: cells[1] });
    }
  }
  cache.set(key, values);
  await writeFile(cachePath, JSON.stringify([...values.entries()]));
  return values;
}
const rows = [];
for (const school of teams) {
  const date = schoolTwelfthDates.get(school);
  const period = date ? periods.get(date) : null;
  if (!period) { rows.push({ school_name: school, twelfth_game_date: date, usable: false, reason: 'no dated NCAA snapshot mapping' }); continue; }
  const official = {};
  for (const [name, statSeq] of Object.entries(stats)) {
    const snapshot = await fetchSnapshot(period, statSeq);
    const entry = snapshot.get(school);
    official[name] = entry && entry.games === 12 ? entry.value : 0;
  }
  const kstRow = kstBySchool.get(school);
  const defRow = defBySchool.get(school);
  const comparison = {
    blocks: { ncaa: official.blocks, ledger: Number(kstRow?.events?.BLOCK ?? 0) },
    sacks: { ncaa: official.sacks, ledger: Number(defRow?.events?.SACK ?? 0) },
    interceptions: { ncaa: official.interceptions, ledger: Number(defRow?.events?.INTERCEPTION ?? 0) },
    fumbleRecoveries: { ncaa: official.fumbleRecoveries, ledger: Number(defRow?.events?.FUMBLE_RECOVERY ?? 0) },
    defensiveTouchdowns: { ncaa: official.defensiveTouchdowns, ledger: Number(defRow?.events?.DEFENSIVE_TOUCHDOWN ?? 0) },
  };
  rows.push({ school_name: school, twelfth_game_date: date, ncaa_ranking_period: period, usable: true, official, comparison, matches: Object.fromEntries(Object.entries(comparison).map(([name, item]) => [name, item.ncaa === item.ledger])) });
}
const output = { season: year, source: 'NCAA dated FBS team ranking snapshots', summary: { units: rows.length, usable: rows.filter(row => row.usable).length, block_matches: rows.filter(row => row.matches?.blocks).length, sack_matches: rows.filter(row => row.matches?.sacks).length, interception_matches: rows.filter(row => row.matches?.interceptions).length, fumble_recovery_matches: rows.filter(row => row.matches?.fumbleRecoveries).length, defensive_touchdown_matches: rows.filter(row => row.matches?.defensiveTouchdowns).length }, rows };
await writeFile('/tmp/ncaa_2025_first12_component_control_audit.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/ncaa_2025_first12_component_control_audit.json', summary: output.summary, snapshots_fetched: cache.size }, null, 2));
