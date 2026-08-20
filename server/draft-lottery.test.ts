import { describe, expect, it } from "vitest";
import { lotteryCommitment, reverseLotteryPositions, revealedLotteryCount, secureShuffle } from "./draft-lottery";

describe("draft lottery timeline", () => {
  it("shuffles a full field reproducibly with an injected secure picker", () => {
    const field = ["a", "b", "c", "d"];
    expect(secureShuffle(field, () => 0)).toEqual(["b", "c", "d", "a"]);
    expect(field).toEqual(["a", "b", "c", "d"]);
  });

  it("reveals no positions until the first interval and caps at the full field", () => {
    const clock = { status: "RUNNING" as const, revealedCount: 0, revealIntervalSeconds: 20, elapsedMsBeforePause: 0, startedAt: "2026-08-23T13:00:00.000Z" };
    expect(revealedLotteryCount(clock, new Date("2026-08-23T13:00:19.999Z"))).toBe(0);
    expect(revealedLotteryCount(clock, new Date("2026-08-23T13:01:00.000Z"))).toBe(3);
    expect(revealedLotteryCount({ ...clock, revealedCount: 35 }, new Date("2026-08-23T13:20:00.000Z"))).toBe(36);
  });

  it("keeps a paused lottery fixed and maps revealed entries from position 36 back to 1", () => {
    const order = Array.from({ length: 36 }, (_, index) => `owner-${index + 1}`);
    expect(revealedLotteryCount({ status: "PAUSED", revealedCount: 4, revealIntervalSeconds: 20, elapsedMsBeforePause: 80_000, startedAt: null }, new Date("2026-08-23T14:00:00.000Z"))).toBe(4);
    expect(reverseLotteryPositions(order, 3)).toEqual([
      { revealIndex: 1, draftPosition: 36, ownerId: "owner-36" },
      { revealIndex: 2, draftPosition: 35, ownerId: "owner-35" },
      { revealIndex: 3, draftPosition: 34, ownerId: "owner-34" },
    ]);
  });

  it("creates a stable commitment for the locked order", () => {
    expect(lotteryCommitment(["owner-1", "owner-2"])).toBe(lotteryCommitment(["owner-1", "owner-2"]));
    expect(lotteryCommitment(["owner-1", "owner-2"])).not.toBe(lotteryCommitment(["owner-2", "owner-1"]));
  });
});
