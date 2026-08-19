import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getAllDraftSlots: vi.fn(),
  getDraftOwnerState: vi.fn(),
  getDraftSlotByGroup: vi.fn(),
  getLeagueSnapshot: vi.fn(),
  getOrClaimOwner: vi.fn(),
  getScoreEvent: vi.fn(),
  getScoringRulesForEvent: vi.fn(),
  supabaseRest: vi.fn(),
  supabaseRpc: vi.fn(),
}));

vi.mock("./league-data", () => ({
  getAllDraftSlots: mocks.getAllDraftSlots,
  getDraftOwnerState: mocks.getDraftOwnerState,
  getDraftSlotByGroup: mocks.getDraftSlotByGroup,
  getLeagueSnapshot: mocks.getLeagueSnapshot,
  getOrClaimOwner: mocks.getOrClaimOwner,
  getScoreEvent: mocks.getScoreEvent,
  getScoringRulesForEvent: mocks.getScoringRulesForEvent,
}));

vi.mock("./supabase", () => ({
  q: { eq: (value: string | boolean) => `eq.${String(value)}` },
  supabaseRest: mocks.supabaseRest,
  supabaseRpc: mocks.supabaseRpc,
}));

import { appRouter } from "./routers";
import { hashRegistrationPin } from "./registration";

function createContext(role: "admin" | "user", email = "owner@example.com"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      name: "League Owner",
      email,
      loginMethod: "email",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createCommissionerLoginContext() {
  const setCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => setCookies.push({ name, value, options }),
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
  return { ctx, setCookies };
}

describe("Big 36 owner draft procedures", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T13:00:00.000Z"));
    vi.clearAllMocks();
    mocks.getLeagueSnapshot.mockResolvedValue({ owners: [], divisions: [], totals: { ownerCount: 0 } });
  });
  afterEach(() => vi.useRealTimers());

  it("allows an enrolled owner to submit their own normalized school-position selection", async () => {
    mocks.getOrClaimOwner.mockResolvedValue({ id: "owner-uuid", displayName: "League Owner", teamName: "Owner Team" });
    mocks.supabaseRest.mockResolvedValue([{ school_name: "Ohio State" }]);
    mocks.supabaseRpc.mockResolvedValue({ id: "slot-uuid", draft_position: 4 });
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.league.submitMyPick({ position: "QB", schoolName: "  Ohio   State  " })).resolves.toEqual({ success: true, draftPosition: 4 });
    expect(mocks.supabaseRpc).toHaveBeenCalledWith("b36_submit_serpentine_pick", {
      p_owner_open_id: "owner-open-id",
      p_position: "QB",
      p_school_name: "Ohio State",
    });
  });

  it("blocks an account that has not been assigned to a Big 36 owner record", async () => {
    mocks.getOrClaimOwner.mockResolvedValue(null);
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.league.submitMyPick({ position: "RB", schoolName: "Michigan" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.supabaseRpc).not.toHaveBeenCalled();
  });

  it("accepts a public program registration while hashing its PIN and normalizing private contact data", async () => {
    mocks.supabaseRpc.mockResolvedValueOnce("33333333-3333-4333-8333-333333333333");
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.league.submitRegistration({ displayName: "Jordan Owner", teamName: "Lakewood College", nickname: "Night Owls", programIdentity: "Lakeside underdogs", inspiration: "Lakewood", primaryColor: "#B84A12", accentColor: "#17120E", brandingNotes: "Tough and traditional", rivalryPreference: "River City", email: "Jordan@Example.com", phone: "(555) 555-0182", pin: "482917", logoDataUrl: null })).resolves.toEqual({ success: true });
    expect(mocks.supabaseRest).not.toHaveBeenCalled();
    expect(mocks.supabaseRpc).toHaveBeenCalledWith("b36_submit_owner_registration", expect.objectContaining({ p_email: "jordan@example.com", p_phone_e164: "+5555550182", p_team_name: "Lakewood College", p_nickname: "Night Owls", p_primary_color: "#B84A12" }));
    const payload = mocks.supabaseRpc.mock.calls[0]?.[1] as { p_pin_hash: string };
    expect(payload.p_pin_hash).toMatch(/^scrypt\$/);
    expect(payload.p_pin_hash).not.toContain("482917");
  });

  it("issues a dedicated signed cookie for an authorized commissioner registration PIN and rejects unrelated emails", async () => {
    mocks.supabaseRest
      .mockResolvedValueOnce([{ id: "11111111-1111-4111-8111-111111111111", email: "janssenmatt25@gmail.com", pin_hash: hashRegistrationPin("482917") }])
      .mockResolvedValueOnce([]);
    const { ctx, setCookies } = createCommissionerLoginContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.commissionerLogin({ email: "JanssenMatt25@gmail.com", pin: "482917" })).resolves.toMatchObject({ success: true });
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toMatchObject({ name: "b36_commissioner_session", options: expect.objectContaining({ httpOnly: true, secure: true, sameSite: "none" }) });
    expect(setCookies[0]?.value).not.toContain("482917");

    await expect(caller.auth.commissionerLogin({ email: "owner@example.com", pin: "482917" })).rejects.toThrow("not recognized");
  });

  it("keeps private registration review commissioner-only", async () => {
    const ownerCaller = appRouter.createCaller(createContext("user"));
    await expect(ownerCaller.league.admin.ownerRegistrations()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.supabaseRest).not.toHaveBeenCalled();
  });

  it("grants commissioner review access to the configured Matt Janssen email without changing other owner access", async () => {
    mocks.supabaseRest.mockResolvedValue([]);
    const mattCaller = appRouter.createCaller(createContext("user", "janssenmatt25@gmail.com"));
    await expect(mattCaller.league.admin.ownerRegistrations()).resolves.toEqual([]);
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_owner_registrations", expect.any(Object));
  });

  it("keeps the root registration landing open until all 36 registrations are approved", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    mocks.supabaseRpc.mockResolvedValueOnce({ approvedCount: 35, capacity: 36, registrationOpen: true });
    await expect(caller.league.registrationLanding()).resolves.toEqual({ approvedCount: 35, capacity: 36, registrationOpen: true });

    mocks.supabaseRpc.mockResolvedValueOnce({ approvedCount: 36, capacity: 36, registrationOpen: false });
    await expect(caller.league.registrationLanding()).resolves.toEqual({ approvedCount: 36, capacity: 36, registrationOpen: false });
    expect(mocks.supabaseRpc).toHaveBeenLastCalledWith("b36_registration_landing_status", {});
  });

  it("persists exact offsetting reversals for positive scores and negative turnovers", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const touchdownId = "11111111-1111-4111-8111-111111111111";
    const turnoverId = "22222222-2222-4222-8222-222222222222";
    mocks.getScoreEvent
      .mockResolvedValueOnce({ id: touchdownId, week_id: "week-1", draft_slot_id: "slot-1", event_type: "TOUCHDOWN", stat_value: 1, computed_points: 10, yard_distance: 42 })
      .mockResolvedValueOnce({ id: turnoverId, week_id: "week-1", draft_slot_id: "slot-1", event_type: "INTERCEPTION_THROWN", stat_value: 1, computed_points: -3, yard_distance: null });
    mocks.supabaseRest.mockResolvedValue([]);

    await expect(caller.league.admin.reverseScoreEvent({ eventId: touchdownId, reason: "Provider removed touchdown" })).resolves.toEqual({ success: true });
    await expect(caller.league.admin.reverseScoreEvent({ eventId: turnoverId, reason: "Provider removed interception" })).resolves.toEqual({ success: true });

    expect(mocks.supabaseRest).toHaveBeenNthCalledWith(1, "b36_scoring_events", expect.objectContaining({ method: "POST", body: expect.objectContaining({ correction_of_event_id: touchdownId, stat_value: "-1", computed_points: "-10", audit_action: "REVERSAL" }) }));
    expect(mocks.supabaseRest).toHaveBeenNthCalledWith(2, "b36_scoring_events", expect.objectContaining({ method: "POST", body: expect.objectContaining({ correction_of_event_id: turnoverId, stat_value: "-1", computed_points: "3", audit_action: "REVERSAL" }) }));
  });

  it("allows only the commissioner to open a position round", async () => {
    mocks.supabaseRest.mockResolvedValue([]);
    const ownerCaller = appRouter.createCaller(createContext("user"));
    await expect(ownerCaller.league.admin.setDraftState({ status: "OPEN", activePosition: "WR" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const adminCaller = appRouter.createCaller(createContext("admin"));
    await expect(adminCaller.league.admin.setDraftState({ status: "OPEN", activePosition: "WR" })).resolves.toEqual({ success: true });
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_state", expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ status: "OPEN", active_position: "WR" }) }));
  });

  it("allows the commissioner to record an explicit draft override for an assigned slot", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    mocks.getAllDraftSlots.mockResolvedValue([{ id: "22222222-2222-4222-8222-222222222222", owner_id: ownerId, position: "TE", draft_position: 8, school_name: null }]);
    mocks.supabaseRest.mockResolvedValue([]);
    const caller = appRouter.createCaller(createContext("admin"));

    await expect(caller.league.admin.recordDraftPick({ ownerId, position: "TE", schoolName: "  Texas  " })).resolves.toEqual({ success: true, draftPosition: 8 });
    expect(mocks.supabaseRest).toHaveBeenCalledWith("b36_draft_slots", expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ school_name: "Texas", selected_by_open_id: "owner-open-id" }) }));
  });

  it("blocks a seventh owner from being placed into a six-owner division", async () => {
    const divisionId = "11111111-1111-4111-8111-111111111111";
    mocks.getLeagueSnapshot.mockResolvedValue({
      owners: [],
      divisions: [{ id: divisionId, owners: Array.from({ length: 6 }, (_, index) => ({ id: `owner-${index}` })) }],
      totals: { ownerCount: 6 },
    });
    const caller = appRouter.createCaller(createContext("admin"));

    await expect(caller.league.admin.upsertOwner({ displayName: "Seventh Owner", teamName: "Seventh Team", email: "seventh@example.com", divisionId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("six owners") });
    expect(mocks.supabaseRest).not.toHaveBeenCalled();
  });

  it("blocks a thirty-seventh owner from entering Big 36", async () => {
    mocks.getLeagueSnapshot.mockResolvedValue({ owners: Array.from({ length: 36 }, (_, index) => ({ id: `owner-${index}` })), divisions: [], totals: { ownerCount: 36 } });
    const caller = appRouter.createCaller(createContext("admin"));

    await expect(caller.league.admin.upsertOwner({ displayName: "Late Owner", teamName: "Late Team", email: "late@example.com", divisionId: null })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("36-owner") });
    expect(mocks.supabaseRest).not.toHaveBeenCalled();
  });

  it("serves the public league snapshot without requiring an owner account", async () => {
    const snapshot = { owners: [], divisions: [], totals: { ownerCount: 0 } };
    mocks.getLeagueSnapshot.mockResolvedValue(snapshot);
    const caller = appRouter.createCaller(createContext("user"));

    await expect(caller.league.snapshot()).resolves.toEqual(snapshot);
  });
});
