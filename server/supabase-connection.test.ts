import { describe, expect, it } from "vitest";

describe("Big 36 Supabase connection", () => {
  it("accepts the configured server credential for the REST API", async () => {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;

    expect(url, "SUPABASE_URL must be configured").toBeTruthy();
    expect(secret, "SUPABASE_SECRET_KEY must be configured").toBeTruthy();

    const response = await fetch(`${url}/rest/v1/b36_draft_state?select=id,status&limit=1`, {
      headers: {
        apikey: secret!,
        Authorization: `Bearer ${secret!}`,
      },
    });

    expect(response.status, "Supabase must accept the configured server credential and expose the Big 36 draft state").toBeLessThan(400);
  });
});
