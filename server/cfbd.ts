const CFBD_BASE_URL = "https://api.collegefootballdata.com";

function apiKey() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CollegeFootballData API key is not configured.");
  return key;
}

export async function cfbdGet<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`${CFBD_BASE_URL}${path}${params.size ? `?${params}` : ""}`, { headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" } });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message ?? `CollegeFootballData ${path} failed (${response.status}).`);
  return payload as T;
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
export type CfbdPlay = { id: number; gameId: number; driveId?: string | null; playNumber?: number | null; offense: string; defense: string; yardsToGoal?: number | null; yardsGained?: number | null; scoring: boolean; playType?: string | null; playText?: string | null; period?: number | null; clock?: { minutes?: number; seconds?: number } | null };
export type CfbdPlayStat = { playId: number; athleteId: number; athleteName?: string | null; team: string; statType: string; stat: number | string; yardsToGoal?: number | null };
export type CfbdRosterAthlete = { id: number; firstName?: string | null; lastName?: string | null; position: string; team?: string | null };
export type CfbdScoreboardGame = { id: number; status?: string | null; period?: number | null; clock?: string | null; homeTeam?: string | null; awayTeam?: string | null; homePoints?: number | null; awayPoints?: number | null; homeLineScores?: number[] | null; awayLineScores?: number[] | null; week?: number | null; season?: number | null };

export const getFbsTeams = (year: number) => cachedCfbdGet<CfbdTeam[]>("/teams/fbs", { year }, 6 * 60 * 60_000);
export const getRegularSeasonGames = (year: number) => cachedCfbdGet<CfbdGame[]>("/games", { year, seasonType: "regular" }, 10 * 60_000);
export const getLiveScoreboard = () => cachedCfbdGet<CfbdScoreboardGame[]>("/scoreboard", { classification: "fbs" }, 15_000);
export const getWeekPlays = (year: number, week: number) => cachedCfbdGet<CfbdPlay[]>("/plays", { year, week, seasonType: "regular" }, 15_000);
export const getWeekPlayStats = (year: number, week: number) => cachedCfbdGet<CfbdPlayStat[]>("/plays/stats", { year, week, seasonType: "regular" }, 15_000);
export const getRoster = (team: string, year: number) => cachedCfbdGet<CfbdRosterAthlete[]>("/roster", { team, year }, 60 * 60_000);
