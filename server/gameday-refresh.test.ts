import { describe, expect, it } from "vitest";
import { currentEffectivePoints, isCollegeFootballGamedayWindow, sourceEventNeedsCorrection, sourceEventReversalPoints } from "./gameday-refresh";

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

describe("currentEffectivePoints", () => {
  // A CORRECTION row's computed_points is a delta layered on top of an ENTRY's own stored value,
  // not a replacement absolute value. Real production data (Old Dominion QB, game 401858221):
  // a box-score fumble ENTRY of -3 ("fumbles lost x2") was later topped up by a -3 CORRECTION once
  // the true box-score total was confirmed, so the group's real total is -6, but the ENTRY row
  // itself still shows -3 forever - only the correction row records the extra -3.
  const entry = { id: "entry-1", computed_points: -3 };
  const correctionForThisEntry = { audit_action: "CORRECTION", correction_of_event_id: "entry-1", computed_points: -3 };
  const unrelatedCorrection = { audit_action: "CORRECTION", correction_of_event_id: "some-other-entry", computed_points: 99 };
  const unrelatedReversal = { audit_action: "REVERSAL", correction_of_event_id: "entry-1", computed_points: 3 };

  it("returns the ENTRY's own value when no corrections have been chained to it", () => {
    expect(currentEffectivePoints(entry, [unrelatedCorrection])).toBe(-3);
  });

  it("adds every CORRECTION chained to this entry via correction_of_event_id, ignoring corrections for other entries and non-CORRECTION rows", () => {
    expect(currentEffectivePoints(entry, [correctionForThisEntry, unrelatedCorrection, unrelatedReversal])).toBe(-6);
  });

  it("sums multiple stacked corrections against the same entry", () => {
    const secondCorrection = { audit_action: "CORRECTION", correction_of_event_id: "entry-1", computed_points: -1 };
    expect(currentEffectivePoints(entry, [correctionForThisEntry, secondCorrection])).toBe(-7);
  });

  it("prevents the reconciler from proposing a redundant double-correction once an entry's total is already correct", () => {
    // Reproduces the exact bug: comparing a fresh candidate against the raw ENTRY (-3) instead of
    // the true current total (-6) would wrongly conclude a -6 candidate still "needs correction".
    const freshCandidate = { points: -6, yardDistance: null, statValue: 2 };
    const rawEntryOnly = { computed_points: entry.computed_points, yard_distance: null, stat_value: 2 };
    expect(sourceEventNeedsCorrection(rawEntryOnly, freshCandidate)).toBe(true); // the bug, if uncorrected
    const effectiveEntry = { computed_points: currentEffectivePoints(entry, [correctionForThisEntry]), yard_distance: null, stat_value: 2 };
    expect(sourceEventNeedsCorrection(effectiveEntry, freshCandidate)).toBe(false); // the fix
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
