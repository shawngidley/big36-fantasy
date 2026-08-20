import { createHash, randomInt } from "node:crypto";

export const LOTTERY_REVEAL_INTERVAL_SECONDS = 20;
export type LotteryStatus = "READY" | "RUNNING" | "PAUSED" | "COMPLETE" | "ABORTED";

export type LotteryClock = {
  status: LotteryStatus;
  revealedCount: number;
  revealIntervalSeconds: number;
  elapsedMsBeforePause: number;
  startedAt: string | null;
};

export function secureShuffle<T>(items: readonly T[], pick = (upperExclusive: number) => randomInt(upperExclusive)): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const replacement = pick(index + 1);
    [shuffled[index], shuffled[replacement]] = [shuffled[replacement]!, shuffled[index]!];
  }
  return shuffled;
}

export function lotteryCommitment(ownerOrder: readonly string[]) {
  return createHash("sha256").update(JSON.stringify(ownerOrder)).digest("hex");
}

export function revealedLotteryCount(clock: LotteryClock, now = new Date()): number {
  if (clock.status !== "RUNNING" || !clock.startedAt) return clock.revealedCount;
  const elapsedMs = clock.elapsedMsBeforePause + Math.max(0, now.getTime() - new Date(clock.startedAt).getTime());
  return Math.min(36, Math.max(clock.revealedCount, Math.floor(elapsedMs / (clock.revealIntervalSeconds * 1_000))));
}

export function reverseLotteryPositions(ownerOrder: readonly string[], revealedCount: number) {
  return Array.from({ length: Math.min(36, revealedCount) }, (_, index) => ({
    revealIndex: index + 1,
    draftPosition: 36 - index,
    ownerId: ownerOrder[35 - index]!,
  }));
}
