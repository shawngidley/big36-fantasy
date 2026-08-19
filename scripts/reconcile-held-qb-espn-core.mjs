import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const reportPath = '/tmp/qb_2025_espn_boxscore_certification.json';
const cacheDir = '/tmp/espn_core_2025_scoring_plays';
const outputPath = '/tmp/qb_2025_espn_core_holdout_reconciliation.json';

const report = JSON.parse(await readFile(reportPath, 'utf8'));
await mkdir(cacheDir, { recursive: true });

async function loadGamePlays(gameId) {
  const cachePath = path.join(cacheDir, `${gameId}.json`);
  try {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  } catch {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${gameId}/competitions/${gameId}/plays?limit=1000`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`${gameId}: ${response.status} ${response.statusText}`);
    const payload = await response.json();
    await writeFile(cachePath, JSON.stringify(payload));
    return payload;
  }
}

const held = report.rows.flatMap((row) =>
  row.events
    .filter((event) => event.cfbd_play_matched === false)
    .map((event) => ({ school_name: row.school_name, ...event })),
);

const games = new Map();
for (const event of held) {
  if (!games.has(event.game_id)) games.set(event.game_id, await loadGamePlays(event.game_id));
}

const reconciled = held.map((event) => {
  const payload = games.get(event.game_id);
  const play = (payload.items ?? payload.plays ?? []).find((candidate) => String(candidate.id) === String(event.source_event_id));
  const startYardsToGoal = Number(play?.start?.yardsToEndzone);
  const statYardage = Number(play?.statYardage);
  const usableStartYardsToGoal = Number.isFinite(startYardsToGoal) && startYardsToGoal > 0 ? startYardsToGoal : null;
  const usableStatYardage = Number.isFinite(statYardage) && statYardage > 0 ? statYardage : null;
  const tierDistance = usableStartYardsToGoal ?? usableStatYardage;
  return {
    ...event,
    espn_play_found: Boolean(play),
    espn_type: play?.type?.text ?? null,
    espn_scoring_play: play?.scoringPlay ?? null,
    espn_penalty: play?.isPenalty ?? null,
    espn_start_yards_to_goal: usableStartYardsToGoal,
    espn_stat_yardage: usableStatYardage,
    tier_distance_candidate: tierDistance,
    tier_evidence: usableStartYardsToGoal ? 'espn_start_yards_to_goal' : usableStatYardage ? 'espn_stat_yardage' : 'unresolved',
  };
});

const summary = {
  held_events: reconciled.length,
  play_found: reconciled.filter((event) => event.espn_play_found).length,
  resolved_tier_distance: reconciled.filter((event) => event.tier_distance_candidate !== null).length,
  unresolved: reconciled.filter((event) => event.tier_distance_candidate === null).length,
};

await writeFile(outputPath, JSON.stringify({ generated_at: new Date().toISOString(), summary, events: reconciled }, null, 2));
console.log(JSON.stringify({ outputPath, summary }, null, 2));
