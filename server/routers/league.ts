import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  divisions,
  draftAssignments,
  draftPicks,
  leagueOwners,
  positions,
  scoringEvents,
  scoringRules,
  scoringWeeks,
  scoringEventTypes,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getLeagueSnapshot, getOpenDraftAssignmentConflict, getOwnerById, getOwnerDraftAssignments, getPickByOwnerAndPosition, getScoreEvent, getScoringRulesForEvent, ensureGroupIsDrafted } from "../league-data";
import { assertSchoolPositionAvailable, buildReversal, calculateEventScore, hasBalancedDraftAssignments, normalizeSchoolName } from "../league-scoring";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";

const positionSchema = z.enum(positions);
const eventTypeSchema = z.enum(scoringEventTypes);

function asTrpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : "The requested Big 36 action could not be completed.";
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export const leagueRouter = router({
  snapshot: publicProcedure.query(() => getLeagueSnapshot()),
  owner: publicProcedure.input(z.object({ ownerId: z.number().int().positive() })).query(async ({ input }) => {
    const snapshot = await getLeagueSnapshot();
    const owner = snapshot.owners.find(candidate => candidate.id === input.ownerId);
    if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Big 36 team not found." });
    return owner;
  }),
  admin: router({
    initializeSixDivisions: adminProcedure.mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const existing = await db.select({ id: divisions.id }).from(divisions);
      if (existing.length > 0) throw new TRPCError({ code: "CONFLICT", message: "Divisions are already configured. Rename them instead of initializing again." });
      await db.insert(divisions).values(Array.from({ length: 6 }, (_, index) => ({ name: `Division ${index + 1}`, sortOrder: index + 1 })));
      return { success: true } as const;
    }),
    upsertDivision: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), name: z.string().trim().min(2).max(80), sortOrder: z.number().int().min(1).max(6) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      if (input.id) {
        await db.update(divisions).set({ name: input.name, sortOrder: input.sortOrder }).where(eq(divisions.id, input.id));
      } else {
        const count = await db.select({ id: divisions.id }).from(divisions);
        if (count.length >= 6) throw new TRPCError({ code: "BAD_REQUEST", message: "Big 36 supports exactly six divisions." });
        await db.insert(divisions).values({ name: input.name, sortOrder: input.sortOrder });
      }
      return { success: true } as const;
    }),
    upsertOwner: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), displayName: z.string().trim().min(2).max(120), teamName: z.string().trim().min(2).max(120), email: z.string().trim().email().nullable().optional(), divisionId: z.number().int().positive().nullable() })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const values = { displayName: input.displayName, teamName: input.teamName, email: input.email ?? null, divisionId: input.divisionId };
      try {
        if (input.id) {
          await db.update(leagueOwners).set(values).where(eq(leagueOwners.id, input.id));
        } else {
          const ownerCount = await db.select({ id: leagueOwners.id }).from(leagueOwners);
          if (ownerCount.length >= 36) throw new TRPCError({ code: "BAD_REQUEST", message: "Big 36 has reached its 36-owner limit." });
          await db.insert(leagueOwners).values(values);
        }
      } catch (error) {
        asTrpcError(error);
      }
      return { success: true } as const;
    }),
    createWeek: adminProcedure.input(z.object({ weekNumber: z.number().int().min(1).max(20), label: z.string().trim().min(2).max(80), status: z.enum(["UPCOMING", "OPEN", "FINAL"]).default("UPCOMING") })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      try {
        await db.insert(scoringWeeks).values(input);
      } catch (error) {
        asTrpcError(error);
      }
      return { success: true } as const;
    }),
    upsertRule: adminProcedure.input(z.object({ id: z.number().int().positive().optional(), label: z.string().trim().min(3).max(120), eventType: eventTypeSchema, positionScope: z.enum(["ALL", ...positions]), minYards: z.number().int().min(0).max(99).nullable(), maxYards: z.number().int().min(0).max(99).nullable(), flatPoints: z.number().min(-100).max(100).nullable(), pointsPerUnit: z.number().min(-10).max(10).nullable(), isActive: z.enum(["true", "false"]).default("true") }).refine(value => value.flatPoints !== null || value.pointsPerUnit !== null, { message: "Set either flat points or points per unit." })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const values = { ...input, flatPoints: input.flatPoints === null ? null : input.flatPoints.toString(), pointsPerUnit: input.pointsPerUnit === null ? null : input.pointsPerUnit.toString() };
      if (input.id) await db.update(scoringRules).set(values).where(eq(scoringRules.id, input.id));
      else await db.insert(scoringRules).values(values);
      return { success: true } as const;
    }),
    saveDraftPlan: adminProcedure.input(z.object({ ownerId: z.number().int().positive(), assignments: z.array(z.object({ position: positionSchema, draftPosition: z.number().int().min(1).max(36) })).length(6) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      await getOwnerById(input.ownerId);
      if (!hasBalancedDraftAssignments(input.assignments)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every owner must have one draft slot per position and those six slots must total exactly 111." });
      const conflict = await getOpenDraftAssignmentConflict(input.assignments.map(assignment => ({ ...assignment, ownerId: input.ownerId })));
      if (conflict) throw new TRPCError({ code: "CONFLICT", message: `Draft slot ${conflict.draftPosition} for ${conflict.position} is already assigned.` });
      try {
        await db.transaction(async tx => {
          await tx.delete(draftAssignments).where(eq(draftAssignments.ownerId, input.ownerId));
          await tx.insert(draftAssignments).values(input.assignments.map(assignment => ({ ...assignment, ownerId: input.ownerId })));
        });
      } catch (error) {
        asTrpcError(error);
      }
      return { success: true } as const;
    }),
    recordDraftPick: adminProcedure.input(z.object({ ownerId: z.number().int().positive(), position: positionSchema, schoolName: z.string().trim().min(2).max(120) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      const assignments = await getOwnerDraftAssignments(input.ownerId);
      if (!hasBalancedDraftAssignments(assignments)) throw new TRPCError({ code: "BAD_REQUEST", message: "Draft picks are locked until the owner's complete six-slot plan totals exactly 111." });
      const assignedPosition = assignments.find(item => item.position === input.position);
      if (!assignedPosition) throw new TRPCError({ code: "BAD_REQUEST", message: "This owner has no approved draft slot for that position." });
      try {
        const normalizedSchoolName = normalizeSchoolName(input.schoolName);
        const snapshot = await getLeagueSnapshot();
        assertSchoolPositionAvailable(
          snapshot.owners.flatMap(owner => owner.picks.map(pick => ({ ownerId: owner.id, schoolName: pick.schoolName, position: pick.position }))),
          { ownerId: input.ownerId, schoolName: normalizedSchoolName, position: input.position },
        );
        const currentPick = await getPickByOwnerAndPosition(input.ownerId, input.position);
        if (currentPick) {
          await db.update(draftPicks).set({ schoolName: normalizedSchoolName, selectedByUserId: ctx.user.id, selectedAt: new Date() }).where(eq(draftPicks.id, currentPick.id));
        } else {
          await db.insert(draftPicks).values({ ...input, schoolName: normalizedSchoolName, selectedByUserId: ctx.user.id });
        }
      } catch (error) {
        asTrpcError(error);
      }
      return { success: true, draftPosition: assignedPosition.draftPosition } as const;
    }),
    recordScoreEvent: adminProcedure.input(z.object({ weekId: z.number().int().positive(), schoolName: z.string().trim().min(2).max(120), position: positionSchema, eventType: eventTypeSchema, statValue: z.number().min(-10000).max(10000), yardDistance: z.number().int().min(0).max(109).nullable(), note: z.string().trim().max(1000).nullable() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      try {
        await ensureGroupIsDrafted(input.schoolName, input.position);
        const rules = await getScoringRulesForEvent(input.eventType);
        const score = calculateEventScore(rules, input);
        await db.insert(scoringEvents).values({ ...input, statValue: input.statValue.toString(), scoringRuleId: score.ruleId, computedPoints: score.points.toString(), auditAction: "ENTRY", recordedByUserId: ctx.user.id });
        return { success: true, points: score.points } as const;
      } catch (error) {
        asTrpcError(error);
      }
    }),
    reverseScoreEvent: adminProcedure.input(z.object({ eventId: z.number().int().positive(), reason: z.string().trim().min(4).max(1000) })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
      try {
        const original = await getScoreEvent(input.eventId);
        const reversal = buildReversal(original);
        await db.insert(scoringEvents).values({
          weekId: original.weekId,
          schoolName: original.schoolName,
          position: original.position,
          eventType: original.eventType,
          statValue: reversal.statValue,
          yardDistance: original.yardDistance,
          scoringRuleId: original.scoringRuleId,
          computedPoints: reversal.computedPoints,
          auditAction: reversal.auditAction,
          correctionOfEventId: reversal.correctionOfEventId,
          note: input.reason,
          recordedByUserId: ctx.user.id,
        });
        return { success: true } as const;
      } catch (error) {
        asTrpcError(error);
      }
    }),
  }),
});
