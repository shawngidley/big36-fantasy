import { describe, expect, it } from "vitest";

describe("Twilio credential connection", () => {
  it("authenticates the configured server-side Twilio account", async () => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    expect(accountSid).toMatch(/^AC[0-9a-fA-F]{32}$/);
    expect(authToken).toMatch(/\S+/);
    expect(fromNumber).toMatch(/^\+[1-9]\d{7,14}$/);

    const encodedCredentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      headers: { Authorization: `Basic ${encodedCredentials}` },
    });
    expect(response.ok).toBe(true);
    const account = await response.json() as { sid?: string; status?: string };
    expect(account.sid).toBe(accountSid);
    expect(account.status).toMatch(/active|suspended|closed/);
  }, 15_000);
});
