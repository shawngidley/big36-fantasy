const CFBD_BASE_URL = "https://api.collegefootballdata.com";

function apiKey() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CollegeFootballData API key is not configured.");
  return key;
}

// A global pace gate on actual outbound calls (cache hits skip this entirely). Bulk operations like
// the season-wide audit make dozens of roster/box-score calls in a tight loop; CFBD's per-minute
// limit was hit well before those loops finished, turning into a hard 429 that aborted the whole
// operation. A small minimum gap between real requests keeps volume under the limit without any
// call site needing to know about pacing.
let nextSlotAt = 0;
async function paceOutboundCall() {
  const wait = Math.max(0, nextSlotAt - Date.now());
  nextSlotAt = Math.max(Date.now(), nextSlotAt) + 650;
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

export async function cfbdGet<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  await paceOutboundCall();
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  const url = `${CFBD_BASE_URL}${path}${params.size ? `?${params}` : ""}`;
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" } });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        // 502/503/504 usually mean CFBD's servers are briefly overloaded (common during peak Saturday
        // traffic with many simultaneous live games); 429 means we've been rate-limited and need to
        // back off longer before retrying. Other errors (auth, bad request) won't be fixed by
        // retrying, so fail immediately instead of wasting time.
        if ([502, 503, 504].includes(response.status) && attempt < maxAttempts) { await new Promise(resolve => setTimeout(resolve, 300 * attempt)); continue; }
        if (response.status === 429 && attempt < maxAttempts) { await new Promise(resolve => setTimeout(resolve, 2500 * attempt)); continue; }
        throw new Error(payload?.message ?? `CollegeFootballData ${path} failed (${response.status}).`);
      }
      return payload as T;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && error instanceof TypeError) { await new Promise(resolve => setTimeout(resolve, 300 * attempt)); continue; }
      throw error;
    }
  }
  throw lastError;
}

// Many owners can have the site open at once, each polling for live updates. Without this cache,
// every one of those page views would trigger its own independent call to CollegeFootballData,
// quickly exceeding rate limits. This ensures the API is only actually hit once per TTL window,
// regardless of how many concurrent requests come in — everyone shares the same cached result.
const responseCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
function cachedCfbdGet<T>(path: string, query: Record<string, string | number | undefined>, ttlMs: number): Promise<T> {
  const cacheKey = `${path}?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;
  const promise = cfbdGet<T>(path, query).catch(error => { responseCache.delete(cacheKey); throw error; });
  responseCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, promise });
  return promise as Promise<T>;
}

export type CfbdTeam = { id: number; school: string; conference?: string | null; classification?: string | null };
export type CfbdGame = { id: number; season: number; week: number; seasonType: string; startDate: string; completed: boolean; homeTeam: string; awayTeam: string; homeClassification?: string | null; awayClassification?: string | null; homePoints?: number | null; awayPoints?: number | null };
export type CfbdPlay = { id: number | string; gameId: number; driveId?: string | null; playNumber?: number | null; offense: string; defense: string; offenseScore?: number | null; defenseScore?: number | null; scoringTeam?: string | null; yardsToGoal?: number | null; yardsGained?: number | null; scoring: boolean; playType?: string | null; playText?: string | null; period?: number | null; clock?: { minutes?: number; seconds?: number } | null };
export type CfbdPlayStat = { playId: number | string; athleteId: number; athleteName?: string | null; team: string; statType: string; stat: number | string; yardsToGoal?: number | null };
// The actual live /live/plays shape: one game object, with plays nested under each drive — not a flat
// array like /plays. There's no explicit "scoring" flag on a play here; it must be inferred from the
// score changing between plays.
export type CfbdLiveGamePlay = { id: string; homeScore: number; awayScore: number; period: number; clock: string; wallClock?: string; teamId: number; team: string; down?: number | null; distance?: number | null; yardsToGoal?: number | null; yardsGained?: number | null; playType?: string | null; playText?: string | null };
export type CfbdLiveDrive = { id: string; offense: string; defense: string; plays: CfbdLiveGamePlay[] };
export type CfbdLiveGame = { id: number; status?: string | null; period?: number | null; clock?: string | null; teams: Array<{ team: string; homeAway: "home" | "away"; points: number }>; drives: CfbdLiveDrive[] };
export type CfbdRosterAthlete = { id: number | string; firstName?: string | null; lastName?: string | null; position: string | null; team?: string | null };
export type CfbdScoreboardGame = { id: number; status?: string | null; period?: number | null; clock?: string | null; homeTeam?: { name?: string | null; points?: number | string | null; lineScores?: Array<number | string> | null } | null; awayTeam?: { name?: string | null; points?: number | string | null; lineScores?: Array<number | string> | null } | null; week?: number | null; season?: number | null };

export const getFbsTeams = (year: number) => cachedCfbdGet<CfbdTeam[]>("/teams/fbs", { year }, 6 * 60 * 60_000);
export const getRegularSeasonGames = (year: number) => cachedCfbdGet<CfbdGame[]>("/games", { year, seasonType: "regular" }, 10 * 60_000);
export const getLiveScoreboard = () => cachedCfbdGet<CfbdScoreboardGame[]>("/scoreboard", { classification: "fbs" }, 15_000);
// Plays are heavier for CFBD to serve and don't need to be as instantaneous as the live score —
// a longer cache window here meaningfully cuts call volume during high-traffic Saturday windows.
// Derive which team actually scored on each play from the running score, per game, in feed order.
// "offense" on kickoffs/punts is the KICKING team, so any return touchdown credited to play.offense
// goes to the wrong side; scoringTeam is convention-free and is what the K/DST paths prefer.
export function annotateScoringTeams(plays: CfbdPlay[]): CfbdPlay[] {
  const previousByGame = new Map<number, Map<string, number>>();
  return plays.map(play => {
    if (play.offenseScore == null || play.defenseScore == null) return play;
    const previous = previousByGame.get(play.gameId) ?? new Map<string, number>();
    const current = new Map<string, number>([[play.offense, Number(play.offenseScore)], [play.defense, Number(play.defenseScore)]]);
    let scoringTeam: string | null = null;
    for (const [team, score] of Array.from(current.entries())) if (score > (previous.get(team) ?? 0)) scoringTeam = team;
    previousByGame.set(play.gameId, current);
    return { ...play, scoringTeam };
  });
}
export const getWeekPlays = async (year: number, week: number) => annotateScoringTeams(await cachedCfbdGet<CfbdPlay[]>("/plays", { year, week, seasonType: "regular" }, 45_000));
// The actual live, in-progress play feed — /plays only populates after a game finishes, per CFBD support.
// Returns one game object with plays nested under drives, not a flat array.
export const getLivePlays = (gameId: number) => cachedCfbdGet<CfbdLiveGame>("/live/plays", { gameId }, 15_000);
export const getWeekPlayStats = (year: number, week: number) => cachedCfbdGet<CfbdPlayStat[]>("/plays/stats", { year, week, seasonType: "regular" }, 45_000);
// Rosters barely change during a season — a short cache here was the single biggest driver of
// API call volume (89% of total usage in practice). A day-long cache is still fully correct for
// our purposes (mapping players to positions) while cutting that volume by roughly 24x.
export const getRoster = (team: string, year: number) => cachedCfbdGet<CfbdRosterAthlete[]>("/roster", { team, year }, 24 * 60 * 60_000);
// Game-level aggregated player stats - a different endpoint from /plays/stats (which is per-play).
// This might have a player's total fumbles for the whole game even when the play-level feed is
// missing the attribution for a specific play.
export type CfbdGamePlayerStatsGame = { id: number; teams: Array<{ team: string; categories: Array<{ name: string; types: Array<{ name: string; athletes: Array<{ id: string; name: string; stat: string }> }> }> }> };
export const getGamePlayerStats = (year: number, week: number, team?: string) => cachedCfbdGet<CfbdGamePlayerStatsGame[]>("/games/players", { year, week, seasonType: "regular", team }, 60_000);
