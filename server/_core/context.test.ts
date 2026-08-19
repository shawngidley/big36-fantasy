import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({
  readCommissioner: vi.fn(),
  readOwner: vi.fn(),
  resolveCommissioner: vi.fn(),
  resolveOwner: vi.fn(),
}));

vi.mock("../commissioner-auth", () => ({
  readCommissionerSessionToken: mocks.readCommissioner,
  readOwnerSessionToken: mocks.readOwner,
  resolveCommissionerSession: mocks.resolveCommissioner,
  resolveOwnerSession: mocks.resolveOwner,
}));

import { createContext } from "./context";

const owner: User = {
  id: 0,
  openId: "b36-owner:owner@example.com",
  email: "owner@example.com",
  name: "owner@example.com",
  loginMethod: "registration_pin",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("league session context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCommissioner.mockResolvedValue(null);
    mocks.resolveOwner.mockResolvedValue(null);
  });

  it("does not authorize a request without a league-issued session", async () => {
    const context = await createContext({ req: { headers: {} }, res: {} } as never);
    expect(context.user).toBeNull();
  });

  it("accepts a valid registration-backed owner session after commissioner session lookup", async () => {
    mocks.resolveOwner.mockResolvedValue(owner);
    const context = await createContext({ req: { headers: { cookie: "b36_owner_session=signed" } }, res: {} } as never);
    expect(context.user).toMatchObject({ openId: "b36-owner:owner@example.com", role: "user" });
    expect(mocks.resolveCommissioner).toHaveBeenCalledOnce();
    expect(mocks.resolveOwner).toHaveBeenCalledOnce();
  });
});
