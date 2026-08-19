import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { COMMISSIONER_SESSION_COOKIE, COMMISSIONER_SESSION_MS, issueCommissionerSession, issueOwnerSession, isAuthorizedCommissionerEmail, normalizeCommissionerEmail, OWNER_SESSION_COOKIE, OWNER_SESSION_MS, readCommissionerSessionToken, readOwnerSessionToken, revokeCommissionerSession, revokeOwnerSession } from "./commissioner-auth";
import { verifyRegistrationPin } from "./registration";
import { q, supabaseRest } from "./supabase";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { leagueRouter } from "./routers/league";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    commissionerLogin: publicProcedure.input(z.object({ email: z.string().trim().email().max(254), pin: z.string().min(4).max(12) })).mutation(async ({ ctx, input }) => {
      const email = normalizeCommissionerEmail(input.email);
      const genericError = () => { throw new Error("The commissioner email or PIN is not recognized."); };
      if (!isAuthorizedCommissionerEmail(email)) genericError();
      const registrations = await supabaseRest<Array<{ id: string; email: string; pin_hash: string }>>("b36_owner_registrations", { query: { select: "id,email,pin_hash", email: q.eq(email), order: "created_at.desc", limit: "1" } });
      const registration = registrations[0];
      if (!registration || !verifyRegistrationPin(input.pin, registration.pin_hash)) genericError();
      const session = await issueCommissionerSession(registration.id, email);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COMMISSIONER_SESSION_COOKIE, session.token, { ...cookieOptions, maxAge: COMMISSIONER_SESSION_MS });
      return { success: true as const, expiresAt: session.expiresAt.toISOString() };
    }),
    ownerLogin: publicProcedure.input(z.object({ email: z.string().trim().email().max(254), pin: z.string().min(4).max(12) })).mutation(async ({ ctx, input }) => {
      const email = normalizeCommissionerEmail(input.email);
      const genericError = (): never => { throw new Error("The email, PIN, or approved program is not recognized."); };
      const registrations = await supabaseRest<Array<{ id: string; email: string; pin_hash: string; status: string; assigned_owner_id: string | null }>>("b36_owner_registrations", { query: { select: "id,email,pin_hash,status,assigned_owner_id", email: q.eq(email), status: q.eq("APPROVED"), order: "reviewed_at.desc", limit: "1" } });
      const registration = registrations[0];
      if (!registration) genericError();
      const ownerId = registration.assigned_owner_id;
      if (!ownerId) throw new Error("The email, PIN, or approved program is not recognized.");
      if (!verifyRegistrationPin(input.pin, registration.pin_hash)) genericError();
      const session = await issueOwnerSession(registration.id, ownerId, email);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(OWNER_SESSION_COOKIE, session.token, { ...cookieOptions, maxAge: OWNER_SESSION_MS });
      return { success: true as const, expiresAt: session.expiresAt.toISOString() };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      await revokeCommissionerSession(readCommissionerSessionToken(ctx.req.headers.cookie));
      await revokeOwnerSession(readOwnerSessionToken(ctx.req.headers.cookie));
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(COMMISSIONER_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(OWNER_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  league: leagueRouter,

});

export type AppRouter = typeof appRouter;
