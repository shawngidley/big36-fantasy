import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { positions, scoringEventTypes, type Position } from "../../drizzle/schema";
import { getAllDraftSlots, getDraftOwnerState, getDraftSlotByGroup, getDraftResearchCatalog, getLeagueSnapshot, getOrClaimOwner, getScoreEvent, getScoringRulesForEvent } from "../league-data";
import { assertSchoolPositionAvailable, buildReversal, calculateEventScore, hasBalancedDraftAssignments, normalizeSchoolName } from "../league-scoring";
import { buildSerpentineTurns } from "../serpentine-draft";
import { q, supabaseRest, supabaseRpc } from "../supabase";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { yearOneRules } from "../year-one-rules";
import { runGamedayRefresh } from "../gameday-refresh";
import { syncFbsPoolAndSchedule } from "../gameday-refresh";

const positionSchema = z.enum(positions);
const eventTypeSchema = z.enum(scoringEventTypes);
const uuid = z.string().uuid();
const asError = (error: unknown): never => { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "The requested Big 36 action could not be completed." }); };

export const leagueRouter = router({
  snapshot: publicProcedure.query(() => getLeagueSnapshot()),
  research: publicProcedure.input(z.object({ position: positionSchema.optional() }).optional()).query(({ input }) => getDraftResearchCatalog(input?.position)),
  owner: publicProcedure.input(z.object({ ownerId: uuid })).query(async ({ input }) => {
    const owner = (await getLeagueSnapshot()).owners.find(item => item.id === input.ownerId);
    if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Big 36 team not found." });
    return owner;
  }),
  myDraft: protectedProcedure.query(({ ctx }) => getDraftOwnerState(ctx.user.openId, ctx.user.email)),
  submitMyPick: protectedProcedure.input(z.object({ position: positionSchema, schoolName: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
    const owner = await getOrClaimOwner(ctx.user.openId, ctx.user.email);
    if (!owner) throw new TRPCError({ code: "FORBIDDEN", message: "Your email has not been assigned to a Big 36 owner record yet." });
    try {
      const normalizedSchool = normalizeSchoolName(input.schoolName);
      const fbsPool = await supabaseRest<Array<{ school_name: string }>>("b36_fbs_schools", { query: { select: "school_name", season: q.eq(2026) } });
      if (!fbsPool.some(team => normalizeSchoolName(team.school_name).toLowerCase() === normalizedSchool.toLowerCase())) throw new Error("Choose a school from the official 2026 FBS pool.");
      const pick = await supabaseRpc<{ id: string; draft_position: number }>("b36_submit_serpentine_pick", { p_owner_open_id: ctx.user.openId, p_position: input.position, p_school_name: normalizedSchool });
      return { success: true as const, draftPosition: pick.draft_position };
    } catch (error) { asError(error); }
  }),
  admin: router({
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
    startSerpentineDraft: adminProcedure.mutation(async ({ ctx }) => {
      try {
        await syncFbsPoolAndSchedule(2026);
        const pending = await supabaseRest<Array<{ id: string }>>("b36_draft_turns", { query: { select: "id", status: q.eq("PENDING"), order: "global_pick.asc", limit: "1" } });
        if (!pending[0]) throw new Error("Generate a serpentine draft order before opening the draft.");
        const now = new Date(); const expiresAt = new Date(now.getTime() + 600_000).toISOString();
        await supabaseRest("b36_draft_turns", { method: "PATCH", query: { id: q.eq(pending[0].id) }, body: { status: "ACTIVE", opened_at: now.toISOString(), expires_at: expiresAt } });
        await supabaseRest("b36_draft_state", { method: "PATCH", query: { id: q.eq(true) }, body: { status: "OPEN", active_turn_id: pending[0].id, active_position: null, updated_at: now.toISOString(), updated_by_open_id: ctx.user.openId } });
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
    recordDraftPick: adminProcedure.input(z.object({ ownerId: uuid, position: positionSchema, schoolName: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
      try {
        const slots = await getAllDraftSlots();
        const target = slots.find(slot => slot.owner_id === input.ownerId && slot.position === input.position);
        if (!target) throw new Error("This owner has no approved draft slot for that position.");
        assertSchoolPositionAvailable(slots.filter(slot => slot.school_name).map(slot => ({ ownerId: slot.owner_id as unknown as number, schoolName: slot.school_name!, position: slot.position })), { ownerId: input.ownerId as unknown as number, schoolName: input.schoolName, position: input.position });
        await supabaseRest("b36_draft_slots", { method: "PATCH", query: { id: q.eq(target.id) }, body: { school_name: normalizeSchoolName(input.schoolName), selected_at: new Date().toISOString(), selected_by_open_id: ctx.user.openId } });
        await supabaseRest("b36_audit_events", { method: "POST", body: { actor_open_id: ctx.user.openId, action: "ADMIN_DRAFT_OVERRIDE", entity_type: "b36_draft_slots", entity_id: target.id } });
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
