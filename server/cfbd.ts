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

export type CfbdTeam = { id: number; school: string; conference?: string | null; classification?: string | null };
export type CfbdGame = { id: number; season: number; week: number; seasonType: string; startDate: string; completed: boolean; homeTeam: string; awayTeam: string; homeClassification?: string | null; awayClassification?: string | null; homePoints?: number | null; awayPoints?: number | null };
export type CfbdPlay = { id: number; gameId: number; driveId?: string | null; playNumber?: number | null; offense: string; defense: string; yardsToGoal?: number | null; yardsGained?: number | null; scoring: boolean; playType?: string | null; playText?: string | null; period?: number | null; clock?: { minutes?: number; seconds?: number } | null };
export type CfbdPlayStat = { playId: number; athleteId: number; athleteName?: string | null; team: string; statType: string; stat: number | string; yardsToGoal?: number | null };
export type CfbdRosterAthlete = { id: number; firstName?: string | null; lastName?: string | null; position: string; team?: string | null };
export type CfbdScoreboardGame = { id: number; status?: string | null; period?: number | null; clock?: string | null; homeTeam?: string | null; awayTeam?: string | null; homePoints?: number | null; awayPoints?: number | null; week?: number | null; season?: number | null };

export const getFbsTeams = (year: number) => cfbdGet<CfbdTeam[]>("/teams/fbs", { year });
export const getRegularSeasonGames = (year: number) => cfbdGet<CfbdGame[]>("/games", { year, seasonType: "regular" });
export const getLiveScoreboard = () => cfbdGet<CfbdScoreboardGame[]>("/scoreboard", { classification: "fbs" });
export const getWeekPlays = (year: number, week: number) => cfbdGet<CfbdPlay[]>("/plays", { year, week, seasonType: "regular" });
export const getWeekPlayStats = (year: number, week: number) => cfbdGet<CfbdPlayStat[]>("/plays/stats", { year, week, seasonType: "regular" });
export const getRoster = (team: string, year: number) => cfbdGet<CfbdRosterAthlete[]>("/roster", { team, year });
