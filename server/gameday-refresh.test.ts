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
    expect(isCollegeFootballGamedayWindow(new Date("2026-09-01T16:00:00.000Z"))).toBe(false);
  });
});
