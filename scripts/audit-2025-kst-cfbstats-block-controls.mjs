import { readFile, writeFile } from 'node:fs/promises';

const normal = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function sourceFetch(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { 'User-Agent': '36Football historical audit (public statistical verification)', Accept: 'text/html,application/xhtml+xml' } });
    if (response.ok || response.status !== 403 || attempt === 2) return response;
    await delay(2_000 * (attempt + 1));
  }
  throw new Error(`Unexpected cfbstats fetch state for ${url}`);
}
const aliases = new Map([
  ['App State', 'Appalachian State'], ['Hawai\'i', 'Hawaii'], ['UConn', 'Connecticut'], ['USF', 'South Florida'], ['UMass', 'Massachusetts'], ['Miami', 'Miami (FL)'], ['Ole Miss', 'Mississippi'], ['UNLV', 'Nevada-Las Vegas'], ['SMU', 'Southern Methodist'], ['TCU', 'Texas Christian'], ['UTSA', 'Texas-San Antonio'], ['UAB', 'Alabama-Birmingham'], ['UCF', 'Central Florida'], ['USC', 'Southern California'], ['UCLA', 'UCLA'],
]);
const source = await sourceFetch('https://cfbstats.com/2025/team/index.html');
if (!source.ok) throw new Error(`cfbstats team index failed (${source.status})`);
const indexHtml = await source.text();
const strip = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const teamIndex = new Map();
for (const match of indexHtml.matchAll(/href="\/2025\/team\/(\d+)\/index\.html"[^>]*>([^<]+)<\/a>/gi)) teamIndex.set(normal(strip(match[2])), { id: match[1], name: strip(match[2]) });
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8'));
const localLedger = JSON.parse(await readFile('/tmp/espn_core_2025_kst_full_ledger.json', 'utf8'));
const ledgerBySchool = new Map(localLedger.rows.map(row => [row.school_name, row]));
const findTeam = school => {
  const desired = aliases.get(school) ?? school;
  return teamIndex.get(normal(desired)) ?? [...teamIndex.entries()].find(([name]) => name === normal(school) || name.startsWith(`${normal(school)} `))?.[1] ?? null;
};
const parseRows = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => strip(cell[1]))).filter(row => /^\d{2}\/\d{2}\/25$/.test(row[0] ?? ''));
const rows = [];
for (const team of teams) {
  const school = team.school;
  const lookup = findTeam(school);
  if (!lookup) { rows.push({ school_name: school, source_found: false }); continue; }
  await delay(700);
  const response = await sourceFetch(`https://cfbstats.com/2025/team/${lookup.id}/miscdefense/gamelog.html`);
  if (!response.ok) { rows.push({ school_name: school, source_found: false, source_error: response.status }); continue; }
  const gameRows = parseRows(await response.text()).slice(0, 12);
  const blockValues = gameRows.map(row => Number(row.at(-1) ?? 0));
  const ledger = ledgerBySchool.get(school);
  const coreBlocks = Number(ledger?.events?.BLOCK ?? 0);
  rows.push({ school_name: school, source_found: true, cfbstats_team: lookup.name, first_12_games: gameRows.length, cfbstats_blocks: blockValues.reduce((sum, value) => sum + value, 0), espn_core_blocks: coreBlocks, matches: gameRows.length === 12 && blockValues.reduce((sum, value) => sum + value, 0) === coreBlocks, game_rows: gameRows.map((row, index) => ({ date: row[0], opponent: row[1], blocked_kicks: blockValues[index] })) });
}
const output = { season: 2025, source: 'cfbstats 2025 Misc. Defense Game Log', summary: { units: rows.length, source_found: rows.filter(row => row.source_found).length, first12_controls: rows.filter(row => row.first_12_games === 12).length, block_matches: rows.filter(row => row.matches).length, block_mismatches: rows.filter(row => row.source_found && !row.matches).length }, rows };
await writeFile('/tmp/cfbstats_2025_kst_block_control_audit.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: '/tmp/cfbstats_2025_kst_block_control_audit.json', summary: output.summary }, null, 2));
