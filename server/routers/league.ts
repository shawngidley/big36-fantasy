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
import { adaptLiveGameToLegacyPlays } from "../gameday-refresh";
import { boxScoreFumbleCandidates, isSupersededInterceptionPlay, mapLivePlayToCandidates, matchBoxAthleteToRoster, type LivePosition } from "../live-scoring";
import { decodeRegistrationLogo, hashRegistrationPin, normalizeRegistrationEmail, normalizeRegistrationPhone, verifyRegistrationPin } from "../registration";
import { storagePut } from "../storage";
import { notifyOwnerWhenUpcomingPickSafely, sendDraftSms } from "../draft-alerts";
import { activateNextPendingTurn } from "../draft-clock";
import { getGamePlayerStats, getLivePlays, getLiveScoreboard, getRegularSeasonGames, getRoster, getWeekPlays, getWeekPlayStats } from "../cfbd";
import { lotteryCommitment, LOTTERY_REVEAL_INTERVAL_SECONDS, secureShuffle } from "../draft-lottery";

const positionSchema = z.enum(positions);
const positionOrder = ["QB", "RB", "WR", "TE", "K/ST", "DEF"];
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
  pressBoxArticles: publicProcedure.query(() => supabaseRest<Array<{ id: string; title: string; column_type: string; author_name: string; content: string; created_at: string }>>("b36_press_box_articles", { query: { select: "id,title,column_type,author_name,content,created_at", published: q.eq(true), order: "created_at.desc" } })),
  verifyPressBoxWriter: publicProcedure.input(z.object({ passphrase: z.string().trim().min(1).max(200) })).query(async ({ input }) => {
    const rows = await supabaseRest<Array<{ writer_name: string; column_type: string }>>("b36_press_box_writers", { query: { select: "writer_name,column_type", passphrase: q.eq(input.passphrase), active: q.eq(true), limit: "1" } });
    const writer = rows[0];
    if (!writer) return null;
    return { writerName: writer.writer_name, columnType: writer.column_type };
  }),
  submitPressBoxArticle: publicProcedure.input(z.object({ passphrase: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(50000) })).mutation(async ({ input }) => {
    const rows = await supabaseRest<Array<{ writer_name: string; column_type: string }>>("b36_press_box_writers", { query: { select: "writer_name,column_type", passphrase: q.eq(input.passphrase), active: q.eq(true), limit: "1" } });
    const writer = rows[0];
    if (!writer) throw new Error("Invalid or expired access code.");
    const now = new Date().toISOString();
    await supabaseRest("b36_press_box_articles", { method: "POST", body: { title: input.title, column_type: writer.column_type, author_name: writer.writer_name, content: input.content, published: true, created_at: now, updated_at: now } });
    return { success: true as const };
  }),
  updateOwnPressBoxArticle: publicProcedure.input(z.object({ passphrase: z.string().trim().min(1).max(200), id: uuid, title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(50000) })).mutation(async ({ input }) => {
    const writerRows = await supabaseRest<Array<{ writer_name: string; column_type: string }>>("b36_press_box_writers", { query: { select: "writer_name,column_type", passphrase: q.eq(input.passphrase), active: q.eq(true), limit: "1" } });
    const writer = writerRows[0];
    if (!writer) throw new Error("Invalid or expired access code.");
    const articleRows = await supabaseRest<Array<{ column_type: string }>>("b36_press_box_articles", { query: { select: "column_type", id: q.eq(input.id), limit: "1" } });
    if (articleRows[0]?.column_type !== writer.column_type) throw new Error("You can only edit columns in your own section.");
    await supabaseRest("b36_press_box_articles", { method: "PATCH", query: { id: q.eq(input.id) }, body: { title: input.title, content: input.content, updated_at: new Date().toISOString() } });
    return { success: true as const };
  }),
  deleteOwnPressBoxArticle: publicProcedure.input(z.object({ passphrase: z.string().trim().min(1).max(200), id: uuid })).mutation(async ({ input }) => {
    const writerRows = await supabaseRest<Array<{ writer_name: string; column_type: string }>>("b36_press_box_writers", { query: { select: "writer_name,column_type", passphrase: q.eq(input.passphrase), active: q.eq(true), limit: "1" } });
    const writer = writerRows[0];
    if (!writer) throw new Error("Invalid or expired access code.");
    const articleRows = await supabaseRest<Array<{ column_type: string }>>("b36_press_box_articles", { query: { select: "column_type", id: q.eq(input.id), limit: "1" } });
    if (articleRows[0]?.column_type !== writer.column_type) throw new Error("You can only delete columns in your own section.");
    await supabaseRest("b36_press_box_articles", { method: "DELETE", query: { id: q.eq(input.id) } });
    return { success: true as const };
  }),
  liveScores: publicProcedure.input(z.object({ scope: z.enum(["league", "all"]).default("league"), week: z.number().int().min(0).max(20).optional(), ownerId: uuid.optional() }).optional()).query(async ({ input }) => {
    const asText = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
    const asNumber = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
      return null;
    };
    const sumLineScores = (value: unknown): number | null => Array.isArray(value) ? value.reduce((sum: number | null, entry) => { const n = asNumber(entry); return n === null ? sum : (sum ?? 0) + n; }, null) : null;
    const [scoreboard, league, automationRows] = await Promise.all([getLiveScoreboard(), getLeagueSnapshot(), supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } })]);
    const season = automationRows[0]?.season;
    const scheduleGames = season ? await getRegularSeasonGames(season) : [];
    const scoreboardById = new Map(scoreboard.filter(game => game.id != null).map(game => [game.id, game]));
    const ownersBySchool = new Map<string, Array<{ teamName: string; position: string }>>();
    for (const owner of league.owners) for (const pick of owner.picks) {
      const key = pick.schoolName.toLowerCase();
      if (!ownersBySchool.has(key)) ownersBySchool.set(key, []);
      ownersBySchool.get(key)!.push({ teamName: owner.teamName, position: pick.position === "K_ST" ? "K/ST" : pick.position });
    }
    Array.from(ownersBySchool.values()).forEach(list => list.sort((a, b) => positionOrder.indexOf(a.position) - positionOrder.indexOf(b.position)));
    const availableWeeks = Array.from(new Set(scheduleGames.map(game => game.week))).sort((a, b) => a - b);
    const now = Date.now();
    const currentWeek = availableWeeks.reduce((best, week) => scheduleGames.some(game => game.week === week && new Date(game.startDate).getTime() <= now) ? week : best, availableWeeks[0] ?? 1);
    const targetWeek = input?.week ?? currentWeek;
    const weekGames = scheduleGames.filter(game => game.week === targetWeek);
    const resolved = weekGames.map(game => {
      const live = scoreboardById.get(game.id);
      // The live scoreboard nests team info under homeTeam/awayTeam objects with full mascot names
      // (e.g. "TCU Horned Frogs") that won't match drafted school names (e.g. "TCU"). The season
      // schedule uses the short names owners actually drafted, so that stays the source of truth
      // for names/matching — only points and quarter-by-quarter scores are read from the live side.
      const homeTeam = asText(game.homeTeam) ?? asText(live?.homeTeam?.name) ?? "TBD";
      const awayTeam = asText(game.awayTeam) ?? asText(live?.awayTeam?.name) ?? "TBD";
      const status = asText(live?.status) ?? (game.completed ? "completed" : "scheduled");
      return {
        id: game.id, week: game.week, startDate: game.startDate, status,
        period: asNumber(live?.period), clock: asText(live?.clock),
        homeTeam, awayTeam,
        homePoints: asNumber(live?.homeTeam?.points) ?? sumLineScores(live?.homeTeam?.lineScores) ?? asNumber(game.homePoints) ?? 0,
        awayPoints: asNumber(live?.awayTeam?.points) ?? sumLineScores(live?.awayTeam?.lineScores) ?? asNumber(game.awayPoints) ?? 0,
      };
    });
    const myOwner = input?.ownerId ? league.owners.find(owner => owner.id === input.ownerId) : undefined;
    const mySchools = new Set((myOwner?.picks ?? []).map(pick => pick.schoolName.toLowerCase()));
    const scoped = myOwner
      ? resolved.filter(game => mySchools.has(game.homeTeam.toLowerCase()) || mySchools.has(game.awayTeam.toLowerCase()))
      : input?.scope === "all" ? resolved : resolved.filter(game => ownersBySchool.has(game.homeTeam.toLowerCase()) || ownersBySchool.has(game.awayTeam.toLowerCase()));
    const games = scoped
      .map(game => ({ ...game, homeOwners: ownersBySchool.get(game.homeTeam.toLowerCase()) ?? [], awayOwners: ownersBySchool.get(game.awayTeam.toLowerCase()) ?? [] }))
      .sort((a, b) => (a.status === "in_progress" ? 0 : 1) - (b.status === "in_progress" ? 0 : 1) || new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    return { week: targetWeek, currentWeek, availableWeeks, games };
  }),
  gameDetail: publicProcedure.input(z.object({ gameId: z.number(), week: z.number() })).query(async ({ input }) => {
    const [live, league] = await Promise.all([getLivePlays(input.gameId), getLeagueSnapshot()]);
    const ownersBySchool = new Map<string, Array<{ teamName: string; position: string }>>();
    for (const owner of league.owners) for (const pick of owner.picks) {
      const key = pick.schoolName.toLowerCase();
      if (!ownersBySchool.has(key)) ownersBySchool.set(key, []);
      ownersBySchool.get(key)!.push({ teamName: owner.teamName, position: pick.position === "K_ST" ? "K/ST" : pick.position });
    }
    Array.from(ownersBySchool.values()).forEach(list => list.sort((a, b) => positionOrder.indexOf(a.position) - positionOrder.indexOf(b.position)));
    // Plays are nested under each drive, in chronological order. Flatten them, and figure out the
    // defense for each play as "whichever of the two teams isn't currently on offense" — the live
    // feed only labels the team running the play, not who's defending.
    const teamNames = (live?.teams ?? []).map(team => team.team);
    // A raw score-delta comparison (does the running score change on this play?) sounds reasonable
    // but isn't - it catches drive-ending turnovers, penalty-adjustment plays, and the play right
    // after a real score, none of which are themselves a score. This checks the play's own text
    // directly for exactly the four scoring types requested: touchdowns, made extra points, made
    // field goals, and safeties - with negative guards so a missed/blocked attempt doesn't count.
    const isActualScoringPlay = (playType: string, playText: string) => {
      const type = (playType ?? "").toLowerCase();
      const text = (playText ?? "").toLowerCase();
      const failed = /(no good|missed|blocked|incomplete|fail)/.test(`${type} ${text}`);
      if (/touchdown/.test(`${type} ${text}`)) return true;
      if (!failed && (text.includes("field goal") || type.includes("field goal")) && (text.includes("good") || type.includes("good"))) return true;
      if (!failed && (text.includes("kick attempt good") || text.includes("kick is good") || type.includes("extra point") || type.includes("pat"))) return true;
      if (!failed && (/two.point conversion/.test(type) || /two.point conversion/.test(text) || /two point (pass|rush)/.test(type))) return true;
      if (text.includes("safety")) return true;
      return false;
    };
    const plays = (live?.drives ?? []).flatMap(drive => drive.plays).map(play => {
      const defense = teamNames.find(name => name !== play.team) ?? "";
      return {
        id: play.id, period: play.period ?? null, clock: play.clock || null,
        offense: play.team, defense,
        playType: play.playType ?? "Play", playText: play.playText ?? "", scoring: isActualScoringPlay(play.playType ?? "", play.playText ?? ""),
        offenseOwners: ownersBySchool.get(play.team.toLowerCase()) ?? [],
        defenseOwners: ownersBySchool.get(defense.toLowerCase()) ?? [],
      };
    });
    return plays;
  }),
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
  teamBranding: publicProcedure.input(z.object({ ownerId: uuid })).query(async ({ input }) => {
    const registrations = await supabaseRest<Array<{ nickname: string | null; program_identity: string | null; inspiration: string | null; rivalry_preference: string | null; logo_url: string | null }>>(registrationTable, { query: { select: "nickname,program_identity,inspiration,rivalry_preference,logo_url", assigned_owner_id: q.eq(input.ownerId), status: q.eq("APPROVED"), limit: "1" } });
    const registration = registrations[0];
    if (!registration) return null;
    return { nickname: registration.nickname, programIdentity: registration.program_identity, inspiration: registration.inspiration, rivalryPreference: registration.rivalry_preference, logoUrl: registration.logo_url };
  }),
  futureIdeas: protectedProcedure.query(() => supabaseRest<Array<{ id: string; title: string; content: string; submitted_by_team_name: string | null; created_at: string }>>("b36_future_ideas", { query: { select: "id,title,content,submitted_by_team_name,created_at", is_owner_submitted: q.eq(true), order: "created_at.desc" } })),
  submitFutureIdea: protectedProcedure.input(z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    try {
      const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
      if (!owner) throw new Error("Your approved program is not linked to a draft slot yet.");
      const now = new Date().toISOString();
      await supabaseRest("b36_future_ideas", { method: "POST", body: { title: input.title, season: "Owner suggestions", status: "SUBMITTED", content: input.content, created_by_open_id: ctx.user.openId, submitted_by_owner_id: owner.id, submitted_by_team_name: owner.teamName, is_owner_submitted: true, created_at: now, updated_at: now } });
      return { success: true as const };
    } catch (error) { asError(error); }
  }),
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
    allPressBoxWriters: adminProcedure.query(() => supabaseRest<Array<{ id: string; writer_name: string; column_type: string; passphrase: string; active: boolean; created_at: string }>>("b36_press_box_writers", { query: { select: "*", order: "created_at.desc" } })),
    createPressBoxWriter: adminProcedure.input(z.object({ writerName: z.string().trim().min(1).max(100), columnType: z.enum(["monday_recap", "wednesday_mike_drop", "friday_preview"]), passphrase: z.string().trim().min(4).max(200) })).mutation(async ({ input }) => {
      await supabaseRest("b36_press_box_writers", { method: "POST", body: { writer_name: input.writerName, column_type: input.columnType, passphrase: input.passphrase, active: true } });
      return { success: true as const };
    }),
    updatePressBoxWriter: adminProcedure.input(z.object({ id: uuid, writerName: z.string().trim().min(1).max(100), columnType: z.enum(["monday_recap", "wednesday_mike_drop", "friday_preview"]), passphrase: z.string().trim().min(4).max(200), active: z.boolean() })).mutation(async ({ input }) => {
      await supabaseRest("b36_press_box_writers", { method: "PATCH", query: { id: q.eq(input.id) }, body: { writer_name: input.writerName, column_type: input.columnType, passphrase: input.passphrase, active: input.active } });
      return { success: true as const };
    }),
    deletePressBoxWriter: adminProcedure.input(z.object({ id: uuid })).mutation(async ({ input }) => {
      await supabaseRest("b36_press_box_writers", { method: "DELETE", query: { id: q.eq(input.id) } });
      return { success: true as const };
    }),
    allPressBoxArticles: adminProcedure.query(() => supabaseRest<Array<{ id: string; title: string; column_type: string; author_name: string; content: string; published: boolean; created_at: string; updated_at: string }>>("b36_press_box_articles", { query: { select: "*", order: "created_at.desc" } })),
    createPressBoxArticle: adminProcedure.input(z.object({ title: z.string().trim().min(1).max(200), columnType: z.enum(["monday_recap", "wednesday_mike_drop", "friday_preview"]), authorName: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(50000) })).mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      await supabaseRest("b36_press_box_articles", { method: "POST", body: { title: input.title, column_type: input.columnType, author_name: input.authorName, content: input.content, published: true, created_by_open_id: ctx.user.openId, created_at: now, updated_at: now } });
      return { success: true as const };
    }),
    updatePressBoxArticle: adminProcedure.input(z.object({ id: uuid, title: z.string().trim().min(1).max(200), columnType: z.enum(["monday_recap", "wednesday_mike_drop", "friday_preview"]), authorName: z.string().trim().min(1).max(100), content: z.string().trim().min(1).max(50000), published: z.boolean() })).mutation(async ({ input }) => {
      await supabaseRest("b36_press_box_articles", { method: "PATCH", query: { id: q.eq(input.id) }, body: { title: input.title, column_type: input.columnType, author_name: input.authorName, content: input.content, published: input.published, updated_at: new Date().toISOString() } });
      return { success: true as const };
    }),
    deletePressBoxArticle: adminProcedure.input(z.object({ id: uuid })).mutation(async ({ input }) => {
      await supabaseRest("b36_press_box_articles", { method: "DELETE", query: { id: q.eq(input.id) } });
      return { success: true as const };
    }),
    debugRawScoreboard: adminProcedure.query(async () => {
      const scoreboard = await getLiveScoreboard();
      return scoreboard.filter(game => game.status === "in_progress");
    }),
    debugRawPlays: adminProcedure.input(z.object({ week: z.number(), gameId: z.number().optional(), team: z.string().optional() })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const plays = await getWeekPlays(season, input.week);
      if (input.gameId) return plays.filter(play => play.gameId === input.gameId);
      if (input.team) return plays.filter(play => play.offense?.toLowerCase().includes(input.team!.toLowerCase()) || play.defense?.toLowerCase().includes(input.team!.toLowerCase()));
      return { totalPlays: plays.length, sample: plays.slice(0, 5), uniqueGameIds: Array.from(new Set(plays.map(play => play.gameId))).slice(0, 100) };
    }),
    debugRawPlayStats: adminProcedure.input(z.object({ week: z.number(), playId: z.number().optional(), statTypeSearch: z.string().optional() })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const stats = await getWeekPlayStats(season, input.week);
      if (input.playId) return stats.filter(stat => String(stat.playId) === String(input.playId));
      if (input.statTypeSearch) {
        const term = input.statTypeSearch.toLowerCase();
        const matches = stats.filter(stat => stat.statType.toLowerCase().includes(term));
        return { totalStatsThisWeek: stats.length, matchCount: matches.length, sample: matches.slice(0, 20), uniqueStatTypesOverall: Array.from(new Set(stats.map(stat => stat.statType))) };
      }
      return { totalStatsThisWeek: stats.length, uniqueStatTypes: Array.from(new Set(stats.map(stat => stat.statType))) };
    }),
    debugGamePlayerStats: adminProcedure.input(z.object({ week: z.number(), team: z.string() })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      return getGamePlayerStats(season, input.week, input.team);
    }),
    debugSlotSummary: adminProcedure.input(z.object({ gameId: z.number(), school: z.string() })).query(async ({ input }) => {
      const league = await getLeagueSnapshot();
      const slots = league.owners.flatMap(owner => owner.picks.filter(pick => pick.schoolName === input.school).map(pick => ({ position: pick.position, draftSlotId: pick.id, teamName: owner.teamName })));
      const results: Array<Record<string, unknown>> = [];
      for (const slot of slots) {
        const rows = await supabaseRest<Array<{ id: string; event_type: string; computed_points: number; audit_action: string; recorded_by_open_id: string; is_provisional: boolean; source_event_key: string | null; correction_of_event_id: string | null }>>("b36_scoring_events", { query: { select: "id,event_type,computed_points,audit_action,recorded_by_open_id,is_provisional,source_event_key,correction_of_event_id", draft_slot_id: q.eq(slot.draftSlotId), source_game_id: q.eq(input.gameId) } });
        const reversedIds = new Set(rows.filter(row => row.audit_action === "REVERSAL" && row.correction_of_event_id).map(row => row.correction_of_event_id));
        const active = rows.filter(row => row.audit_action !== "REVERSAL" && !reversedIds.has(row.id));
        const netTotal = rows.reduce((sum, row) => sum + row.computed_points, 0);
        results.push({ position: slot.position, teamName: slot.teamName, netTotal, activeEntryCount: active.length, activeEntries: active.map(row => ({ eventType: row.event_type, points: row.computed_points, key: row.source_event_key, official: !row.is_provisional })), totalRowCount: rows.length });
      }
      return results;
    }),
    debugRosterSearch: adminProcedure.input(z.object({ school: z.string(), search: z.string().optional() })).query(async ({ input }) => {
      const season = (await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } }))[0]?.season ?? new Date().getFullYear();
      const roster = await getRoster(input.school, season);
      const filtered = input.search ? roster.filter(athlete => `${athlete.firstName ?? ""} ${athlete.lastName ?? ""}`.toLowerCase().includes(input.search!.toLowerCase())) : roster;
      return { rosterSize: roster.length, matches: filtered.map(athlete => ({ id: athlete.id, firstName: athlete.firstName, lastName: athlete.lastName, position: athlete.position })) };
    }),
    debugLivePlays: adminProcedure.input(z.object({ gameId: z.number() })).query(({ input }) => getLivePlays(input.gameId)),
    debugLiveCandidates: adminProcedure.input(z.object({ gameId: z.number(), school: z.string() })).query(async ({ input }) => {
      const [live, league] = await Promise.all([getLivePlays(input.gameId), getLeagueSnapshot()]);
      const selectedSchoolPositions = league.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as never })));
      const roster = await getRoster(input.school, (await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } }))[0]?.season ?? new Date().getFullYear());
      const legacyPlays = adaptLiveGameToLegacyPlays(input.gameId, live);
      const schoolPlays = legacyPlays.filter(play => play.offense === input.school);
      const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: [], roster, selectedSchoolPositions, provisional: true }));
      return { totalLegacyPlays: legacyPlays.length, schoolPlays: schoolPlays.length, scoringPlays: schoolPlays.filter(p => p.scoring), rosterSize: roster.length, rosterSample: roster.slice(0, 3), candidates };
    }),
    debugFinalCandidates: adminProcedure.input(z.object({ gameId: z.number(), school: z.string(), week: z.number() })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const [plays, stats, league] = await Promise.all([getWeekPlays(season, input.week), getWeekPlayStats(season, input.week), getLeagueSnapshot()]);
      const selectedSchoolPositions = league.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as never })));
      const roster = await getRoster(input.school, season);
      const gamePlays = plays.filter(play => play.gameId === input.gameId);
      const schoolPlays = gamePlays.filter((play, index) => play.offense === input.school && !isSupersededInterceptionPlay(play, gamePlays[index + 1]));
      const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => String(stat.playId) === String(play.id)), roster, selectedSchoolPositions, provisional: false }));
      const storedEvents = await supabaseRest<Array<Record<string, unknown>>>("b36_scoring_events", { query: { select: "*", source_game_id: `eq.${input.gameId}`, order: "created_at.asc" } });
      return { totalGamePlays: gamePlays.length, schoolPlays: schoolPlays.length, defensivePlays: gamePlays.filter(play => play.defense === input.school).length, statsForGame: stats.filter(stat => gamePlays.some(play => play.id === stat.playId)).length, candidates, storedEvents };
    }),
    debugScoreboardMatch: adminProcedure.query(async () => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const [schedule, scoreboard, league] = await Promise.all([getRegularSeasonGames(season), getLiveScoreboard(), getLeagueSnapshot()]);
      const drafted = Array.from(new Set(league.owners.flatMap(owner => owner.picks.map(pick => pick.schoolName))));
      const locked = league.weeks.filter(week => week.status === "FINAL").map(week => week.weekNumber);
      const rows = scoreboard.map(game => {
        const source = schedule.find(item => item.id === game.id);
        const home = game.homeTeam?.name ?? null, away = game.awayTeam?.name ?? null;
        const draftedMatch = drafted.filter(school => school === home || school === away);
        return { id: game.id, home, away, status: game.status ?? null, inSchedule: Boolean(source), scheduleWeek: source?.week ?? null, scheduleHome: source?.homeTeam ?? null, scheduleAway: source?.awayTeam ?? null, draftedMatch, lockedOut: source ? locked.includes(source.week) : null };
      });
      return { season, scoreboardCount: scoreboard.length, inSchedule: rows.filter(row => row.inSchedule).length, draftedByScoreboardName: rows.filter(row => row.draftedMatch.length).length, draftedBySchedule: rows.filter(row => row.inSchedule && drafted.some(school => school === row.scheduleHome || school === row.scheduleAway)).length, lockedWeeks: locked, draftedSchools: drafted, games: rows };
    }),
    // One-time backfill: apply the box-score fumbles-lost logic to games that completed before it
    // shipped (Aug 29 / Sep 3 slates). Bypasses the settled-game lock on purpose; dryRun (default)
    // only reports what would be written.
    backfillBoxScoreFumbles: adminProcedure.input(z.object({ week: z.number().int().min(1), dryRun: z.boolean().default(true) })).mutation(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const [schedule, snapshot] = await Promise.all([getRegularSeasonGames(season), getLeagueSnapshot()]);
      const weekRow = snapshot.weeks.find(week => week.weekNumber === input.week);
      if (!weekRow) throw new Error(`No scoring week row for week ${input.week}.`);
      const selected = snapshot.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as LivePosition, draftSlotId: pick.id, ownerName: owner.teamName })));
      const games = schedule.filter(game => game.week === input.week && game.completed && [game.homeTeam, game.awayTeam].some(team => selected.some(pick => pick.schoolName === team)));
      const gameIds = games.map(game => game.id);
      const rows = gameIds.length ? await supabaseRest<Array<{ source_event_key: string | null; source_game_id: number | null; audit_action: string; draft_slot_id: string; event_type: string; stat_value: number }>>("b36_scoring_events", { query: { select: "source_event_key,source_game_id,audit_action,draft_slot_id,event_type,stat_value", source_game_id: `in.(${gameIds.join(",")})`, limit: "5000" } }) : [];
      const reversed = new Set(rows.filter(row => row.audit_action === "REVERSAL" && row.source_event_key).map(row => row.source_event_key));
      const known = new Set(rows.filter(row => row.source_event_key && row.audit_action !== "REVERSAL").map(row => row.source_event_key));
      const planned: Array<{ gameId: number; game: string; owner: string; school: string; position: string; fumblesLost: number; points: number; note: string; key: string; status: string }> = [];
      const unavailable: Array<{ gameId: number; school: string }> = [];
      const diagnostics: Array<Record<string, unknown>> = [];
      for (const game of games) {
        for (const school of [game.homeTeam, game.awayTeam]) {
          if (!selected.some(pick => pick.schoolName === school)) continue;
          const box = (await getGamePlayerStats(season, input.week, school)).find(entry => entry.id === game.id);
          const alreadyWrittenBySlot = new Map<LivePosition, number>();
          for (const row of rows) {
            if (row.source_game_id !== game.id || row.event_type !== "FUMBLE_LOST" || row.audit_action !== "ENTRY" || !row.source_event_key || row.source_event_key.endsWith(":box") || reversed.has(`${row.source_event_key}:reversal`)) continue;
            const slot = selected.find(pick => pick.draftSlotId === row.draft_slot_id && pick.schoolName === school);
            if (slot) alreadyWrittenBySlot.set(slot.position, (alreadyWrittenBySlot.get(slot.position) ?? 0) + row.stat_value);
          }
          const roster = await getRoster(school, season);
          const boxGames = await getGamePlayerStats(season, input.week, school);
          const lostType = box?.teams.find(team => team.team === school)?.categories.find(category => category.name === "fumbles")?.types.find(type => type.name === "LOST");
          diagnostics.push({
            gameId: game.id, school, boxGameFound: Boolean(box), boxGameIdsReturned: boxGames.map(entry => entry.id), boxTeamNames: box?.teams.map(team => team.team) ?? [], fumblesCategoryFound: Boolean(lostType), rosterSize: roster.length,
            lostAthletes: (lostType?.athletes ?? []).filter(athlete => Number(athlete.stat) > 0).map(athlete => { const rosterEntry = matchBoxAthleteToRoster(athlete, roster); return { id: athlete.id, name: athlete.name.trim(), lost: Number(athlete.stat), rosterPosition: rosterEntry?.position ?? null, inRoster: Boolean(rosterEntry), matchedRosterId: rosterEntry ? String(rosterEntry.id) : null, sampleRosterId: roster[0] ? `${String(roster[0].id)} (${typeof roster[0].id})` : null, draftedAtThatPosition: Boolean(rosterEntry?.position && selected.some(pick => pick.schoolName === school && pick.position === (({ QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE" } as Record<string, string>)[String(rosterEntry.position).toUpperCase()] ?? ""))) }; }),
          });
          const result = boxScoreFumbleCandidates({ gameId: game.id, school, box, roster, selectedSchoolPositions: selected, alreadyWrittenBySlot });
          if (!result.available) { unavailable.push({ gameId: game.id, school }); continue; }
          for (const candidate of result.candidates) {
            const slot = selected.find(pick => pick.schoolName === candidate.schoolName && pick.position === candidate.position);
            if (!slot) continue;
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            const status = known.has(candidate.sourceEventKey) ? "already-present" : input.dryRun ? "would-insert" : "inserted";
            planned.push({ gameId: game.id, game: `${game.awayTeam} at ${game.homeTeam}`, owner: slot.ownerName, school, position: candidate.position, fumblesLost: candidate.statValue, points: score.points, note: candidate.note, key: candidate.sourceEventKey, status });
            if (status !== "inserted") continue;
            await supabaseRest("b36_scoring_events", { method: "POST", body: { week_id: weekRow.id, draft_slot_id: slot.draftSlotId, event_type: candidate.eventType, stat_value: candidate.statValue, yard_distance: candidate.yardDistance, computed_points: score.points, note: `${candidate.note} (backfill)`, audit_action: "ENTRY", recorded_by_open_id: "cfbd-box-score-backfill", source_event_key: candidate.sourceEventKey, source_game_id: game.id, is_provisional: false } });
          }
        }
      }
      return { season, week: input.week, dryRun: input.dryRun, gamesChecked: games.length, planned, unavailable, diagnostics: diagnostics.filter(entry => (entry.lostAthletes as unknown[]).length > 0 || !entry.boxGameFound || !entry.fumblesCategoryFound) };
    }),
    fullScoringAudit: adminProcedure.input(z.object({ week: z.number() })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const [schedule, plays, stats, league] = await Promise.all([getRegularSeasonGames(season), getWeekPlays(season, input.week), getWeekPlayStats(season, input.week), getLeagueSnapshot()]);
      const selectedSchoolPositions = league.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as never, draftSlotId: pick.id, teamName: owner.teamName })));
      const draftedSchools = new Set(selectedSchoolPositions.map(s => s.schoolName));
      const relevantGames = schedule.filter(game => game.week === input.week && game.completed && (draftedSchools.has(game.homeTeam) || draftedSchools.has(game.awayTeam)));

      // Compute the official point total per drafted (school, position) by checking BOTH sides of
      // every relevant game - offense credit from the school's own plays, defense credit from the
      // opponent's plays where this school was on defense. Checking only one side (a bug in an
      // earlier audit tool tonight) silently misses all defensive credit.
      const officialTotals = new Map<string, number>();
      const roundedCache = new Map<string, Awaited<ReturnType<typeof getRoster>>>();
      for (const game of relevantGames) {
        const gamePlays = plays.filter(play => play.gameId === game.id);
        if (!gamePlays.length) continue;
        for (const school of [game.homeTeam, game.awayTeam]) {
          // Process every school's plays, even ones nobody drafted - a drafted team's DEFENSIVE
          // credit comes from the OPPONENT's offensive plays, so skipping an undrafted opponent
          // here would silently miss all defensive credit against them (the bug that caused this
          // audit to under-report USC's DEF total against non-drafted San José State).
          let roster = roundedCache.get(school);
          if (!roster) { roster = await getRoster(school, season); roundedCache.set(school, roster); }
          const schoolPlays = gamePlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, gamePlays[index + 1]));
          const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => String(stat.playId) === String(play.id)), roster: roster!, selectedSchoolPositions, provisional: false }));
          for (const candidate of candidates) {
            const rules = await getScoringRulesForEvent(candidate.eventType as never);
            const score = calculateEventScore(rules, { eventType: candidate.eventType as never, position: candidate.position, statValue: candidate.statValue, yardDistance: candidate.yardDistance });
            const key = `${candidate.schoolName}:${candidate.position}`;
            officialTotals.set(key, (officialTotals.get(key) ?? 0) + score.points);
          }
        }
      }

      // Compare against what's actually stored for every drafted slot with a game this week.
      const results: Array<Record<string, unknown>> = [];
      for (const slot of selectedSchoolPositions) {
        const inRelevantGame = relevantGames.some(game => game.homeTeam === slot.schoolName || game.awayTeam === slot.schoolName);
        if (!inRelevantGame) continue;
        const stored = await supabaseRest<Array<{ computed_points: number; week_id: string }>>("b36_scoring_events", { query: { select: "computed_points,week_id", draft_slot_id: q.eq(slot.draftSlotId) } });
        const weekRows = await supabaseRest<Array<{ id: string }>>("b36_scoring_weeks", { query: { select: "id", week_number: `eq.${input.week}` } });
        const weekId = weekRows[0]?.id;
        const storedThisWeek = weekId ? stored.filter(row => row.week_id === weekId) : stored;
        const storedNet = storedThisWeek.reduce((sum, row) => sum + row.computed_points, 0);
        const official = officialTotals.get(`${slot.schoolName}:${slot.position}`) ?? 0;
        if (Math.abs(official - storedNet) > 0.01) results.push({ owner: slot.teamName, school: slot.schoolName, position: slot.position, officialPoints: official, storedPoints: storedNet, difference: Math.round((official - storedNet) * 100) / 100 });
      }
      return { checkedSlots: selectedSchoolPositions.filter(slot => relevantGames.some(game => game.homeTeam === slot.schoolName || game.awayTeam === slot.schoolName)).length, gamesChecked: relevantGames.length, mismatches: results, gameTeamNames: relevantGames.map(game => ({ gameId: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam, playCount: plays.filter(play => play.gameId === game.id).length })) };
    }),
    findLikelyDuplicateScoring: adminProcedure.query(async () => {
      // Targets the exact failure mode found tonight: a manual restoration entry for something
      // automation had missed, followed later by automation correctly detecting that same real
      // play on its own once the underlying bug was fixed - leaving both entries active and
      // double-counting. Flags any active (non-reversed) manual entry that shares a draft slot +
      // event type with another active, non-manual entry created afterward.
      const manualEntries = await supabaseRest<Array<{ id: string; draft_slot_id: string; event_type: string; computed_points: number; source_event_key: string | null; created_at: string; source_game_id: number | null }>>("b36_scoring_events", { query: { select: "id,draft_slot_id,event_type,computed_points,source_event_key,created_at,source_game_id", recorded_by_open_id: q.eq("manual-bugfix-restoration"), audit_action: q.eq("ENTRY") } });
      const results: Array<Record<string, unknown>> = [];
      for (const manual of manualEntries) {
        const allForSlot = await supabaseRest<Array<{ id: string; source_event_key: string | null; computed_points: number; recorded_by_open_id: string; created_at: string; audit_action: string; correction_of_event_id: string | null }>>("b36_scoring_events", { query: { select: "id,source_event_key,computed_points,recorded_by_open_id,created_at,audit_action,correction_of_event_id", draft_slot_id: q.eq(manual.draft_slot_id), event_type: q.eq(manual.event_type) } });
        // An entry only counts as a real duplicate if it's still net-active (its points weren't
        // later cancelled by a reversal) - a manual restoration of something that was wrongly
        // reversed is legitimate, not a duplicate, even though another "ENTRY" row exists for it.
        const reversedIds = new Set(allForSlot.filter(row => row.audit_action === "REVERSAL" && row.correction_of_event_id).map(row => row.correction_of_event_id));
        const others = allForSlot.filter(row => row.audit_action === "ENTRY" && row.recorded_by_open_id !== "manual-bugfix-restoration" && row.source_event_key !== manual.source_event_key && !reversedIds.has(row.id));
        if (others.length) results.push({ manualEntry: manual, possibleDuplicates: others });
      }
      return results;
    }),
    debugBulkDefKstCheck: adminProcedure.input(z.object({ week: z.number(), gameIds: z.array(z.number()) })).query(async ({ input }) => {
      const automationRows = await supabaseRest<Array<{ season: number }>>("b36_automation_config", { query: { select: "season", id: q.eq(true) } });
      const season = automationRows[0]?.season;
      if (!season) throw new Error("No season configured.");
      const [plays, stats, league] = await Promise.all([getWeekPlays(season, input.week), getWeekPlayStats(season, input.week), getLeagueSnapshot()]);
      const selectedSchoolPositions = league.owners.flatMap(owner => owner.picks.map(pick => ({ schoolName: pick.schoolName, position: pick.position as never, draftSlotId: pick.id, teamName: owner.teamName })));
      const results: Array<Record<string, unknown>> = [];
      for (const gameId of input.gameIds) {
        const gamePlays = plays.filter(play => play.gameId === gameId);
        if (!gamePlays.length) { results.push({ gameId, error: "No plays found for this game in the official feed yet." }); continue; }
        const schoolsInGame = Array.from(new Set(gamePlays.flatMap(play => [play.offense, play.defense])));
        for (const school of schoolsInGame) {
          const roster = await getRoster(school, season);
          const schoolPlays = gamePlays.filter((play, index) => play.offense === school && !isSupersededInterceptionPlay(play, gamePlays[index + 1]));
          const candidates = schoolPlays.flatMap(play => mapLivePlayToCandidates({ play, stats: stats.filter(stat => String(stat.playId) === String(play.id)), roster, selectedSchoolPositions, provisional: false }));
          for (const position of ["DEF", "K_ST"] as const) {
            const slot = selectedSchoolPositions.find(s => s.schoolName === school && s.position === position);
            if (!slot) continue;
            const relevant = candidates.filter(candidate => candidate.schoolName === school && candidate.position === position);
            const stored = await supabaseRest<Array<{ computed_points: number; event_type: string; audit_action: string; source_event_key: string | null; note: string | null }>>("b36_scoring_events", { query: { select: "computed_points,event_type,audit_action,source_event_key,note", draft_slot_id: `eq.${slot.draftSlotId}`, source_game_id: `eq.${gameId}` } });
            const storedNet = stored.reduce((sum, row) => sum + row.computed_points, 0);
            const officialKeys = new Set(relevant.map(c => c.sourceEventKey));
            const storedEntryKeys = new Set(stored.filter(row => row.audit_action === "ENTRY").map(row => row.source_event_key));
            const missing = relevant.filter(c => !storedEntryKeys.has(c.sourceEventKey));
            results.push({ gameId, school, position, owner: slot.teamName, officialCandidates: relevant.map(c => ({ eventType: c.eventType, key: c.sourceEventKey, note: c.note })), storedRowCount: stored.length, storedNetPoints: storedNet, missingFromDatabase: missing.map(c => ({ eventType: c.eventType, key: c.sourceEventKey })) });
          }
        }
      }
      return results;
    }),
    paymentStatus: adminProcedure.query(async () => {
      const rows = await supabaseRest<Array<{ id: string; team_name: string; display_name: string; is_paid: boolean; paid_at: string | null }>>("b36_owners", { query: { select: "id,team_name,display_name,is_paid,paid_at", order: "display_name.asc" } });
      return rows.map(row => ({ ownerId: row.id, teamName: row.team_name, displayName: row.display_name, isPaid: row.is_paid, paidAt: row.paid_at }));
    }),
    markOwnerPaid: adminProcedure.input(z.object({ ownerId: uuid })).mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString();
      await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(input.ownerId) }, body: { is_paid: true, paid_at: now, paid_marked_by_open_id: ctx.user.openId } });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "OWNER_MARKED_PAID", entity_type: "b36_owners", entity_id: input.ownerId } });
      return { success: true as const, paidAt: now };
    }),
    markOwnerUnpaid: adminProcedure.input(z.object({ ownerId: uuid })).mutation(async ({ ctx, input }) => {
      await supabaseRest("b36_owners", { method: "PATCH", query: { id: q.eq(input.ownerId) }, body: { is_paid: false, paid_at: null, paid_marked_by_open_id: null } });
      await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "OWNER_MARKED_UNPAID", entity_type: "b36_owners", entity_id: input.ownerId } });
      return { success: true as const };
    }),
    futureIdeas: adminProcedure.query(() => supabaseRest<Array<{ id: string; title: string; season: string; status: string; content: string; created_at: string; updated_at: string }>>("b36_future_ideas", { query: { select: "*", order: "created_at.desc" } })),
    createFutureIdea: adminProcedure.input(z.object({ title: z.string().trim().min(1).max(200), season: z.string().trim().min(1).max(20), content: z.string().trim().min(1).max(50000) })).mutation(async ({ ctx, input }) => {
      try {
        const now = new Date().toISOString();
        await supabaseRest("b36_future_ideas", { method: "POST", body: { title: input.title, season: input.season, content: input.content, status: "PROPOSED", created_by_open_id: ctx.user.openId, created_at: now, updated_at: now } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    updateFutureIdea: adminProcedure.input(z.object({ id: uuid, title: z.string().trim().min(1).max(200), season: z.string().trim().min(1).max(20), status: z.string().trim().min(1).max(30), content: z.string().trim().min(1).max(50000) })).mutation(async ({ input }) => {
      try {
        await supabaseRest("b36_future_ideas", { method: "PATCH", query: { id: q.eq(input.id) }, body: { title: input.title, season: input.season, status: input.status, content: input.content, updated_at: new Date().toISOString() } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
    deleteFutureIdea: adminProcedure.input(z.object({ id: uuid })).mutation(async ({ input }) => {
      try {
        await supabaseRest("b36_future_ideas", { method: "DELETE", query: { id: q.eq(input.id) } });
        return { success: true as const };
      } catch (error) { asError(error); }
    }),
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
    sendBulkDraftSms: adminProcedure.input(z.object({ message: z.string().trim().min(1).max(1500) })).mutation(async ({ ctx, input }) => {
      try {
        const registrations = await supabaseRest<Array<{ id: string; display_name: string; team_name: string; phone_e164: string | null; assigned_owner_id: string | null }>>(registrationTable, { query: { select: "id,display_name,team_name,phone_e164,assigned_owner_id", status: q.eq("APPROVED") } });
        const recipients = registrations.filter(registration => registration.assigned_owner_id && registration.phone_e164);
        const results = await Promise.allSettled(recipients.map(recipient => sendDraftSms(recipient.phone_e164!, input.message)));
        const sent = results.filter(result => result.status === "fulfilled").length;
        const failed = results.length - sent;
        const skipped = registrations.length - recipients.length;
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "BULK_SMS_BLAST", entity_type: registrationTable, entity_id: null, detail: { sent, failed, skipped, totalApproved: registrations.length, messagePreview: input.message.slice(0, 120) } } });
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
    liveAutomationStatus: adminProcedure.query(async () => {
      const rows = await supabaseRest<Array<{ season: number; enabled: boolean; last_refresh_at: string | null }>>("b36_automation_config", { query: { select: "season,enabled,last_refresh_at", id: q.eq(true) } });
      return rows[0] ?? null;
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
      if (input.status === "OPEN") {
        // Resuming from a pause (or starting fresh): give any turn that's already ACTIVE a brand-new
        // 10-minute clock, so time that passed while the draft was paused doesn't silently count against
        // the owner currently on the clock.
        const freshExpiresAt = new Date(Date.now() + 600_000).toISOString();
        await supabaseRest("b36_draft_turns", { method: "PATCH", query: { status: q.eq("ACTIVE") }, body: { expires_at: freshExpiresAt, opened_at: new Date().toISOString() } });
      }
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
    clearOwnerPositionSlot: adminProcedure.input(z.object({ ownerId: uuid, position: positionSchema })).mutation(async ({ ctx, input }) => {
      try {
        const slots = await getAllDraftSlots();
        const target = slots.find(slot => slot.owner_id === input.ownerId && slot.position === input.position);
        if (!target) throw new Error("This owner has no draft slot for that position.");
        if (!target.school_name) throw new Error("This position hasn't been drafted yet — nothing to clear.");
        const clearedSchool = target.school_name;
        await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(target.id) }, body: { school_name: null, selected_at: null, selected_by_open_id: null } });
        const linkedTurns = await supabaseRest<Array<{ id: string; global_pick: number }>>("b36_draft_turns", { query: { select: "id,global_pick", draft_slot_id: q.eq(target.id) } });
        for (const turn of linkedTurns) {
          await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(turn.id) }, body: { status: "SKIPPED", picked_at: null, draft_slot_id: null, skipped_at: new Date().toISOString() } });
        }
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "DRAFT_SLOT_CLEARED", entity_type: "b36_draft_slots", entity_id: target.id, detail: { ownerId: input.ownerId, position: input.position, clearedSchool, relinkedTurns: linkedTurns.map(turn => turn.global_pick) } } });
        return { success: true as const, clearedSchool };
      } catch (error) { asError(error); }
    }),
    recordDraftPick: adminProcedure.input(z.object({ ownerId: uuid, position: positionSchema, schoolName: z.string().trim().min(2).max(120), globalPick: z.number().int().min(1).max(216).optional() })).mutation(async ({ ctx, input }) => {
      try {
        const slots = await getAllDraftSlots();
        const target = slots.find(slot => slot.owner_id === input.ownerId && slot.position === input.position);
        if (!target) throw new Error("This owner has no approved draft slot for that position.");
        assertSchoolPositionAvailable(slots.filter(slot => slot.school_name).map(slot => ({ ownerId: slot.owner_id as unknown as number, schoolName: slot.school_name!, position: slot.position })), { ownerId: input.ownerId as unknown as number, schoolName: input.schoolName, position: input.position });
        const now = new Date().toISOString();
        await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(target.id) }, body: { school_name: normalizeSchoolName(input.schoolName), selected_at: now, selected_by_open_id: ctx.user.openId } });
        await supabaseRest("b36_draft_queue_entries", { method: "DELETE", query: { owner_id: q.eq(input.ownerId), position: q.eq(input.position) } });
        let turnToResolve: { id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; global_pick: number } | undefined;
        if (input.globalPick) {
          const specificTurns = await supabaseRest<Array<{ id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; global_pick: number; owner_id: string }>>("b36_draft_turns", { query: { select: "id,status,global_pick,owner_id", global_pick: q.eq(input.globalPick), limit: "1" } });
          const specific = specificTurns[0];
          if (!specific) throw new Error(`No draft turn exists for pick ${input.globalPick}.`);
          if (specific.owner_id !== input.ownerId) throw new Error(`Pick ${input.globalPick} does not belong to this owner.`);
          if (specific.status !== "SKIPPED" && specific.status !== "ACTIVE") throw new Error(`Pick ${input.globalPick} is not currently skipped or active (status: ${specific.status}).`);
          turnToResolve = specific;
        } else {
          const ownerTurns = await supabaseRest<Array<{ id: string; status: "PENDING" | "ACTIVE" | "SKIPPED" | "PICKED"; global_pick: number }>>("b36_draft_turns", { query: { select: "id,status,global_pick", owner_id: q.eq(input.ownerId), status: "in.(SKIPPED,ACTIVE)", order: "global_pick.asc" } });
          turnToResolve = ownerTurns.find(turn => turn.status === "SKIPPED") ?? ownerTurns.find(turn => turn.status === "ACTIVE");
        }
        if (turnToResolve) {
          const now2 = new Date();
          const wasActive = turnToResolve.status === "ACTIVE";
          await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(turnToResolve.id) }, body: { status: "PICKED", picked_at: now, draft_slot_id: target.id, expires_at: null } });
          if (wasActive) await activateNextPendingTurn(now2, inauguralDraftWindow(now2));
        }
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "ADMIN_DRAFT_OVERRIDE", entity_type: "b36_draft_slots", entity_id: target.id, detail: { resolvedTurnId: turnToResolve?.id ?? null, resolvedGlobalPick: turnToResolve?.global_pick ?? null } } });
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
