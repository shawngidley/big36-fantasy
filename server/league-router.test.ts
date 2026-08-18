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

function createContext(role: "admin" | "user"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "owner-open-id",
      name: "League Owner",
      email: "owner@example.com",
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
