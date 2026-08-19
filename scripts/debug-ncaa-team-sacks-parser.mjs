import { readFile } from 'node:fs/promises';

const normal = value => String(value ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[.’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const ncaaName = value => normal(value).replace(/\bfla\b/g, 'florida').replace(/\bst\b/g, 'state').replace(/\bmiss\b/g, 'mississippi');
const teams = JSON.parse(await readFile('/tmp/cfbd_2025_fbs_teams.json', 'utf8')).map(row => row.school);
const resolveSchool = teamName => {
  const target = ncaaName(String(teamName).replace(/\s*\([^)]*\)/g, '').trim());
  const exact = teams.find(school => ncaaName(school) === target);
  if (exact) return exact;
  const candidates = teams.filter(school => target.startsWith(`${ncaaName(school)} `) || ncaaName(school).startsWith(`${target} `));
  return candidates.sort((a, b) => ncaaName(b).length - ncaaName(a).length)[0] ?? null;
};
const html = await (await fetch('https://stats.ncaa.org/rankings/national_ranking?academic_year=2026.0&division=11.0&ranking_period=60.0&sport_code=MFB&stat_seq=466.0')).text();
const strip = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const rows = [];
for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => strip(match[1]));
  if (cells.some(cell => cell.includes('Texas'))) rows.push({ cells, resolved: resolveSchool(cells[1]), value: Number(cells[4]) });
}
console.log(JSON.stringify(rows, null, 2));
