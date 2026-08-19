import { readFile } from 'node:fs/promises';

const gameId = process.argv[2] ?? '401752736';
const core = JSON.parse(await readFile(`/tmp/espn_core_2025_scoring_plays/${gameId}.json`, 'utf8'));
const summary = JSON.parse(await readFile(`/tmp/big36_2025_cfbd_cache/espn_summaries/${gameId}.json`, 'utf8'));
const competitors = summary?.header?.competitions?.[0]?.competitors?.map(competitor => ({ id: String(competitor.team?.id), name: competitor.team?.displayName, home_away: competitor.homeAway })) ?? [];
const returns = (core.items ?? []).filter(play => play.scoringPlay && Number(play.scoreValue) === 6 && /return/i.test(`${play.type?.text ?? ''} ${play.text ?? ''}`)).map(play => ({ type: play.type?.text, team_ref: play.team?.$ref, text: play.text }));
console.log(JSON.stringify({ game_id: Number(gameId), competitors, returns }, null, 2));
