import { describe, expect, it } from "vitest";

describe("CollegeFootballData Tier 4 connection", () => {
  it("authenticates to the FBS teams endpoint with the configured server key", async () => {
    const apiKey = process.env.CFBD_API_KEY;
    expect(apiKey, "CFBD_API_KEY must be configured for automatic Big 36 scoring").toBeTruthy();

    const response = await fetch("https://api.collegefootballdata.com/teams/fbs?year=2026", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    const teams = JSON.parse(body) as Array<{ school?: string }>;
    expect(teams.length).toBeGreaterThanOrEqual(130);
    expect(teams.some(team => team.school === "Ohio State")).toBe(true);
  }, 20_000);

  it("has the activated live-scoreboard entitlement required for gameday refreshes", async () => {
    const apiKey = process.env.CFBD_API_KEY;
    const response = await fetch("https://api.collegefootballdata.com/scoreboard?classification=fbs", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    expect(response.status, body).toBe(200);
    expect(() => JSON.parse(body)).not.toThrow();
  }, 20_000);
});
