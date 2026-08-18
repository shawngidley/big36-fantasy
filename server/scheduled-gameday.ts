import type { Request, Response } from "express";
import { runGamedayRefresh } from "./gameday-refresh";
import { advanceExpiredDraftTurn } from "./draft-clock";
import { sdk } from "./_core/sdk";
import { supabaseRest } from "./supabase";

type AutomationConfig = { schedule_cron_task_uid: string | null; enabled: boolean };

export async function scheduledGamedayRefresh(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
    const config = (await supabaseRest<AutomationConfig[]>("b36_automation_config", { query: { select: "schedule_cron_task_uid,enabled", id: "eq.true" } }))[0];
    if (!config || config.schedule_cron_task_uid !== user.taskUid) return res.json({ ok: true, skipped: "orphan" });
    const draftClock = await advanceExpiredDraftTurn();
    if (!config.enabled) return res.json({ ok: true, skipped: "automation-disabled", draftClock });
    const result = await runGamedayRefresh();
    return res.json({ ok: true, ...result, draftClock });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gameday refresh failure";
    return res.status(500).json({ error: message, timestamp: new Date().toISOString(), context: { path: req.path } });
  }
}
