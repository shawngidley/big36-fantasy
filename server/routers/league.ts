import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { positions, scoringEventTypes, type Position } from "../../drizzle/schema";
import { getAllDraftSlots, getDraftLotterySchedule, getOwnerDraftBoard, getDraftOwnerState, getDraftSlotByGroup, getDraftResearchCatalog, getLeagueSnapshot, getOrClaimOwner, getPublicDraftLottery, getScoreEvent, getScoringRulesForEvent } from "../league-data";
import { assertSchoolPositionAvailable, buildReversal, calculateEventScore, hasBalancedDraftAssignments, normalizeSchoolName } from "../league-scoring";
import { buildSerpentineTurns } from "../serpentine-draft";
import { assertInauguralDraftOrderCanBePublished, assertInauguralDraftRoundIsOpen, assertInauguralDraftWindow, inauguralDraftWindow } from "../../shared/draft-schedule";
import { q, supabaseRest, supabaseRpc } from "../supabase";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getSessionCookieOptions } from "../_core/cookies";
import { issueOwnerSession, OWNER_SESSION_COOKIE, OWNER_SESSION_MS } from "../commissioner-auth";
import { yearOneRules } from "../year-one-rules";
import { runGamedayRefresh } from "../gameday-refresh";
import { syncFbsPoolAndSchedule } from "../gameday-refresh";
import { decodeRegistrationLogo, hashRegistrationPin, normalizeRegistrationEmail, normalizeRegistrationPhone, verifyRegistrationPin } from "../registration";
import { storagePut } from "../storage";
import { notifyOwnerWhenUpcomingPickSafely, sendDraftSms } from "../draft-alerts";
import { activateNextPendingTurn } from "../draft-clock";
import { lotteryCommitment, LOTTERY_REVEAL_INTERVAL_SECONDS, secureShuffle } from "../draft-lottery";

const positionSchema = z.enum(positions);
const eventTypeSchema = z.enum(scoringEventTypes);
const uuid = z.string().uuid();
const asError = (error: unknown): never => { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The requested Big 36 action could not be completed." }); };
const registrationTable = "b36_owner_registrations";
const registrationInput = z.object({
  displayName: z.string().trim().min(2).max(120), teamName: z.string().trim().min(2).max(120), nickname: z.string().trim().max(80).nullable().optional(), programIdentity: z.string().trim().max(240).nullable().optional(), inspiration: z.string().trim().max(240).nullable().optional(), primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(), accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(), brandingNotes: z.string().trim().max(1000).nullable().optional(), rivalryPreference: z.string().trim().max(120).nullable().optional(), email: z.string().trim().email().max(254), phone: z.string().trim().min(10).max(32), pin: z.string().min(4).max(12), logoDataUrl: z.string().max(2_000_000).nullable().optional(),
});
const ownerProfileInput = z.object({
  displayName: z.string().trim().min(2).max(120),
  teamName: z.string().trim().min(2).max(120),
  nickname: z.string().trim().max(80).nullable().optional(),
  programIdentity: z.string().trim().max(240).nullable().optional(),
  inspiration: z.string().trim().max(240).nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  brandingNotes: z.string().trim().max(1000).nullable().optional(),
  rivalryPreference: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(10).max(32),
  currentPin: z.string().min(4).max(12).nullable().optional(),
  newPin: z.string().min(4).max(12).nullable().optional(),
  logoDataUrl: z.string().max(2_000_000).nullable().optional(),
});
const draftQueueUnitInput = z.object({ schoolName: z.string().trim().min(2).max(120), position: positionSchema });
type RegistrationRow = { id: string; display_name: string; team_name: string; nickname: string | null; program_identity: string | null; inspiration: string | null; primary_color: string | null; accent_color: string | null; branding_notes: string | null; rivalry_preference: string | null; email: string; phone_e164: string; logo_key: string | null; logo_url: string | null; status: "PENDING" | "APPROVED" | "DECLINED"; assigned_owner_id: string | null; review_note: string | null; created_at: string; reviewed_at: string | null };

export const leagueRouter = router({
  snapshot: publicProcedure.query(() => getLeagueSnapshot()),
  draftLottery: publicProcedure.query(() => getPublicDraftLottery()),
  draftLotterySchedule: publicProcedure.query(() => getDraftLotterySchedule()),
  registrationLanding: publicProcedure.query(() => supabaseRpc<{ approvedCount: number; capacity: number; registrationOpen: boolean }>("b36_registration_landing_status", {})),
  research: publicProcedure.input(z.object({ position: positionSchema.optional() }).optional()).query(({ input }) => getDraftResearchCatalog(input?.position)),
  owner: publicProcedure.input(z.object({ ownerId: uuid })).query(async ({ input }) => {
    const owner = (await getLeagueSnapshot()).owners.find(item => item.id === input.ownerId);
    if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Big 36 team not found." });
    return owner;
  }),
  submitRegistration: publicProcedure.input(registrationInput).mutation(async ({ input }) => {
    try {
      const email = normalizeRegistrationEmail(input.email); const phone = normalizeRegistrationPhone(input.phone);
      const logo = input.logoDataUrl ? decodeRegistrationLogo(input.logoDataUrl) : null;
      const storedLogo = logo ? await storagePut(`owner-registrations/${crypto.randomUUID()}.${logo.extension}`, logo.bytes, logo.contentType) : null;
      await supabaseRpc<string>("b36_submit_owner_registration", {
        p_display_name: input.displayName.trim(), p_team_name: input.teamName.trim(), p_nickname: input.nickname?.trim() || "", p_program_identity: input.programIdentity?.trim() || "", p_inspiration: input.inspiration?.trim() || "", p_primary_color: input.primaryColor ?? "", p_accent_color: input.accentColor ?? "", p_branding_notes: input.brandingNotes?.trim() || "", p_rivalry_preference: input.rivalryPreference?.trim() || "", p_email: email, p_phone_e164: phone, p_pin_hash: hashRegistrationPin(input.pin), p_logo_key: storedLogo?.key ?? "", p_logo_url: storedLogo?.url ?? "",
      });
      return { success: true as const };
    } catch (error) { asError(error); }
  }),
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    const email = normalizeRegistrationEmail(ctx.user.email ?? "");
    const registrations = await supabaseRest<RegistrationRow[]>(registrationTable, { query: { select: "id,display_name,team_name,nickname,program_identity,inspiration,primary_color,accent_color,branding_notes,rivalry_preference,email,phone_e164,logo_key,logo_url,status,assigned_owner_id,review_note,created_at,reviewed_at", email: q.eq(email), status: q.eq("APPROVED"), order: "reviewed_at.desc", limit: "1" } });
    const registration = registrations[0];
    if (!registration?.assigned_owner_id) throw new TRPCError({ code: "FORBIDDEN", message: "Your approved 36 Football program is not linked yet." });
    const owner = (await getLeagueSnapshot()).owners.find(item => item.id === registration.assigned_owner_id);
    return {
      registration: {
        id: registration.id,
        ownerId: registration.assigned_owner_id,
        displayName: registration.display_name,
        teamName: registration.team_name,
        nickname: registration.nickname,
        programIdentity: registration.program_identity,
        inspiration: registration.inspiration,
        primaryColor: registration.primary_color,
        accentColor: registration.accent_color,
        brandingNotes: registration.branding_notes,
        rivalryPreference: registration.rivalry_preference,
        email: registration.email,
        phone: registration.phone_e164,
        logoUrl: registration.logo_url,
      },
      owner: owner ?? null,
    };
  }),
  updateMyProfile: protectedProcedure.input(ownerProfileInput).mutation(async ({ ctx, input }) => {
    try {
      const email = normalizeRegistrationEmail(ctx.user.email ?? "");
      const registrations = await supabaseRest<Array<RegistrationRow & { pin_hash: string }>>(registrationTable, { query: { select: "id,display_name,team_name,nickname,program_identity,inspiration,primary_color,accent_color,branding_notes,rivalry_preference,email,phone_e164,logo_key,logo_url,status,assigned_owner_id,review_note,created_at,reviewed_at,pin_hash", email: q.eq(email), status: q.eq("APPROVED"), order: "reviewed_at.desc", limit: "1" } });
      const registration = registrations[0];
      if (!registration?.assigned_owner_id) throw new Error("Your approved 36 Football program is not linked yet.");
      const nextEmail = normalizeRegistrationEmail(input.email);
      const emailChanged = nextEmail !== email;
      if ((input.newPin || emailChanged) && (!input.currentPin || !verifyRegistrationPin(input.currentPin, registration.pin_hash))) throw new Error("Enter your current PIN before changing your email or PIN.");
      if (emailChanged) {
        const [registrationMatches, ownerMatches] = await Promise.all([
          supabaseRest<Array<{ id: string }>>(registrationTable, { query: { select: "id", email: q.eq(nextEmail) } }),
          supabaseRest<Array<{ id: string }>>("b36_owners", { query: { select: "id", email: q.eq(nextEmail) } }),
        ]);
        if (registrationMatches.some(item => item.id !== registration.id) || ownerMatches.some(item => item.id !== registration.assigned_owner_id)) throw new Error("That email is already associated with another 36 Football program.");
      }
      const snapshot = await getLeagueSnapshot();
      const duplicateTeam = snapshot.owners.find(owner => owner.id !== registration.assigned_owner_id && owner.teamName.trim().toLowerCase() === input.teamName.trim().toLowerCase());
      if (duplicateTeam) throw new Error("Another 36 Football program already uses that team name.");
      const logo = input.logoDataUrl ? decodeRegistrationLogo(input.logoDataUrl) : null;
      const storedLogo = logo ? await storagePut(`owner-profiles/${registration.assigned_owner_id}/${crypto.randomUUID()}.${logo.extension}`, logo.bytes, logo.contentType) : null;
      const values = {
        display_name: input.displayName.trim(), team_name: input.teamName.trim(), nickname: input.nickname?.trim() || null, program_identity: input.programIdentity?.trim() || null,
        inspiration: input.inspiration?.trim() || null, primary_color: input.primaryColor ?? null, accent_color: input.accentColor ?? null,
        branding_notes: input.brandingNotes?.trim() || null, rivalry_preference: input.rivalryPreference?.trim() || null,
        phone_e164: normalizeRegistrationPhone(input.phone), ...(storedLogo ? { logo_key: storedLogo.key, logo_url: storedLogo.url } : {}),
      };
      const now = new Date().toISOString();
      await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(registration.assigned_owner_id) }, body: { display_name: values.display_name, team_name: values.team_name, email: nextEmail, nickname: values.nickname, program_identity: values.program_identity, primary_color: values.primary_color, accent_color: values.accent_color, branding_notes: values.branding_notes, rivalry_preference: values.rivalry_preference, ...(storedLogo ? { logo_url: storedLogo.url } : {}) } });
      await supabaseRest(registrationTable, { method: "PATCH", query: { id: q.eq(registration.id) }, body: { ...values, email: nextEmail, ...(input.newPin ? { pin_hash: hashRegistrationPin(input.newPin) } : {}), updated_at: now } });
      let expiresAt: string | undefined;
      if (emailChanged) {
        await supabaseRest("b36_owner_sessions", { method: "PATCH", query: { registration_id: q.eq(registration.id), revoked_at: q.isNull }, body: { revoked_at: now }, prefer: "return=minimal" });
        const session = await issueOwnerSession(registration.id, registration.assigned_owner_id, nextEmail);
        ctx.res.cookie(OWNER_SESSION_COOKIE, session.token, { ...getSessionCookieOptions(ctx.req), maxAge: OWNER_SESSION_MS });
        expiresAt = session.expiresAt.toISOString();
      }
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "OWNER_PROFILE_UPDATED", entity_type: "b36_owners", entity_id: registration.assigned_owner_id, detail: { registration_id: registration.id, logo_updated: Boolean(storedLogo), pin_updated: Boolean(input.newPin), email_changed: emailChanged } } });
      return { success: true as const, emailChanged, expiresAt };
    } catch (error) { asError(error); }
  }),
  myDraftBoard: protectedProcedure.input(z.object({ position: positionSchema.optional() }).optional()).query(async ({ ctx, input }) => {
    const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Your approved program is not linked to a draft slot yet." });
    return getOwnerDraftBoard(owner.id, input?.position);
  }),
  addMyDraftQueueEntry: protectedProcedure.input(draftQueueUnitInput).mutation(async ({ ctx, input }) => {
    try {
      const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
      if (!owner) throw new Error("Your approved program is not linked to a draft slot yet.");
      const board = await getOwnerDraftBoard(owner.id, input.position);
      const normalizedSchool = input.schoolName.trim().toLowerCase();
      const unit = board.availableUnits.find(candidate => candidate.schoolName.trim().toLowerCase() === normalizedSchool && candidate.position === input.position);
      if (!unit) throw new Error("That school-position unit is no longer available.");
      if (!unit.canQueue) throw new Error(`You have already drafted your ${input.position === "K_ST" ? "K/ST" : input.position} unit.`);
      if (unit.isQueued) throw new Error("That unit is already in your draft queue.");
      const priority = Math.max(0, ...board.queue.map(entry => entry.priority)) + 1;
      const createdEntries = await supabaseRest<Array<{ id: string }>>("b36_draft_queue_entries", { method: "POST", body: { owner_id: owner.id, school_name: unit.schoolName, position: unit.position, priority } });
      const createdEntry = createdEntries[0];
      if (!createdEntry?.id) throw new Error("The draft queue entry could not be saved.");
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "OWNER_DRAFT_QUEUE_ADDED", entity_type: "b36_draft_queue_entries", entity_id: createdEntry.id, detail: { school_name: unit.schoolName, position: unit.position, priority } } });
      return { success: true as const };
    } catch (error) { asError(error); }
  }),
  removeMyDraftQueueEntry: protectedProcedure.input(z.object({ entryId: uuid })).mutation(async ({ ctx, input }) => {
    try {
      const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
      if (!owner) throw new Error("Your approved program is not linked to a draft slot yet.");
      const entries = await supabaseRest<Array<{ id: string }>>("b36_draft_queue_entries", { query: { select: "id", id: q.eq(input.entryId), owner_id: q.eq(owner.id), limit: "1" } });
      if (!entries[0]) throw new Error("That draft-queue entry is not available to remove.");
      await supabaseRest("b36_draft_queue_entries", { method: "DELETE", query: { id: q.eq(input.entryId), owner_id: q.eq(owner.id) } });
      return { success: true as const };
    } catch (error) { asError(error); }
  }),
  reorderMyDraftQueue: protectedProcedure.input(z.object({ entryIds: z.array(uuid).min(1).max(216) })).mutation(async ({ ctx, input }) => {
    try {
      const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
      if (!owner) throw new Error("Your approved program is not linked to a draft slot yet.");
      const entries = await supabaseRest<Array<{ id: string; priority: number }>>("b36_draft_queue_entries", { query: { select: "id,priority", owner_id: q.eq(owner.id), order: "priority.asc" } });
      const existingIds = new Set(entries.map(entry => entry.id));
      if (entries.length !== input.entryIds.length || input.entryIds.some(id => !existingIds.has(id)) || new Set(input.entryIds).size !== input.entryIds.length) throw new Error("Your queue changed in another session. Refresh it before reordering.");
      const now = new Date().toISOString();
      for (const entry of entries) await supabaseRest("b36_draft_queue_entries", { method: "PATCH", query: { id: q.eq(entry.id), owner_id: q.eq(owner.id) }, body: { priority: 10_000 + entry.priority, updated_at: now } });
      for (let index = 0; index < input.entryIds.length; index += 1) await supabaseRest("b36_draft_queue_entries", { method: "PATCH", query: { id: q.eq(input.entryIds[index]), owner_id: q.eq(owner.id) }, body: { priority: index + 1, updated_at: now } });
      return { success: true as const };
    } catch (error) { asError(error); }
  }),
  myDraft: protectedProcedure.query(({ ctx }) => getDraftOwnerState(ctx.user.openId, ctx.user.email)),
  submitMyPick: protectedProcedure.input(z.object({ position: positionSchema, schoolName: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
    const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Your email has not been assigned to a Big 36 owner record yet." });
    try {
      assertInauguralDraftWindow();
      const normalizedSchool = normalizeSchoolName(input.schoolName);
      const fbsPool = await supabaseRest<Array<{ school_name: string }>>("b36_fbs_schools", { query: { select: "school_name", season: q.eq(2026) } });
      if (!fbsPool.some(team => normalizeSchoolName(team.school_name).toLowerCase() === normalizedSchool.toLowerCase())) throw new Error("Choose a school from the official 2026 FBS pool.");
      const pick = await supabaseRpc<{ id: string; draft_position: number }>("b36_submit_serpentine_pick", { p_owner_open_id: ctx.user.openId, p_position: input.position, p_school_name: normalizedSchool });
      await supabaseRest("b36_draft_queue_entries", { method: "DELETE", query: { owner_id: q.eq(owner.id), position: q.eq(input.position) } });
      await notifyOwnerWhenUpcomingPickSafely();
      return { success: true as const, draftPosition: pick.draft_position };
    } catch (error) { asError(error); }
  }),
  admin: router({
    ownerRegistrations: adminProcedure.query(() => supabaseRest<RegistrationRow[]>(registrationTable, { query: { select: "id,display_name,team_name,nickname,program_identity,inspiration,primary_color,accent_color,branding_notes,rivalry_preference,email,phone_e164,logo_key,logo_url,status,assigned_owner_id,review_note,created_at,reviewed_at", order: "created_at.desc" } })),
    reviewOwnerRegistration: adminProcedure.input(z.object({ registrationId: uuid, status: z.enum(["APPROVED", "DECLINED"]), ownerId: uuid.nullable(), reviewNote: z.string().trim().max(1000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      try {
        const registrations = await supabaseRest<RegistrationRow[]>(registrationTable, { query: { select: "id,display_name,team_name,nickname,program_identity,inspiration,primary_color,accent_color,branding_notes,rivalry_preference,email,phone_e164,logo_key,logo_url,status,assigned_owner_id,review_note,created_at,reviewed_at", id: q.eq(input.registrationId), limit: "1" } });
        const registration = registrations[0];
        if (!registration) throw new Error("Registration not found.");
        if (registration.status !== "PENDING") throw new Error("This registration has already been reviewed.");
        if (input.status === "APPROVED") {
          if (!input.ownerId) throw new Error("Choose the program slot that this registration should claim.");
          const snapshot = await getLeagueSnapshot(); const owner = snapshot.owners.find(item => item.id === input.ownerId);
          if (!owner) throw new Error("Choose an existing 36 Football program slot.");
          const duplicateTeam = snapshot.owners.find(item => item.id !== owner.id && item.teamName.trim().toLowerCase() === registration.team_name.trim().toLowerCase());
          if (duplicateTeam) throw new Error("Another program already uses that team name.");
          await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(owner.id) }, body: { display_name: registration.display_name, team_name: registration.team_name, nickname: registration.nickname, program_identity: registration.program_identity, email: registration.email, logo_url: registration.logo_url, primary_color: registration.primary_color, accent_color: registration.accent_color, branding_notes: registration.branding_notes, rivalry_preference: registration.rivalry_preference } });
        }
        await supabaseRest(registrationTable, { method: "PATCH", query: { id: q.eq(registration.id) }, body: { status: input.status, assigned_owner_id: input.status === "APPROVED" ? input.ownerId : null, review_note: input.reviewNote ?? null, reviewed_by_open_id: ctx.user.openId, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: input.status === "APPROVED" ? "OWNER_REGISTRATION_APPROVED" : "OWNER_REGISTRATION_DECLINED", entity_type: registrationTable, entity_id: registration.id, detail: { owner_id: input.status === "APPROVED" ? input.ownerId : null } } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    resetOwnerPin: adminProcedure.input(z.object({ registrationId: uuid, newPin: z.string().min(4).max(12) })).mutation(async ({ ctx, input }) => {
      try {
        const registrations = await supabaseRest<RegistrationRow[]>(registrationTable, { query: { select: "id,display_name,team_name,email,assigned_owner_id,status", id: q.eq(input.registrationId), limit: "1" } });
        const registration = registrations[0];
        if (!registration) throw new Error("Registration not found.");
        if (registration.status !== "APPROVED" || !registration.assigned_owner_id) throw new Error("Only an approved owner registration can have its PIN reset.");
        const now = new Date().toISOString();
        await supabaseRest(registrationTable, { method: "PATCH", query: { id: q.eq(registration.id) }, body: { pin_hash: hashRegistrationPin(input.newPin), updated_at: now } });
        await supabaseRest("b36_owner_sessions", { method: "PATCH", query: { registration_id: q.eq(registration.id), revoked_at: q.isNull }, body: { revoked_at: now }, prefer: "return=minimal" });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "OWNER_PIN_RESET", entity_type: "b36_owners", entity_id: registration.assigned_owner_id, detail: { registration_id: registration.id } } });
        return { success: true as const, teamName: registration.team_name, displayName: registration.display_name };
      } catch (error) { asError(error); }
    }),
    sendTestDraftSms: adminProcedure.input(z.object({ phone: z.string().trim().min(10).max(32) })).mutation(async ({ input }) => {
      try {
        const phone = normalizeRegistrationPhone(input.phone);
        const body = `🏈 36 Football — TEST: This is a test of the draft on-deck alert. When it's really your turn, you'll get a text with this same link: 36football.com/my-draft`;
        const sid = await sendDraftSms(phone, body);
        return { success: true as const, sid };
      } catch (error) { asError(error); }
    }),
    sendWelcomeDraftSms: adminProcedure.mutation(async ({ ctx }) => {
      try {
        const registrations = await supabaseRest<Array<{ id: string; display_name: string; team_name: string; phone_e164: string | null; assigned_owner_id: string | null }>>(registrationTable, { query: { select: "id,display_name,team_name,phone_e164,assigned_owner_id", status: q.eq("APPROVED") } });
        const recipients = registrations.filter(registration => registration.assigned_owner_id && registration.phone_e164);
        const body = "🏈 Welcome to the 36 Football League! You'll get a text 10 minutes before your pick, with a link to your My Draft page. Can't pick during that window? No problem — return and pick anytime after. Thanks for being part of our inaugural season, and good luck! 36football.com/my-draft";
        const results = await Promise.allSettled(recipients.map(recipient => sendDraftSms(recipient.phone_e164!, body)));
        const sent = results.filter(result => result.status === "fulfilled").length;
        const failed = results.length - sent;
        const skipped = registrations.length - recipients.length;
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "WELCOME_SMS_BLAST", entity_type: registrationTable, entity_id: null, detail: { sent, failed, skipped, totalApproved: registrations.length } } });
        return { success: true as const, sent, failed, skipped };
      } catch (error) { asError(error); }
    }),
    initializeSixDivisions: adminProcedure.mutation(async ({ ctx }) => {
      const existing = await supabaseRest<Array<{ id: string }>>("b36_divisions", { query: { select: "id" } });
      if (existing.length) throw new TRPCError({ code: "CONFLICT", message: "Divisions are already configured." });
      await supabaseRest("b36_divisions", { method: "POST", body: Array.from({ length: 6 }, (_, index) => ({ name: `Division ${index + 1}`, sort_order: index + 1 })) });
      const rules = await supabaseRest<Array<{ id: string }>>("b36_scoring_rules", { query: { select: "id" } });
      if (!rules.length) await supabaseRest("b36_scoring_rules", { method: "POST", body: yearOneRules.map(rule => ({ label: rule.label, event_type: rule.eventType, position_scope: rule.positionScope, min_yards: rule.minYards, max_yards: rule.maxYards, flat_points: rule.flatPoints, points_per_unit: null, is_active: true })) });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "INITIALIZE_DIVISIONS", entity_type: "b36_divisions" } });
      return { success: true as const };
    }),
    generateSerpentineDraft: adminProcedure.input(z.object({ ownerOrder: z.array(uuid).length(36) })).mutation(async ({ ctx, input }) => {
      try {
        assertInauguralDraftOrderCanBePublished();
        if (new Set(input.ownerOrder).size !== 36) throw new Error("The serpentine order must contain 36 unique programs.");
        const snapshot = await getLeagueSnapshot();
        if (snapshot.owners.length !== 36 || input.ownerOrder.some(ownerId => !snapshot.owners.some(owner => owner.id === ownerId))) throw new Error("Create all 36 programs before generating the draft order.");
        if (snapshot.totals.draftPickCount) throw new Error("The serpentine order cannot be regenerated after the draft has started.");
        await Promise.all(input.ownerOrder.map((ownerId, index) => supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(ownerId) }, body: { draft_order: index + 1 } })));
        await supabaseRest("b36_draft_turns", { method: "DELETE", query: { id: "not.is.null" }, prefer: "return=minimal" });
        await supabaseRest("b36_draft_turns", { method: "POST", body: buildSerpentineTurns(input.ownerOrder).map(turn => ({ global_pick: turn.globalPick, round_number: turn.roundNumber, owner_id: turn.ownerId })) });
        await supabaseRest("b36_draft_state", { method: "PATCH", query: { id: q.eq(true) }, body: { status: "SETUP", active_turn_id: null, active_position: null, updated_at: new Date().toISOString(), updated_by_open_id: ctx.user.openId } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "GENERATE_SERPENTINE_DRAFT", entity_type: "b36_draft_turns", detail: { owner_order: input.ownerOrder } } });
      } catch (error) { asError(error); }
      return { success: true as const };
    }),
    startDraftLottery: adminProcedure.mutation(async ({ ctx }) => {
      try {
        assertInauguralDraftOrderCanBePublished();
        const schedule = await getDraftLotterySchedule();
        if (Date.now() < new Date(schedule.scheduledFor).getTime()) throw new Error(`The lottery is scheduled for ${new Date(schedule.scheduledFor).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" })} Eastern and still requires commissioner approval at that time.`);
        const snapshot = await getLeagueSnapshot();
        if (snapshot.owners.length !== 36) throw new Error("All 36 programs must be configured before the lottery can start.");
        if (snapshot.totals.draftPickCount) throw new Error("The draft lottery cannot start after a selection has been made.");
        const active = await supabaseRest<Array<{ id: string }>>("b36_draft_lotteries", { query: { select: "id", status: "in.(RUNNING,PAUSED)", limit: "1" } });
        if (active[0]) throw new Error("A draft lottery is already active. Pause, resume, or abort that draw before starting another.");
        const ownerOrder = secureShuffle(snapshot.owners.map(owner => owner.id));
        const now = new Date().toISOString();
        const commitment = lotteryCommitment(ownerOrder);
        const lottery = await supabaseRest<Array<{ id: string }>>("b36_draft_lotteries", { method: "POST", body: { status: "RUNNING", owner_order: ownerOrder, owner_snapshot: snapshot.owners.map(owner => ({ id: owner.id, teamName: owner.teamName, displayName: owner.displayName, nickname: owner.nickname, logoUrl: owner.logoUrl, primaryColor: null, accentColor: null })), order_commitment: commitment, reveal_interval_seconds: LOTTERY_REVEAL_INTERVAL_SECONDS, revealed_count: 0, started_at: now, elapsed_ms_before_pause: 0, created_by_open_id: ctx.user.openId, updated_at: now } });
        if (!lottery[0]?.id) throw new Error("The draft lottery could not be started.");
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_LOTTERY_STARTED", entity_type: "b36_draft_lotteries", entity_id: lottery[0].id, detail: { order_commitment: commitment, reveal_interval_seconds: LOTTERY_REVEAL_INTERVAL_SECONDS } } });
        return { success: true as const, lotteryId: lottery[0].id };
      } catch (error) { asError(error); }
    }),
    pauseDraftLottery: adminProcedure.mutation(async ({ ctx }) => {
      try {
        const running = await supabaseRest<Array<{ id: string; started_at: string | null; elapsed_ms_before_pause: number }>>("b36_draft_lotteries", { query: { select: "id,started_at,elapsed_ms_before_pause", status: q.eq("RUNNING"), order: "created_at.desc", limit: "1" } });
        const lottery = running[0];
        if (!lottery?.started_at) throw new Error("There is no running draft lottery to pause.");
        await supabaseRpc("b36_sync_draft_lottery", { p_lottery_id: lottery.id });
        const elapsed = Number(lottery.elapsed_ms_before_pause) + Math.max(0, Date.now() - new Date(lottery.started_at).getTime());
        const now = new Date().toISOString();
        await supabaseRest("b36_draft_lotteries", { method: "PATCH", query: { id: q.eq(lottery.id), status: q.eq("RUNNING") }, body: { status: "PAUSED", elapsed_ms_before_pause: elapsed, paused_at: now, updated_at: now } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_LOTTERY_PAUSED", entity_type: "b36_draft_lotteries", entity_id: lottery.id, detail: { elapsed_ms: elapsed } } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    resumeDraftLottery: adminProcedure.mutation(async ({ ctx }) => {
      try {
        const paused = await supabaseRest<Array<{ id: string }>>("b36_draft_lotteries", { query: { select: "id", status: q.eq("PAUSED"), order: "created_at.desc", limit: "1" } });
        const lottery = paused[0];
        if (!lottery) throw new Error("There is no paused draft lottery to resume.");
        const now = new Date().toISOString();
        await supabaseRest("b36_draft_lotteries", { method: "PATCH", query: { id: q.eq(lottery.id), status: q.eq("PAUSED") }, body: { status: "RUNNING", started_at: now, paused_at: null, updated_at: now } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_LOTTERY_RESUMED", entity_type: "b36_draft_lotteries", entity_id: lottery.id } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    abortDraftLottery: adminProcedure.input(z.object({ reason: z.string().trim().min(4).max(500) })).mutation(async ({ ctx, input }) => {
      try {
        const active = await supabaseRest<Array<{ id: string }>>("b36_draft_lotteries", { query: { select: "id", status: "in.(RUNNING,PAUSED)", order: "created_at.desc", limit: "1" } });
        const lottery = active[0];
        if (!lottery) throw new Error("There is no active draft lottery to abort.");
        const now = new Date().toISOString();
        await supabaseRest("b36_draft_lotteries", { method: "PATCH", query: { id: q.eq(lottery.id) }, body: { status: "ABORTED", aborted_at: now, abort_reason: input.reason, updated_at: now } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_LOTTERY_ABORTED", entity_type: "b36_draft_lotteries", entity_id: lottery.id, detail: { reason: input.reason } } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    startSerpentineDraft: adminProcedure.mutation(async ({ ctx }) => {
      try {
        await syncFbsPoolAndSchedule(2026);
        const pending = await supabaseRest<Array<{ id: string; round_number: number }>>("b36_draft_turns", { query: { select: "id,round_number", status: q.eq("PENDING"), order: "global_pick.asc", limit: "1" } });
        if (!pending[0]) throw new Error("Generate a serpentine draft order before opening the draft.");
        assertInauguralDraftRoundIsOpen(pending[0].round_number);
        const now = new Date(); const expiresAt = new Date(now.getTime() + 600_000).toISOString();
        await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(pending[0].id) }, body: { status: "ACTIVE", opened_at: now.toISOString(), expires_at: expiresAt } });
        await supabaseRest("b36_draft_state", { method: "PATCH", query: { id: q.eq(true) }, body: { status: "OPEN", active_turn_id: pending[0].id, active_position: null, updated_at: now.toISOString(), updated_by_open_id: ctx.user.openId } });
        await notifyOwnerWhenUpcomingPickSafely(pending[0].id);
      } catch (error) { asError(error); }
      return { success: true as const };
    }),
    setLiveAutomation: adminProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      await supabaseRest("b36_automation_config", { method: "PATCH", query: { id: q.eq(true) }, body: { enabled: input.enabled, updated_at: new Date().toISOString() } });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: input.enabled ? "ENABLE_LIVE_AUTOMATION" : "DISABLE_LIVE_AUTOMATION", entity_type: "b36_automation_config" } });
      return { success: true as const };
    }),
    runLiveRefreshNow: adminProcedure.mutation(async ({ ctx }) => {
      try {
        const result = await runGamedayRefresh({ force: true });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "RUN_LIVE_REFRESH", entity_type: "b36_automation_config", detail: result } });
        return { success: true as const, ...result };
      } catch (error) { asError(error); }
    }),
    upsertDivision: adminProcedure.input(z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(80), identity: z.string().trim().max(160).nullable().optional(), logoUrl: z.string().url().max(1000).nullable().optional(), sortOrder: z.number().int().min(1).max(6) })).mutation(async ({ ctx, input }) => {
      const values = { name: input.name, identity: input.identity ?? null, logo_url: input.logoUrl ?? null, sort_order: input.sortOrder };
      if (input.id) await supabaseRest("b36_divisions", { method: "PATCH", query: { id: q.eq(input.id) }, body: values });
      else {
        const divisions = await supabaseRest<Array<{ id: string }>>("b36_divisions", { query: { select: "id" } });
        if (divisions.length >= 6) throw new TRPCError({ code: "CONFLICT", message: "Big 36 is fixed at six divisions." });
        await supabaseRest("b36_divisions", { method: "POST", body: values });
      }
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SAVE_DIVISION", entity_type: "b36_divisions", entity_id: input.id ?? null } });
      return { success: true as const };
    }),
    upsertOwner: adminProcedure.input(z.object({ id: uuid.optional(), displayName: z.string().trim().min(2).max(120), teamName: z.string().trim().min(2).max(120), nickname: z.string().trim().max(80).nullable().optional(), programIdentity: z.string().trim().max(160).nullable().optional(), logoUrl: z.string().url().max(1000).nullable().optional(), email: z.string().trim().email().nullable().optional(), divisionId: uuid.nullable(), isCommissioner: z.boolean().optional() })).mutation(async ({ ctx, input }) => {
      const values = { display_name: input.displayName, team_name: input.teamName, nickname: input.nickname ?? null, program_identity: input.programIdentity ?? null, logo_url: input.logoUrl ?? null, email: input.email?.toLowerCase() ?? null, division_id: input.divisionId, is_commissioner: input.isCommissioner ?? false };
      try {
        const snapshot = await getLeagueSnapshot();
        const existingOwner = input.id ? snapshot.owners.find(owner => owner.id === input.id) : undefined;
        if (input.divisionId && existingOwner?.divisionId !== input.divisionId) {
          const targetDivision = snapshot.divisions.find(division => division.id === input.divisionId);
          if (!targetDivision) throw new Error("Choose one of the six configured Big 36 divisions.");
          if (targetDivision.owners.filter(owner => owner.id !== input.id).length >= 6) throw new Error("Each Big 36 division is limited to six owners.");
        }
        if (input.id) await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(input.id) }, body: values });
        else {
          if (snapshot.owners.length >= 36) throw new Error("Big 36 has reached its 36-owner limit.");
          await supabaseRest("b36_owners", { method: "POST", body: values });
        }
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SAVE_OWNER", entity_type: "b36_owners", entity_id: input.id ?? null } });
      } catch (error) { asError(error); }
      return { success: true as const };
    }),
    swapOwnerDivisions: adminProcedure.input(z.object({ ownerAId: uuid, ownerBId: uuid })).mutation(async ({ ctx, input }) => {
      if (input.ownerAId === input.ownerBId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose two different programs to swap." });
      try {
        const snapshot = await getLeagueSnapshot();
        const ownerA = snapshot.owners.find(owner => owner.id === input.ownerAId);
        const ownerB = snapshot.owners.find(owner => owner.id === input.ownerBId);
        if (!ownerA || !ownerB) throw new Error("Choose two existing Big 36 programs to swap.");
        await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(ownerA.id) }, body: { division_id: ownerB.divisionId } });
        await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(ownerB.id) }, body: { division_id: ownerA.divisionId } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SWAP_OWNER_DIVISIONS", entity_type: "b36_owners", entity_id: ownerA.id, detail: { swappedWith: ownerB.id } } });
      } catch (error) { asError(error); }
      return { success: true as const };
    }),
    saveDraftPlan: adminProcedure.input(z.object({ ownerId: uuid, assignments: z.array(z.object({ position: positionSchema, draftPosition: z.number().int().min(1).max(36) })).length(6) })).mutation(async ({ ctx, input }) => {
      if (!hasBalancedDraftAssignments(input.assignments)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every owner must have one draft slot per position and the six positions must total exactly 111." });
      try {
        const slots = await getAllDraftSlots();
        const conflict = slots.find(slot => slot.owner_id !== input.ownerId && input.assignments.some(assignment => assignment.position === slot.position && assignment.draftPosition === slot.draft_position));
        if (conflict) throw new Error(`Draft slot ${conflict.draft_position} for ${conflict.position} is already assigned.`);
        await supabaseRest("b36_draft_slots", { method: "DELETE", query: { owner_id: q.eq(input.ownerId) }, prefer: "return=minimal" });
        await supabaseRest("b36_draft_slots", { method: "POST", body: input.assignments.map(assignment => ({ owner_id: input.ownerId, position: assignment.position, draft_position: assignment.draftPosition })) });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SAVE_DRAFT_PLAN", entity_type: "b36_draft_slots", detail: { owner_id: input.ownerId } } });
      } catch (error) { asError(error); }
      return { success: true as const };
    }),
    setDraftState: adminProcedure.input(z.object({ status: z.enum(["SETUP", "OPEN", "PAUSED", "COMPLETE"]), activePosition: positionSchema.nullable() })).mutation(async ({ ctx, input }) => {
      await supabaseRest("b36_draft_state", { method: "PATCH", query: { id: q.eq(true) }, body: { status: input.status, active_position: input.status === "OPEN" ? input.activePosition : null, updated_at: new Date().toISOString(), updated_by_open_id: ctx.user.openId } });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SET_DRAFT_STATE", entity_type: "b36_draft_state", detail: { status: input.status, active_position: input.activePosition } } });
      return { success: true as const };
    }),
    clearDraftPick: adminProcedure.input(z.object({ globalPick: z.number().int().min(1).max(216) })).mutation(async ({ ctx, input }) => {
      try {
        const turns = await supabaseRest<Array<{ id: string; status: string; draft_slot_id: string | null; owner_id: string }>>("b36_draft_turns", { query: { select: "id,status,draft_slot_id,owner_id", global_pick: q.eq(input.globalPick), limit: "1" } });
        const turn = turns[0];
        if (!turn) throw new Error("No draft turn exists for that pick number.");
        if (turn.status !== "PICKED" || !turn.draft_slot_id) throw new Error("That pick has not been made yet, so there is nothing to clear.");
        const slots = await supabaseRest<Array<{ id: string; school_name: string | null; position: string }>>("b36_draft_slots", { query: { select: "id,school_name,position", id: q.eq(turn.draft_slot_id), limit: "1" } });
        const slot = slots[0];
        await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(turn.draft_slot_id) }, body: { school_name: null, selected_at: null, selected_by_open_id: null } });
        await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(turn.id) }, body: { status: "SKIPPED", picked_at: null, draft_slot_id: null, skipped_at: new Date().toISOString() } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_PICK_CLEARED", entity_type: "b36_draft_turns", entity_id: turn.id, detail: { globalPick: input.globalPick, clearedSchool: slot?.school_name ?? null, position: slot?.position ?? null, ownerId: turn.owner_id } } });
        return { success: true as const, clearedSchool: slot?.school_name ?? null, position: slot?.position ?? null };
      } catch (error) { asError(error); }
    }),
    recordDraftPick: adminProcedure.input(z.object({ ownerId: uuid, position: positionSchema, schoolName: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
      try {
        const slots = await getAllDraftSlots();
        const target = slots.find(slot => slot.owner_id === input.ownerId && slot.position === input.position);
        if (!target) throw new Error("This owner has no approved draft slot for that position.");
        assertSchoolPositionAvailable(slots.filter(slot => slot.school_name).map(slot => ({ ownerId: slot.owner_id as unknown as number, schoolName: slot.school_name!, position: slot.position })), { ownerId: input.ownerId as unknown as number, schoolName: input.schoolName, position: input.position });
        const now = new Date().toISOString();
        await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(target.id) }, body: { school_name: normalizeSchoolName(input.schoolName), selected_at: now, selected_by_open_id: ctx.user.openId } });
        await supabaseRest("b36_draft_queue_entries", { method: "DELETE", query: { owner_id: q.eq(input.ownerId), position: q.eq(input.position) } });
        const ownerTurns = await supabaseRest<Array<{ id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; global_pick: number }>>("b36_draft_turns", { query: { select: "id,status,global_pick", owner_id: q.eq(input.ownerId), status: "in.(SKIPPED,ACTIVE)" } });
        const skippedTurn = ownerTurns.find(turn => turn.status === "SKIPPED");
        const activeTurn = ownerTurns.find(turn => turn.status === "ACTIVE");
        const turnToResolve = skippedTurn ?? activeTurn;
        if (turnToResolve) {
          const now2 = new Date();
          await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(turnToResolve.id) }, body: { status: "PICKED", picked_at: now, draft_slot_id: target.id, expires_at: null } });
          if (turnToResolve === activeTurn) await activateNextPendingTurn(now2, inauguralDraftWindow(now2));
        }
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "ADMIN_DRAFT_OVERRIDE", entity_type: "b36_draft_slots", entity_id: target.id, detail: { resolvedTurnId: turnToResolve?.id ?? null } } });
        return { success: true as const, draftPosition: target.draft_position };
      } catch (error) { asError(error); }
    }),
    createWeek: adminProcedure.input(z.object({ weekNumber: z.number().int().min(1).max(20), label: z.string().trim().min(2).max(80), status: z.enum(["UPCOMING", "OPEN", "FINAL"]).default("UPCOMING") })).mutation(async ({ ctx, input }) => {
      await supabaseRest("b36_scoring_weeks", { method: "POST", body: { week_number: input.weekNumber, label: input.label, status: input.status } });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "CREATE_WEEK", entity_type: "b36_scoring_weeks" } });
      return { success: true as const };
    }),
    upsertRule: adminProcedure.input(z.object({ id: uuid.optional(), label: z.string().trim().min(3).max(120), eventType: eventTypeSchema, positionScope: z.enum(["ALL", ...positions]), minYards: z.number().int().min(0).max(109).nullable(), maxYards: z.number().int().min(0).max(109).nullable(), flatPoints: z.number().min(-100).max(100).nullable(), pointsPerUnit: z.number().min(-10).max(10).nullable(), isActive: z.enum(["true", "false"]).default("true") }).refine(value => value.flatPoints !== null || value.pointsPerUnit !== null, { message: "Set either flat points or points per unit." })).mutation(async ({ ctx, input }) => {
      const values = { label: input.label, event_type: input.eventType, position_scope: input.positionScope, min_yards: input.minYards, max_yards: input.maxYards, flat_points: input.flatPoints, points_per_unit: input.pointsPerUnit, is_active: input.isActive === "true" };
      if (input.id) await supabaseRest("b36_scoring_rules", { method: "PATCH", query: { id: q.eq(input.id) }, body: values });
      else await supabaseRest("b36_scoring_rules", { method: "POST", body: values });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "SAVE_SCORING_RULE", entity_type: "b36_scoring_rules", entity_id: input.id ?? null } });
      return { success: true as const };
    }),
    recordScoreEvent: adminProcedure.input(z.object({ weekId: uuid, schoolName: z.string().trim().min(2).max(120), position: positionSchema, eventType: eventTypeSchema, statValue: z.number().min(-10000).max(10000), yardDistance: z.number().int().min(0).max(109).nullable(), note: z.string().trim().max(1000).nullable() })).mutation(async ({ ctx, input }) => {
      try {
        const slot = await getDraftSlotByGroup(normalizeSchoolName(input.schoolName), input.position);
        const score = calculateEventScore(await getScoringRulesForEvent(input.eventType), input);
        await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: input.weekId, draft_slot_id: slot.id, event_type: input.eventType, stat_value: input.statValue, yard_distance: input.yardDistance, computed_points: score.points, note: input.note, audit_action: "ENTRY", recorded_by_open_id: ctx.user.openId } });
        return { success: true as const, points: score.points };
      } catch (error) { asError(error); }
    }),
    reverseScoreEvent: adminProcedure.input(z.object({ eventId: uuid, reason: z.string().trim().min(4).max(1000) })).mutation(async ({ ctx, input }) => {
      try {
        const original = await getScoreEvent(input.eventId);
        const reversal = buildReversal({ id: 1, statValue: original.stat_value, computedPoints: original.computed_points });
        await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: original.week_id, draft_slot_id: original.draft_slot_id, event_type: original.event_type, stat_value: reversal.statValue, yard_distance: original.yard_distance, computed_points: reversal.computedPoints, note: input.reason, audit_action: reversal.auditAction, correction_of_event_id: original.id, recorded_by_open_id: ctx.user.openId } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
  }),
});
