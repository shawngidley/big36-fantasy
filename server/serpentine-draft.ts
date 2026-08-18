import { inauguralDraftDayForRound } from "../shared/draft-schedule";

export type SerpentineTurn = {
  globalPick: number;
  roundNumber: number;
  ownerId: string;
};

export type DraftTurnState = SerpentineTurn & {
  status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED";
  expiresAt?: string | null;
};

export function buildSerpentineTurns(ownerIds: string[]): SerpentineTurn[] {
  if (ownerIds.length !== 36 || new Set(ownerIds).size !== 36) throw new Error("A 36 Football serpentine draft requires exactly 36 unique programs.");
  return Array.from({ length: 6 }, (_, roundIndex) => {
    const roundNumber = roundIndex + 1;
    const order = roundNumber % 2 === 1 ? ownerIds : [...ownerIds].reverse();
    return order.map((ownerId, index) => ({ globalPick: roundIndex * 36 + index + 1, roundNumber, ownerId }));
  }).flat();
}

export function ownerCanDraft(turns: DraftTurnState[], ownerId: string) {
  const active = turns.find(turn => turn.status === "ACTIVE");
  if (active?.ownerId === ownerId) return true;
  return turns.some(turn => turn.ownerId === ownerId && turn.status === "SKIPPED");
}

export function resolveExpiredActiveTurn(turns: DraftTurnState[], now = new Date()): DraftTurnState[] {
  const active = turns.find(turn => turn.status === "ACTIVE");
  if (!active?.expiresAt || new Date(active.expiresAt).getTime() > now.getTime()) return turns;
  const next = turns.filter(turn => turn.status === "PENDING").sort((a, b) => a.globalPick - b.globalPick)[0];
  return turns.map(turn => {
    if (turn.globalPick === active.globalPick) return { ...turn, status: "SKIPPED" as const };
    if (next && turn.globalPick === next.globalPick) return { ...turn, status: "ACTIVE" as const, expiresAt: new Date(now.getTime() + 600_000).toISOString() };
    return turn;
  });
}

export function currentDraftDayRoundLimit(roundNumber: number) {
  return inauguralDraftDayForRound(roundNumber)?.dayNumber ?? 3;
}
