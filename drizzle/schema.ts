// Historically a live drizzle/MySQL schema (Manus scaffold default). The app's
// real data has always lived in Supabase (see `server/supabase.ts`); this file
// now only holds the shared type/enum shapes still imported across the server.

export const positions = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export type Position = (typeof positions)[number];

export const scoringEventTypes = [
  "TOUCHDOWN",
  "TWO_POINT_CONVERSION",
  "INTERCEPTION_THROWN",
  "FUMBLE_LOST",
  "EXTRA_POINT",
  "FIELD_GOAL",
  "BLOCKED_FIELD_GOAL",
  "BLOCKED_PUNT",
  "SPECIAL_TEAMS_SAFETY",
  "KICK_RETURN_TOUCHDOWN",
  "PUNT_RETURN_TOUCHDOWN",
  "BLOCKED_KICK_RETURN_TOUCHDOWN",
  "OTHER_SPECIAL_TEAMS_TOUCHDOWN",
  "SACK",
  "DEFENSIVE_TURNOVER",
  "DEFENSIVE_SAFETY",
  "SHUTOUT",
  "DEFENSIVE_TOUCHDOWN",
] as const;
export type ScoringEventType = (typeof scoringEventTypes)[number];

export type User = {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  role: "user" | "admin";
  createdAt: Date;
  updatedAt: Date;
  lastSignedIn: Date;
};
