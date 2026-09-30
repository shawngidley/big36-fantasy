import { describe, expect, it } from "vitest";
import { readCfbdUsage } from "./cfbd";

// CFBD's /info field names are not a documented contract, so the reader accepts the shapes CFBD
// has used and reports null (never a guess) when none of them are present.
describe("readCfbdUsage", () => {
  it("reads a direct remaining-calls figure and the tier", () => {
    expect(readCfbdUsage({ tier: 6, remainingCalls: 48211, callLimit: 500000 }, "t")).toEqual({ raw: { tier: 6, remainingCalls: 48211, callLimit: 500000 }, remainingCalls: 48211, monthlyLimit: 500000, tier: 6, fetchedAt: "t" });
  });
  it("derives remaining from limit minus used, in snake_case too, and accepts numeric strings", () => {
    expect(readCfbdUsage({ patron_level: "Tier 6", call_limit: "500000", calls_used: "451789" }, "t")).toMatchObject({ remainingCalls: 48211, monthlyLimit: 500000, tier: "Tier 6" });
  });
  it("returns nulls, not zeros, when the payload has nothing usable", () => {
    expect(readCfbdUsage({ id: 1, email: "x" }, "t")).toMatchObject({ remainingCalls: null, monthlyLimit: null, tier: null });
    expect(readCfbdUsage(null, "t")).toMatchObject({ remainingCalls: null, monthlyLimit: null, tier: null, raw: null });
  });
});
