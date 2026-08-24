import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseRest: vi.fn(), notifyOwnerWhenUpcomingPickSafely: vi.fn() }));

vi.mock("./supabase", () => ({
  q: { eq: (value: string | boolean) => `eq.${String(value)}`, isNull: "is.null" },
  supabaseRest: mocks.supabaseRest,
}));

vi.mock("./draft-alerts", () => ({
  notifyOwnerWhenUpcomingPickSafely: mocks.notifyOwnerWhenUpcomingPickSafely,
}));

import { advanceExpiredDraftTurn } from "./draft-clock";

// Monday, August 24, 2026, 11:00 AM Eastern — inside the Day 1 (rounds 1-2) draft window.
const insideWindow = new Date("2026-08-24T15:00:00.000Z");
const expiredAt = new Date("2026-08-24T14:50:00.000Z").toISOString();

describe("advanceExpiredDraftTurn auto-draft from queue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("auto-drafts the owner's top available queued unit instead of skipping when their clock expires", async () => {
    const active = { id: "turn-1", global_pick: 5, round_number: 1, owner_id: "owner-1", status: "ACTIVE" as const, expires_at: expiredAt };
    mocks.supabaseRest
      .mockResolvedValueOnce([active]) // active turn lookup
      .mockResolvedValueOnce([{ id: "q1", school_name: "Oregon", position: "QB", priority: 1 }]) // queue entries
      .mockResolvedValueOnce([{ id: "slot-1", owner_id: "owner-1", position: "QB", school_name: null }]) // owner slots
      .mockResolvedValueOnce([]) // all taken slots (nothing taken)
      .mockResolvedValueOnce([]) // slot PATCH (fill Oregon)
      .mockResolvedValueOnce([]) // queue entry DELETE
      .mockResolvedValueOnce([active]) // turn PATCH to PICKED
      .mockResolvedValueOnce([]) // audit event POST
      .mockResolvedValueOnce([]); // next pending lookup (none)

    const result = await advanceExpiredDraftTurn(insideWindow);

    expect(result.autoDrafted).toBe(true);
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_slots", expect.objectContaining({ method: "PATCH", query: { id: "eq.slot-1" }, body: expect.objectContaining({ school_name: "Oregon" }) }));
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_queue_entries", expect.objectContaining({ method: "DELETE", query: { id: "eq.q1" } }));
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_turns", expect.objectContaining({ body: expect.objectContaining({ status: "PICKED", draft_slot_id: "slot-1" }) }));
  });

  it("skips a queued entry whose position is already filled and drafts the next usable one", async () => {
    const active = { id: "turn-1", global_pick: 5, round_number: 1, owner_id: "owner-1", status: "ACTIVE" as const, expires_at: expiredAt };
    mocks.supabaseRest
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([{ id: "q1", school_name: "Georgia", position: "QB", priority: 1 }, { id: "q2", school_name: "Alabama", position: "RB", priority: 2 }])
      .mockResolvedValueOnce([{ id: "slot-qb", owner_id: "owner-1", position: "QB", school_name: "Indiana" }, { id: "slot-rb", owner_id: "owner-1", position: "RB", school_name: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // slot PATCH for RB
      .mockResolvedValueOnce([]) // queue DELETE for q2
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await advanceExpiredDraftTurn(insideWindow);

    expect(result.autoDrafted).toBe(true);
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_slots", expect.objectContaining({ method: "PATCH", query: { id: "eq.slot-rb" }, body: expect.objectContaining({ school_name: "Alabama" }) }));
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_queue_entries", expect.objectContaining({ method: "DELETE", query: { id: "eq.q2" } }));
  });

  it("skips a queued school-position that another owner already drafted", async () => {
    const active = { id: "turn-1", global_pick: 5, round_number: 1, owner_id: "owner-1", status: "ACTIVE" as const, expires_at: expiredAt };
    mocks.supabaseRest
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([{ id: "q1", school_name: "Ohio State", position: "QB", priority: 1 }])
      .mockResolvedValueOnce([{ id: "slot-qb", owner_id: "owner-1", position: "QB", school_name: null }])
      .mockResolvedValueOnce([{ id: "other-slot", owner_id: "owner-9", position: "QB", school_name: "Ohio State" }]) // already taken elsewhere
      .mockResolvedValueOnce([active]) // falls through to SKIPPED
      .mockResolvedValueOnce([]);

    const result = await advanceExpiredDraftTurn(insideWindow);

    expect(result.autoDrafted).toBe(false);
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_turns", expect.objectContaining({ body: expect.objectContaining({ status: "SKIPPED" }) }));
    expect(mocks.supabaseRest).not.toHaveBeenCalledWith("b36_draft_slots", expect.objectContaining({ method: "PATCH" }));
  });

  it("falls back to a normal skip when the owner's queue is empty", async () => {
    const active = { id: "turn-1", global_pick: 5, round_number: 1, owner_id: "owner-1", status: "ACTIVE" as const, expires_at: expiredAt };
    mocks.supabaseRest
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([]) // no queue entries
      .mockResolvedValueOnce([{ id: "slot-qb", owner_id: "owner-1", position: "QB", school_name: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([]);

    const result = await advanceExpiredDraftTurn(insideWindow);

    expect(result.autoDrafted).toBe(false);
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_turns", expect.objectContaining({ body: expect.objectContaining({ status: "SKIPPED" }) }));
  });

  it("does nothing when the active turn has not actually expired yet", async () => {
    const active = { id: "turn-1", global_pick: 5, round_number: 1, owner_id: "owner-1", status: "ACTIVE" as const, expires_at: new Date(insideWindow.getTime() + 600_000).toISOString() };
    mocks.supabaseRest.mockResolvedValueOnce([active]);

    const result = await advanceExpiredDraftTurn(insideWindow);

    expect(result.advanced).toBe(false);
    expect(mocks.supabaseRest).toHaveBeenCalledTimes(1);
  });
});
