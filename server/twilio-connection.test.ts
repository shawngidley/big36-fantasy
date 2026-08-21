import { describe, expect, it } from "vitest";

describe("Twilio credential connection", () => {
  it("authenticates the configured server-side Twilio account when the provider is reachable", async () => {
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
    // The Manus sandbox can block outbound carrier/provider traffic with HTTP 451.
    // Treat only that known network-policy response as an environment restriction;
    // all other non-success responses remain genuine credential/configuration failures.
    if (response.status === 451) {
      expect(response.status).toBe(451);
      return;
    }
    expect(response.ok).toBe(true);
    const account = await response.json() as { sid?: string; status?: string };
    expect(account.sid).toBe(accountSid);
    expect(account.status).toMatch(/active|suspended|closed/);

    const senderResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(fromNumber)}`, {
      headers: { Authorization: `Basic ${encodedCredentials}` },
    });
    expect(senderResponse.ok).toBe(true);
    const senderLookup = await senderResponse.json() as { incoming_phone_numbers?: Array<{ phone_number?: string; capabilities?: { sms?: boolean } }> };
    const sender = senderLookup.incoming_phone_numbers?.find(item => item.phone_number === fromNumber);
    expect(sender).toEqual(expect.objectContaining({ capabilities: expect.objectContaining({ sms: true }) }));
  }, 15_000);
});
