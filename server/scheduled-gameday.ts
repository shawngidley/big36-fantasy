import type { Request, Response } from "express";
import { runGamedayRefresh } from "./gameday-refresh";
import { advanceExpiredDraftTurn } from "./draft-clock";
import { supabaseRest } from "./supabase";

type AutomationConfig = { enabled: boolean };

function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

export async function scheduledGamedayRefresh(req: Request, res: Response) {
  try {
    if (!isAuthorizedCronRequest(req)) return res.status(403).json({ error: "cron-only" });
    const config = (await supabaseRest<AutomationConfig[]>("b36_automation_config", { query: { select: "enabled", id: "eq.true" } }))[0];
    const draftClock = await advanceExpiredDraftTurn();
    if (!config?.enabled) return res.json({ ok: true, skipped: "automation-disabled", draftClock });
    const result = await runGamedayRefresh();
    return res.json({ ok: true, ...result, draftClock });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    return res.status(500).json({ error: message, timestamp: new Date().toISOString(), context: { path: req.path } });
  }
}
