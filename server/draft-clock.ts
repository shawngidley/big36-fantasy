import { supabaseRest, q } from "./supabase";
import { inauguralDraftWindow } from "../shared/draft-schedule";
import { notifyOwnerWhenUpcomingPickSafely } from "./draft-alerts";
import { normalizeSchoolName } from "./league-scoring";

type DraftTurnRow = { id: string; global_pick: number; round_number: number; owner_id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; expires_at: string | null };
type SlotRow = { id: string; owner_id: string; position: string; school_name: string | null };
type QueueEntryRow = { id: string; school_name: string; position: string; priority: number };

async function autoDraftFromQueue(turn: DraftTurnRow, now: Date) {
  const [queueEntries, ownerSlots, allTakenSlots] = await Promise.all([
    supabaseRest<QueueEntryRow[]>("b36_draft_queue_entries", { query: { select: "id,school_name,position,priority", owner_id: q.eq(turn.owner_id), order: "priority.asc" } }),
    supabaseRest<SlotRow[]>("b36_draft_slots", { query: { select: "id,owner_id,position,school_name", owner_id: q.eq(turn.owner_id) } }),
    supabaseRest<SlotRow[]>("b36_draft_slots", { query: { select: "id,owner_id,position,school_name", school_name: "not.is.null" } }),
  ]);
  const takenKeys = new Set(allTakenSlots.map(slot => `${normalizeSchoolName(slot.school_name!).toLowerCase()}::${slot.position}`));
  for (const entry of queueEntries) {
    const ownerSlot = ownerSlots.find(slot => slot.position === entry.position);
    if (!ownerSlot || ownerSlot.school_name) continue;
    const key = `${normalizeSchoolName(entry.school_name).toLowerCase()}::${entry.position}`;
    if (takenKeys.has(key)) continue;
    await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(ownerSlot.id) }, body: { school_name: normalizeSchoolName(entry.school_name), selected_at: now.toISOString(), selected_by_open_id: null } });
    await supabaseRest("b36_draft_queue_entries", { method: "DELETE", query: { id: q.eq(entry.id) } });
    return { draftedSchool: normalizeSchoolName(entry.school_name), draftedPosition: entry.position, draftSlotId: ownerSlot.id };
  }
  return null;
}

async function activateNextPendingTurn(now: Date, window: ReturnType<typeof inauguralDraftWindow>) {
  const pendingRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id,status,expires_at", status: "eq.PENDING", order: "global_pick.asc", limit: "1" } });
  const next = pendingRows[0];
  if (!next) return { nextPick: null as number | null, expiresAt: undefined as string | undefined, deferred: undefined as string | undefined };
  if (next.round_number < window.day!.rounds[0] || next.round_number > window.day!.rounds[1]) return { nextPick: null, expiresAt: undefined, deferred: "next-round-on-later-draft-day" as string | undefined };
  const expiresAt = new Date(now.getTime() + 600_000).toISOString();
  const activated = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${next.id}`, status: "eq.PENDING" }, prefer: "return=representation", body: { status: "ACTIVE", expires_at: expiresAt } });
  if (!activated[0]) return { nextPick: null, expiresAt: undefined, deferred: undefined }; // another process already claimed it — fine, nothing more to do
  await notifyOwnerWhenUpcomingPickSafely(next.id);
  return { nextPick: next.global_pick, expiresAt, deferred: undefined as string | undefined };
}

export async function advanceExpiredDraftTurn(now = new Date()) {
  const window = inauguralDraftWindow(now);
  if (!window.isOpen) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-draft-window" };
  const activeRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id,status,expires_at", status: "eq.ACTIVE", limit: "1" } });
  const active = activeRows[0];

  if (!active) {
    // Self-heal: nobody is currently on the clock. If picks remain today, put the next one on the clock
    // immediately — this recovers automatically from any prior step that filled a slot but didn't finish
    // advancing the turn (a slow notification, a transient network hiccup, etc.).
    const healed = await activateNextPendingTurn(now, window);
    return { advanced: Boolean(healed.nextPick), skippedPick: null, nextPick: healed.nextPick, expiresAt: healed.expiresAt, deferred: healed.deferred };
  }

  if (active.round_number < window.day!.rounds[0] || active.round_number > window.day!.rounds[1]) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-round-window" };
  if (!active.expires_at || new Date(active.expires_at).getTime() > now.getTime()) return { advanced: false, skippedPick: null, nextPick: null };

  const autoDraft = await autoDraftFromQueue(active, now);
  const resolved = autoDraft
    ? await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${active.id}`, status: "eq.ACTIVE", expires_at: `lte.${now.toISOString()}` }, prefer: "return=representation", body: { status: "PICKED", picked_at: now.toISOString(), draft_slot_id: autoDraft.draftSlotId, expires_at: null } })
    : await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${active.id}`, status: "eq.ACTIVE", expires_at: `lte.${now.toISOString()}` }, prefer: "return=representation", body: { status: "SKIPPED", skipped_at: now.toISOString(), expires_at: null } });
  if (!resolved[0]) return { advanced: false, skippedPick: null, nextPick: null };
  if (autoDraft) await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: "system:auto-draft", action: "AUTO_DRAFT_FROM_QUEUE", entity_type: "b36_draft_turns", entity_id: active.id, detail: { schoolName: autoDraft.draftedSchool, position: autoDraft.draftedPosition, globalPick: active.global_pick } } });

  const advanced = await activateNextPendingTurn(now, window);
  return { advanced: true, skippedPick: resolved[0].global_pick, nextPick: advanced.nextPick, expiresAt: advanced.expiresAt, deferred: advanced.deferred, autoDrafted: Boolean(autoDraft) };
}
