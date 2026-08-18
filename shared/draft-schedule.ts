export type InauguralDraftDay = {
  id: string;
  dayNumber: number;
  weekday: string;
  dateLabel: string;
  dateKey: string;
  rounds: readonly [number, number];
  pickRange: readonly [number, number];
};

export const inauguralDraftDays: readonly InauguralDraftDay[] = [
  { id: "day-1", dayNumber: 1, weekday: "Monday", dateLabel: "August 24, 2026", dateKey: "2026-08-24", rounds: [1, 2], pickRange: [1, 72] },
  { id: "day-2", dayNumber: 2, weekday: "Tuesday", dateLabel: "August 25, 2026", dateKey: "2026-08-25", rounds: [3, 4], pickRange: [73, 144] },
  { id: "day-3", dayNumber: 3, weekday: "Wednesday", dateLabel: "August 26, 2026", dateKey: "2026-08-26", rounds: [5, 6], pickRange: [145, 216] },
];

const easternParts = (now: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
}).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));

export function inauguralDraftEasternMoment(now = new Date()) {
  const parts = easternParts(now);
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function inauguralDraftWindow(now = new Date()) {
  const eastern = inauguralDraftEasternMoment(now);
  const day = inauguralDraftDays.find(item => item.dateKey === eastern.dateKey);
  return { day, isOpen: Boolean(day && eastern.hour >= 9 && eastern.hour < 21), eastern };
}

export function assertInauguralDraftOrderCanBePublished(now = new Date()) {
  if (inauguralDraftEasternMoment(now).dateKey < "2026-08-23") throw new Error("The official randomized order is announced Sunday, August 23, 2026 (Eastern Time).");
}

export function assertInauguralDraftWindow(now = new Date()) {
  const window = inauguralDraftWindow(now);
  if (window.isOpen) return window.day!;
  if (window.day) throw new Error(`Drafting is open ${window.day.weekday}, ${window.day.dateLabel}, from 9:00 AM to 9:00 PM Eastern Time.`);
  throw new Error("The inaugural draft is open only August 24–26, 2026, from 9:00 AM to 9:00 PM Eastern Time.");
}

export function assertInauguralDraftRoundIsOpen(roundNumber: number, now = new Date()) {
  const day = assertInauguralDraftWindow(now);
  if (roundNumber < day.rounds[0] || roundNumber > day.rounds[1]) throw new Error(`Round ${roundNumber} is scheduled for ${inauguralDraftDayForRound(roundNumber)?.weekday ?? "a later draft day"}; ${day.weekday} is limited to rounds ${day.rounds[0]} and ${day.rounds[1]}.`);
  return day;
}

export function inauguralDraftDayForRound(roundNumber: number): InauguralDraftDay | undefined {
  return inauguralDraftDays.find(day => roundNumber >= day.rounds[0] && roundNumber <= day.rounds[1]);
}
