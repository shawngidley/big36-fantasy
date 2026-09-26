import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRoster } from "./cfbd";

// getRoster used to make one CFBD call per school. cfbd.ts gates every real outbound call 650ms
// apart (paceOutboundCall - a deliberate 429 guard), so N schools cost N x 650ms of waiting no
// matter how parallel the callers are. On a cold instance a week-2 audit needed ~136 school rosters
// (~88s of gate alone, inside a 60s function) and the every-minute gameday loop's 100+ school fan-out
// could not finish inside its own 45s budget. CFBD's /roster takes `team` as an OPTIONAL filter, so
// one `/roster?year=` call now serves every school. These tests pin the outbound-call behavior, which
// is the whole point: assert on what actually went over the wire, not on a cached return value.
// Distinct `year`s per test keep the module-level 24h cache from bleeding between cases.

type Row = { id: number; firstName: string; lastName: string; position: string; team: string };
const row = (id: number, team: string, position = "QB"): Row => ({ id, firstName: `F${id}`, lastName: `L${id}`, position, team });

function stubFetch(handler: (url: string) => unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify(handler(url)) };
  }));
  return calls;
}

describe("getRoster (one all-teams call, filtered per school)", () => {
  beforeEach(() => { process.env.CFBD_API_KEY = "test-key"; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.CFBD_API_KEY; });

  it("makes exactly one /roster call with no team filter and serves every school from it, matching names case- and whitespace-insensitively", async () => {
    const calls = stubFetch(url => {
      expect(url).not.toContain("team=");
      return [row(1, "School X"), row(2, "School X", "WR"), row(3, "School Y"), row(4, "Hawai'i", "K")];
    });
    const x = await getRoster("School X", 2031);
    const y = await getRoster("  school   y ", 2031);
    const h = await getRoster("Hawai'i", 2031);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/roster?year=2031");
    expect(x.map(a => a.id)).toEqual([1, 2]);
    expect(y.map(a => a.id)).toEqual([3]);
    expect(h.map(a => a.id)).toEqual([4]);
  });

  it("falls back to the old per-team call only for a school the all-teams payload has no rows for", async () => {
    const calls = stubFetch(url => (url.includes("team=") ? [row(9, "School Z")] : [row(1, "School X")]));
    expect((await getRoster("School X", 2032)).map(a => a.id)).toEqual([1]);
    expect((await getRoster("School Z", 2032)).map(a => a.id)).toEqual([9]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toContain("team=");
    expect(new URL(calls[1]).searchParams.get("team")).toBe("School Z");
  }, 10_000); // the fallback is a second real outbound call, so it pays the 650ms pace gate once
});
