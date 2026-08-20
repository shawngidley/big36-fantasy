import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseRest: vi.fn() }));

vi.mock("./supabase", () => ({ supabaseRest: mocks.supabaseRest }));

import { notifyOwnerWhenUpcomingPick } from "./draft-alerts";

const activeTurn = { id: "11111111-1111-4111-8111-111111111111", global_pick: 8, round_number: 1, owner_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const upcomingTurn = { id: "22222222-2222-4222-8222-222222222222", global_pick: 9, round_number: 1, owner_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const alertRow = { id: "33333333-3333-4333-8333-333333333333", active_turn_id: activeTurn.id, recipient_owner_id: upcomingTurn.owner_id, recipient_phone_e164: "+15551234567", status: "PENDING", twilio_message_sid: null, error_message: null, sent_at: null, created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z" };

describe("upcoming-pick SMS alerts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.supabaseRest.mockReset();
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC11111111111111111111111111111111");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+15557654321");
  });

  it("sends one on-deck SMS and persists its Twilio message SID", async () => {
    mocks.supabaseRest
      .mockResolvedValueOnce([activeTurn])
      .mockResolvedValueOnce([upcomingTurn])
      .mockResolvedValueOnce([{ display_name: "Taylor Owner", team_name: "Northside Foxes", phone_e164: "+15551234567" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([alertRow])
      .mockResolvedValueOnce([]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: "SM123" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifyOwnerWhenUpcomingPick();

    expect(result).toEqual(expect.objectContaining({ status: "SENT", activeTurnId: activeTurn.id, recipientOwnerId: upcomingTurn.owner_id, detail: "SM123" }));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/Messages.json"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining("To=%2B15551234567") }),
    );
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("Pick+9");
    expect(mocks.supabaseRest).toHaveBeenLastCalledWith(
      "b36_draft_sms_alerts",
      expect.objectContaining({ method: "PATCH", query: { id: "eq.33333333-3333-4333-8333-333333333333" }, body: expect.objectContaining({ status: "SENT", twilio_message_sid: "SM123" }) }),
    );
  });

  it("does not send a duplicate when the same active-turn and recipient alert is already logged", async () => {
    mocks.supabaseRest
      .mockResolvedValueOnce([activeTurn])
      .mockResolvedValueOnce([upcomingTurn])
      .mockResolvedValueOnce([{ display_name: "Taylor Owner", team_name: "Northside Foxes", phone_e164: "+15551234567" }])
      .mockResolvedValueOnce([{ ...alertRow, status: "SENT", twilio_message_sid: "SM123" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifyOwnerWhenUpcomingPick();

    expect(result).toEqual(expect.objectContaining({ status: "EXISTS", detail: "sent" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records a skipped alert instead of sending an SMS when the next owner has no phone number", async () => {
    mocks.supabaseRest
      .mockResolvedValueOnce([activeTurn])
      .mockResolvedValueOnce([upcomingTurn])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...alertRow, recipient_phone_e164: null }])
      .mockResolvedValueOnce([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await notifyOwnerWhenUpcomingPick();

    expect(result).toEqual(expect.objectContaining({ status: "SKIPPED", detail: "no-phone" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.supabaseRest).toHaveBeenLastCalledWith(
      "b36_draft_sms_alerts",
      expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ status: "SKIPPED" }) }),
    );
  });
});
