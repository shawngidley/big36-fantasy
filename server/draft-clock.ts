import { supabaseRest } from "./supabase";
import { inauguralDraftWindow } from "../shared/draft-schedule";

type DraftTurnRow = { id: string; global_pick: number; round_number: number; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; expires_at: string | null };

export async function advanceExpiredDraftTurn(now = new Date()) {
  const window = inauguralDraftWindow(now);
  if (!window.isOpen) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-draft-window" };
  const activeRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,status,expires_at", status: "eq.ACTIVE", limit: "1" } });
  const active = activeRows[0];
  if (active && (active.round_number < window.day!.rounds[0] || active.round_number > window.day!.rounds[1])) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-round-window" };
  if (!active?.expires_at || new Date(active.expires_at).getTime() > now.getTime()) return { advanced: false, skippedPick: null, nextPick: null };

  const skipped = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${active.id}`, status: "eq.ACTIVE", expires_at: `lte.${now.toISOString()}` }, prefer: "return=representation", body: { status: "SKIPPED", skipped_at: now.toISOString(), expires_at: null } });
  if (!skipped[0]) return { advanced: false, skippedPick: null, nextPick: null };

  const pendingRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,status,expires_at", status: "eq.PENDING", order: "global_pick.asc", limit: "1" } });
  const next = pendingRows[0];
  if (!next) return { advanced: true, skippedPick: skipped[0].global_pick, nextPick: null };
  if (next.round_number < window.day!.rounds[0] || next.round_number > window.day!.rounds[1]) return { advanced: true, skippedPick: skipped[0].global_pick, nextPick: null, deferred: "next-round-on-later-draft-day" };
  const expiresAt = new Date(now.getTime() + 600_000).toISOString();
  await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: `eq.${next.id}`, status: "eq.PENDING" }, body: { status: "ACTIVE", expires_at: expiresAt } });
  return { advanced: true, skippedPick: skipped[0].global_pick, nextPick: next.global_pick, expiresAt };
}
