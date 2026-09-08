import { describe, expect, it } from "vitest";
import { isCollegeFootballGamedayWindow, sourceEventNeedsCorrection, sourceEventReversalPoints } from "./gameday-refresh";

describe("official source-event reconciliation", () => {
  const original = { computed_points: 10, yard_distance: 31, stat_value: 1 };

  it("does not create a correction when a final source event is unchanged", () => {
    expect(sourceEventNeedsCorrection(original, { points: 10, yardDistance: 31, statValue: 1 })).toBe(false);
  });

  it("creates a correction when a final source event keeps its key but changes points, distance, or value", () => {
    expect(sourceEventNeedsCorrection(original, { points: 12, yardDistance: 61, statValue: 1 })).toBe(true);
    expect(sourceEventNeedsCorrection(original, { points: 10, yardDistance: 31, statValue: 2 })).toBe(true);
  });

  it("reverses the exact original signed delta rather than always subtracting points", () => {
    expect(sourceEventReversalPoints(10)).toBe(-10);
    expect(sourceEventReversalPoints(-3)).toBe(3);
  });
});

describe("College Football gameday polling window", () => {
  it("runs during the configured Eastern Thursday-through-Sunday game window and skips quiet weekdays", () => {
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-03T22:00:00.000Z"))).toBe(true);
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-05T15:00:00.000Z"))).toBe(true);
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-01T19:00:00.000Z"))).toBe(false); // Tuesday ~3pm ET, clearly outside even the extended Tuesday-morning allowance
  });
  it("keeps running well past 3am Sunday, all through Monday, and into Tuesday morning - so late Saturday-night AND Monday-night games actually get time to finalize (Monday used to cut off at noon, which left a real Monday-night SMU/Florida State game permanently stuck unreconciled)", () => {
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-06T14:00:00.000Z"))).toBe(true); // Sunday ~10am ET
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-06T23:00:00.000Z"))).toBe(true); // Sunday ~7pm ET
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-07T14:00:00.000Z"))).toBe(true); // Monday ~10am ET
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-07T20:00:00.000Z"))).toBe(true); // Monday ~4pm ET - now still active, not "back to quiet"
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-08T03:30:00.000Z"))).toBe(true); // Monday ~11:30pm ET, a real Monday night game still in progress
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-08T13:00:00.000Z"))).toBe(true); // Tuesday ~9am ET, reconciliation runway for that Monday night game
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-08T19:00:00.000Z"))).toBe(false); // Tuesday ~3pm ET, back to quiet
  });
});
