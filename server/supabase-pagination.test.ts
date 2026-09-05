import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRestAll } from "./supabase";

describe("supabaseRestAll", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  });

  it("loops with limit/offset and concatenates every page - the real b36_source_games table has more rows than PostgREST's silent 1000-row cap, which is exactly the bug this exists to prevent", async () => {
    const pageSize = 1000;
    const totalRows = 1450; // deliberately > 1 page, < 2 pages, matching the real-world shape of a full FBS+FCS schedule
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string) => {
      calls.push(url);
      const params = new URL(url).searchParams;
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      const page = Array.from({ length: Math.max(0, Math.min(limit, totalRows - offset)) }, (_, index) => ({ id: offset + index }));
      return { ok: true, text: async () => JSON.stringify(page) } as Response;
    }) as unknown as typeof fetch;

    const rows = await supabaseRestAll<{ id: number }>("b36_source_games", { query: { select: "id", order: "id.asc" } });

    expect(rows).toHaveLength(totalRows);
    expect(rows[0]).toEqual({ id: 0 });
    expect(rows[totalRows - 1]).toEqual({ id: totalRows - 1 });
    expect(calls).toHaveLength(2); // one full page of 1000, one short final page - confirms it stopped rather than looping forever
  });

  it("stops after exactly one call when the table has fewer rows than the page size", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify([{ id: 1 }, { id: 2 }]) }) as unknown as Response) as unknown as typeof fetch;
    const rows = await supabaseRestAll<{ id: number }>("b36_scoring_weeks", { query: { select: "id", order: "id.asc" } });
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses to paginate without a stable order - offset pagination is undefined without one and could silently return duplicate or missing rows across pages", async () => {
    await expect(supabaseRestAll("b36_source_games", { query: { select: "id" } })).rejects.toThrow(/requires a stable "order"/);
  });
});
