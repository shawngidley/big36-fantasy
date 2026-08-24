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

export async function advanceExpiredDraftTurn(now = new Date()) {
  const window = inauguralDraftWindow(now);
  if (!window.isOpen) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-draft-window" };
  const activeRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id,status,expires_at", status: "eq.ACTIVE", limit: "1" } });
  const active = activeRows[0];
  if (active && (active.round_number < window.day!.rounds[0] || active.round_number > window.day!.rounds[1])) return { advanced: false, skippedPick: null, nextPick: null, deferred: "outside-round-window" };
  if (!active?.expires_at || new Date(active.expires_at).getTime() > now.getTime()) return { advanced: false, skippedPick: null, nextPick: null };

  const autoDraft = await autoDraftFromQueue(active, now);
  const resolved = autoDraft
    ? await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${active.id}`, status: "eq.ACTIVE", expires_at: `lte.${now.toISOString()}` }, prefer: "return=representation", body: { status: "PICKED", picked_at: now.toISOString(), draft_slot_id: autoDraft.draftSlotId, expires_at: null } })
    : await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { method: "PATCH", query: { id: `eq.${active.id}`, status: "eq.ACTIVE", expires_at: `lte.${now.toISOString()}` }, prefer: "return=representation", body: { status: "SKIPPED", skipped_at: now.toISOString(), expires_at: null } });
  if (!resolved[0]) return { advanced: false, skippedPick: null, nextPick: null };
  if (autoDraft) await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: "system:auto-draft", action: "AUTO_DRAFT_FROM_QUEUE", entity_type: "b36_draft_turns", entity_id: active.id, detail: { schoolName: autoDraft.draftedSchool, position: autoDraft.draftedPosition, globalPick: active.global_pick } } });

  const pendingRows = await supabaseRest<DraftTurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id,status,expires_at", status: "eq.PENDING", order: "global_pick.asc", limit: "1" } });
  const next = pendingRows[0];
  if (!next) return { advanced: true, skippedPick: resolved[0].global_pick, nextPick: null, autoDrafted: Boolean(autoDraft) };
  if (next.round_number < window.day!.rounds[0] || next.round_number > window.day!.rounds[1]) return { advanced: true, skippedPick: resolved[0].global_pick, nextPick: null, deferred: "next-round-on-later-draft-day", autoDrafted: Boolean(autoDraft) };
  const expiresAt = new Date(now.getTime() + 600_000).toISOString();
  await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: `eq.${next.id}`, status: "eq.PENDING" }, body: { status: "ACTIVE", expires_at: expiresAt } });
  await notifyOwnerWhenUpcomingPickSafely(next.id);
  return { advanced: true, skippedPick: resolved[0].global_pick, nextPick: next.global_pick, expiresAt, autoDrafted: Boolean(autoDraft) };
}
