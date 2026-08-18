import { describe, expect, it } from "vitest";
import { buildSerpentineTurns, currentDraftDayRoundLimit, ownerCanDraft, resolveExpiredActiveTurn } from "./serpentine-draft";

describe("36 Football serpentine draft", () => {
  const owners = Array.from({ length: 36 }, (_, index) => `owner-${index + 1}`);
  it("creates six 36-pick rounds with the required alternating direction", () => {
    const turns = buildSerpentineTurns(owners);
    expect(turns).toHaveLength(216);
    expect(turns.slice(0, 3).map(turn => turn.ownerId)).toEqual(["owner-1", "owner-2", "owner-3"]);
    expect(turns.slice(36, 39).map(turn => turn.ownerId)).toEqual(["owner-36", "owner-35", "owner-34"]);
    expect(turns[215]).toMatchObject({ globalPick: 216, roundNumber: 6, ownerId: "owner-1" });
  });
  it("allows an active owner or a skipped owner to draft, but no other owner", () => {
    const turns = [{ globalPick: 1, roundNumber: 1, ownerId: "owner-1", status: "SKIPPED" as const }, { globalPick: 2, roundNumber: 1, ownerId: "owner-2", status: "ACTIVE" as const }];
    expect(ownerCanDraft(turns, "owner-1")).toBe(true);
    expect(ownerCanDraft(turns, "owner-2")).toBe(true);
    expect(ownerCanDraft(turns, "owner-3")).toBe(false);
  });
  it("leapfrogs an expired turn and starts the next pending ten-minute clock", () => {
    const resolved = resolveExpiredActiveTurn([{ globalPick: 1, roundNumber: 1, ownerId: "owner-1", status: "ACTIVE", expiresAt: "2026-08-24T13:00:00.000Z" }, { globalPick: 2, roundNumber: 1, ownerId: "owner-2", status: "PENDING" }], new Date("2026-08-24T13:01:00.000Z"));
    expect(resolved[0].status).toBe("SKIPPED");
    expect(resolved[1]).toMatchObject({ status: "ACTIVE", expiresAt: "2026-08-24T13:11:00.000Z" });
  });
  it("limits the published schedule to two rounds per day", () => {
    expect([1, 2].map(currentDraftDayRoundLimit)).toEqual([1, 1]);
    expect([3, 4].map(currentDraftDayRoundLimit)).toEqual([2, 2]);
    expect([5, 6].map(currentDraftDayRoundLimit)).toEqual([3, 3]);
  });
});
