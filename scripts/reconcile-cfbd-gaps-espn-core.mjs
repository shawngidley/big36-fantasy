import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = JSON.parse(await readFile('/tmp/historical_scoring_evidence_gaps.json', 'utf8'));
const cacheDir = '/tmp/espn_core_2025_scoring_plays';
await mkdir(cacheDir, { recursive: true });

async function gamePlays(gameId) {
  const cachePath = path.join(cacheDir, `${gameId}.json`);
  try { return JSON.parse(await readFile(cachePath, 'utf8')); }
  catch {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${gameId}/competitions/${gameId}/plays?limit=1000`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${gameId}: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    await writeFile(cachePath, JSON.stringify(payload));
    return payload;
  }
}

const byGame = new Map();
for (const gap of input.gaps) if (!byGame.has(gap.game_id)) byGame.set(gap.game_id, await gamePlays(gap.game_id));

const rows = input.gaps.map((gap) => {
  const plays = byGame.get(gap.game_id).items ?? [];
  const play = plays.find((candidate) => String(candidate.id) === String(gap.play_id));
  const startYardsToGoal = Number(play?.start?.yardsToEndzone);
  const statYardage = Number(play?.statYardage);
  const candidateDistance = Number.isFinite(startYardsToGoal) && startYardsToGoal > 0
    ? startYardsToGoal
    : Number.isFinite(statYardage) && statYardage > 0
      ? statYardage
      : null;
  return {
    ...gap,
    espn_play_found: Boolean(play),
    espn_type: play?.type?.text ?? null,
    espn_text: play?.text ?? null,
    espn_start_yards_to_goal: Number.isFinite(startYardsToGoal) ? startYardsToGoal : null,
    espn_stat_yardage: Number.isFinite(statYardage) ? statYardage : null,
    certified_distance_candidate: candidateDistance,
    evidence: candidateDistance === startYardsToGoal ? 'espn_start_yards_to_goal' : candidateDistance === statYardage ? 'espn_stat_yardage' : 'unresolved',
  };
});

const summary = {
  gaps: rows.length,
  found: rows.filter((row) => row.espn_play_found).length,
  resolved: rows.filter((row) => row.certified_distance_candidate !== null).length,
  unresolved: rows.filter((row) => row.certified_distance_candidate === null).length,
};
await writeFile('/tmp/historical_scoring_evidence_gap_reconciliation.json', JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ output: '/tmp/historical_scoring_evidence_gap_reconciliation.json', summary }, null, 2));
