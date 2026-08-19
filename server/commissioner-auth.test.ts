import { describe, expect, it } from "vitest";
import { commissionerUser, hashCommissionerSession, isAuthorizedCommissionerEmail, normalizeCommissionerEmail, signCommissionerToken, verifyCommissionerToken } from "./commissioner-auth";

describe("registration-backed commissioner authentication", () => {
  it("authorizes only the two configured commissioner registration emails", () => {
    expect(isAuthorizedCommissionerEmail(" JanssenMatt25@gmail.com ")).toBe(true);
    expect(isAuthorizedCommissionerEmail("shawngidley@gmail.com")).toBe(true);
    expect(isAuthorizedCommissionerEmail("owner@example.com")).toBe(false);
  });

  it("creates an admin-shaped commissioner identity without Manus OAuth", () => {
    const user = commissionerUser("shawngidley@gmail.com");
    expect(user).toMatchObject({ role: "admin", loginMethod: "registration_pin", openId: "b36-commissioner:shawngidley@gmail.com" });
  });

  it("signs verifiable, expiring commissioner session tokens and hashes them before persistence", async () => {
    const token = await signCommissionerToken("janssenmatt25@gmail.com", "session-123", 60_000);
    const parsed = await verifyCommissionerToken(token);
    expect(parsed).toMatchObject({ email: "janssenmatt25@gmail.com", sessionId: "session-123" });
    expect(hashCommissionerSession(token)).not.toContain(token);

    const expired = await signCommissionerToken("shawngidley@gmail.com", "expired-session", -1);
    await expect(verifyCommissionerToken(expired)).resolves.toBeNull();
  });
});
