export type InauguralDraftDay = {
  id: string;
  dayNumber: number;
  weekday: string;
  dateLabel: string;
  rounds: readonly [number, number];
  pickRange: readonly [number, number];
};

export const inauguralDraftDays: readonly InauguralDraftDay[] = [
  { id: "day-1", dayNumber: 1, weekday: "Monday", dateLabel: "August 24, 2026", rounds: [1, 2], pickRange: [1, 72] },
  { id: "day-2", dayNumber: 2, weekday: "Tuesday", dateLabel: "August 25, 2026", rounds: [3, 4], pickRange: [73, 144] },
  { id: "day-3", dayNumber: 3, weekday: "Wednesday", dateLabel: "August 26, 2026", rounds: [5, 6], pickRange: [145, 216] },
];

export function inauguralDraftDayForRound(roundNumber: number): InauguralDraftDay | undefined {
  return inauguralDraftDays.find(day => roundNumber >= day.rounds[0] && roundNumber <= day.rounds[1]);
}
