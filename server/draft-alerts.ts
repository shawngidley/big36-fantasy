import { supabaseRest } from "./supabase";

export type DraftAlertStatus = "PENDING" | "SENT" | "SKIPPED" | "FAILED";

export type DraftSmsAlertRow = {
  id: string;
  active_turn_id: string;
  recipient_owner_id: string;
  recipient_phone_e164: string | null;
  status: DraftAlertStatus;
  twilio_message_sid: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UpcomingPickRecipient = {
  ownerId: string;
  teamName: string;
  displayName: string;
  phoneE164: string | null;
  globalPick: number;
  roundNumber: number;
};

export const DRAFT_ALERT_TYPE = "UPCOMING_PICK";

type TurnRow = { id: string; global_pick: number; round_number: number; owner_id: string };
type RegistrationContactRow = { display_name: string; team_name: string; phone_e164: string | null };

export type UpcomingPickAlertResult = {
  status: "SENT" | "SKIPPED" | "FAILED" | "EXISTS";
  activeTurnId: string | null;
  recipientOwnerId: string | null;
  detail: string;
};

export async function findDraftSmsAlert(activeTurnId: string, recipientOwnerId: string) {
  const rows = await supabaseRest<DraftSmsAlertRow[]>("b36_draft_sms_alerts", {
    query: { select: "id,active_turn_id,recipient_owner_id,recipient_phone_e164,status,twilio_message_sid,error_message,sent_at,created_at,updated_at", active_turn_id: `eq.${activeTurnId}`, recipient_owner_id: `eq.${recipientOwnerId}`, limit: "1" },
  });
  return rows[0] ?? null;
}

export async function createDraftSmsAlert(activeTurnId: string, recipient: UpcomingPickRecipient) {
  const rows = await supabaseRest<DraftSmsAlertRow[]>("b36_draft_sms_alerts", {
    method: "POST",
    body: { alert_type: DRAFT_ALERT_TYPE, active_turn_id: activeTurnId, recipient_owner_id: recipient.ownerId, recipient_phone_e164: recipient.phoneE164, status: "PENDING" },
  });
  return rows[0] ?? null;
}

export async function updateDraftSmsAlert(id: string, status: DraftAlertStatus, values: Pick<DraftSmsAlertRow, "twilio_message_sid" | "error_message" | "sent_at"> = { twilio_message_sid: null, error_message: null, sent_at: null }) {
  const rows = await supabaseRest<DraftSmsAlertRow[]>("b36_draft_sms_alerts", {
    method: "PATCH",
    query: { id: `eq.${id}` },
    body: { status, ...values, updated_at: new Date().toISOString() },
  });
  return rows[0] ?? null;
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) throw new Error("Twilio SMS configuration is incomplete.");
  return { accountSid, authToken, fromNumber, messagingServiceSid };
}

export async function sendDraftSms(toPhoneE164: string, body: string) {
  const { accountSid, authToken, fromNumber, messagingServiceSid } = getTwilioConfig();
  const payload = new URLSearchParams({ To: toPhoneE164, Body: body, ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: fromNumber! }) });
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  });
  const data = await response.json() as { sid?: string; message?: string };
  if (!response.ok || !data.sid) throw new Error(data.message ?? `Twilio rejected the SMS (${response.status}).`);
  return data.sid;
}

export async function notifyOwnerWhenUpcomingPick(activeTurnId?: string): Promise<UpcomingPickAlertResult> {
  const activeRows = activeTurnId
    ? await supabaseRest<TurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id", id: `eq.${activeTurnId}`, status: "eq.ACTIVE", limit: "1" } })
    : await supabaseRest<TurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id", status: "eq.ACTIVE", order: "global_pick.asc", limit: "1" } });
  const active = activeRows[0];
  if (!active || !active.id || !Number.isInteger(active.global_pick)) return { status: "SKIPPED", activeTurnId: activeTurnId ?? null, recipientOwnerId: null, detail: "no-active-turn" };

  const upcomingRows = await supabaseRest<TurnRow[]>("b36_draft_turns", { query: { select: "id,global_pick,round_number,owner_id", status: "eq.PENDING", global_pick: `gt.${active.global_pick}`, order: "global_pick.asc", limit: "1" } });
  const upcoming = upcomingRows[0];
  if (!upcoming || !upcoming.owner_id || !Number.isInteger(upcoming.global_pick) || !Number.isInteger(upcoming.round_number)) return { status: "SKIPPED", activeTurnId: active.id, recipientOwnerId: null, detail: "no-upcoming-turn" };

  const contacts = await supabaseRest<RegistrationContactRow[]>("b36_owner_registrations", { query: { select: "display_name,team_name,phone_e164", status: "eq.APPROVED", assigned_owner_id: `eq.${upcoming.owner_id}`, limit: "1" } });
  const contact = contacts[0];
  const recipient: UpcomingPickRecipient = {
    ownerId: upcoming.owner_id,
    displayName: contact?.display_name ?? "Owner",
    teamName: contact?.team_name ?? "36 Football program",
    phoneE164: contact?.phone_e164 ?? null,
    globalPick: upcoming.global_pick,
    roundNumber: upcoming.round_number,
  };

  const existing = await findDraftSmsAlert(active.id, recipient.ownerId);
  if (existing) return { status: "EXISTS", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: typeof existing.status === "string" ? existing.status.toLowerCase() : "recorded" };

  let alert: DraftSmsAlertRow | null;
  try {
    alert = await createDraftSmsAlert(active.id, recipient);
  } catch (error) {
    const concurrentAlert = await findDraftSmsAlert(active.id, recipient.ownerId);
    if (concurrentAlert) return { status: "EXISTS", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: concurrentAlert.status.toLowerCase() };
    throw error;
  }
  if (!alert) return { status: "FAILED", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: "alert-log-not-created" };
  if (!recipient.phoneE164) {
    await updateDraftSmsAlert(alert.id, "SKIPPED", { twilio_message_sid: null, error_message: "Approved registration has no textable phone number.", sent_at: null });
    return { status: "SKIPPED", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: "no-phone" };
  }

  const body = `🏈 36 Football — ON DECK: ${recipient.teamName}. The owner ahead is on the clock for Pick ${active.global_pick}. Your Pick ${recipient.globalPick} (Round ${recipient.roundNumber}) is next. You have this 10-minute clock to prepare: 36football.com/my-draft`;
  try {
    const sid = await sendDraftSms(recipient.phoneE164, body);
    await updateDraftSmsAlert(alert.id, "SENT", { twilio_message_sid: sid, error_message: null, sent_at: new Date().toISOString() });
    return { status: "SENT", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: sid };
  } catch (error) {
    await updateDraftSmsAlert(alert.id, "FAILED", { twilio_message_sid: null, error_message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown Twilio delivery failure.", sent_at: null });
    return { status: "FAILED", activeTurnId: active.id, recipientOwnerId: recipient.ownerId, detail: error instanceof Error ? error.message : "twilio-delivery-failed" };
  }
}

export async function notifyOwnerWhenUpcomingPickSafely(activeTurnId?: string) {
  try {
    return await notifyOwnerWhenUpcomingPick(activeTurnId);
  } catch (error) {
    console.error("[draft-sms-alert] unexpected alert error", error);
    return { status: "FAILED" as const, activeTurnId: activeTurnId ?? null, recipientOwnerId: null, detail: "unexpected-alert-error" };
  }
}
