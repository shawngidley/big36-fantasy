import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { parse } from "cookie";
import type { User } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { q, supabaseRest } from "./supabase";

export const COMMISSIONER_SESSION_COOKIE = "b36_commissioner_session";
export const COMMISSIONER_SESSION_MS = 12 * 60 * 60 * 1000;
export const COMMISSIONER_EMAILS = new Set(["janssenmatt25@gmail.com", "shawngidley@gmail.com"]);
export const OWNER_SESSION_COOKIE = "b36_owner_session";
export const OWNER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

type CommissionerSessionRow = { id: string; email: string; expires_at: string; revoked_at: string | null };
type CommissionerToken = { email: string; sessionId: string; expiresAt: Date };
type OwnerSessionRow = { id: string; email: string; owner_id: string; expires_at: string; revoked_at: string | null };
type OwnerToken = { email: string; sessionId: string; expiresAt: Date };

export const normalizeCommissionerEmail = (email: string) => email.trim().toLowerCase();
export const isAuthorizedCommissionerEmail = (email: string) => COMMISSIONER_EMAILS.has(normalizeCommissionerEmail(email));
export const hashCommissionerSession = (token: string) => createHash("sha256").update(token).digest("hex");

const getSecret = () => new TextEncoder().encode(ENV.cookieSecret);

export async function signCommissionerToken(email: string, sessionId: string, expiresInMs = COMMISSIONER_SESSION_MS) {
  const now = Date.now();
  return new SignJWT({ email: normalizeCommissionerEmail(email), sessionId, type: "b36_commissioner" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + expiresInMs) / 1000))
    .sign(getSecret());
}

export async function verifyCommissionerToken(token: string): Promise<CommissionerToken | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.type !== "b36_commissioner" || typeof payload.email !== "string" || typeof payload.sessionId !== "string" || typeof payload.exp !== "number") return null;
    const email = normalizeCommissionerEmail(payload.email);
    if (!isAuthorizedCommissionerEmail(email)) return null;
    return { email, sessionId: payload.sessionId, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

export async function signOwnerToken(email: string, sessionId: string, expiresInMs = OWNER_SESSION_MS) {
  const now = Date.now();
  return new SignJWT({ email: normalizeCommissionerEmail(email), sessionId, type: "b36_owner" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor((now + expiresInMs) / 1000))
    .sign(getSecret());
}

export async function verifyOwnerToken(token: string): Promise<OwnerToken | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.type !== "b36_owner" || typeof payload.email !== "string" || typeof payload.sessionId !== "string" || typeof payload.exp !== "number") return null;
    return { email: normalizeCommissionerEmail(payload.email), sessionId: payload.sessionId, expiresAt: new Date(payload.exp * 1000) };
  } catch {
    return null;
  }
}

export function readCommissionerSessionToken(cookieHeader: string | undefined) {
  return cookieHeader ? parse(cookieHeader)[COMMISSIONER_SESSION_COOKIE] : undefined;
}

export function readOwnerSessionToken(cookieHeader: string | undefined) {
  return cookieHeader ? parse(cookieHeader)[OWNER_SESSION_COOKIE] : undefined;
}

export function commissionerUser(email: string): User {
  const normalized = normalizeCommissionerEmail(email);
  const now = new Date();
  const name = normalized === "janssenmatt25@gmail.com" ? "Matt Janssen" : "Shawn Gidley";
  return { id: 0, openId: `b36-commissioner:${normalized}`, email: normalized, name, loginMethod: "registration_pin", role: "admin", createdAt: now, updatedAt: now, lastSignedIn: now };
}

export function ownerUser(email: string): User {
  const normalized = normalizeCommissionerEmail(email);
  const now = new Date();
  return { id: 0, openId: `b36-owner:${normalized}`, email: normalized, name: normalized, loginMethod: "registration_pin", role: "user", createdAt: now, updatedAt: now, lastSignedIn: now };
}

export async function issueCommissionerSession(registrationId: string, email: string) {
  const normalized = normalizeCommissionerEmail(email);
  if (!isAuthorizedCommissionerEmail(normalized)) throw new Error("Commissioner authorization is not available for this email.");
  const sessionId = randomUUID();
  const token = await signCommissionerToken(normalized, sessionId);
  const expiresAt = new Date(Date.now() + COMMISSIONER_SESSION_MS);
  await supabaseRest("b36_commissioner_sessions", { method: "POST", body: { id: sessionId, registration_id: registrationId, email: normalized, session_hash: hashCommissionerSession(token), expires_at: expiresAt.toISOString() } });
  return { token, expiresAt };
}

export async function resolveCommissionerSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const parsed = await verifyCommissionerToken(token);
  if (!parsed) return null;
  const sessions = await supabaseRest<CommissionerSessionRow[]>("b36_commissioner_sessions", { query: { select: "id,email,expires_at,revoked_at", id: q.eq(parsed.sessionId), session_hash: q.eq(hashCommissionerSession(token)), limit: "1" } });
  const session = sessions[0];
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || normalizeCommissionerEmail(session.email) !== parsed.email) return null;
  await supabaseRest("b36_commissioner_sessions", { method: "PATCH", query: { id: q.eq(session.id) }, body: { last_seen_at: new Date().toISOString() }, prefer: "return=minimal" });
  return commissionerUser(parsed.email);
}

export async function issueOwnerSession(registrationId: string, ownerId: string, email: string) {
  const normalized = normalizeCommissionerEmail(email);
  const sessionId = randomUUID();
  const token = await signOwnerToken(normalized, sessionId);
  const expiresAt = new Date(Date.now() + OWNER_SESSION_MS);
  await supabaseRest("b36_owner_sessions", { method: "POST", body: { id: sessionId, registration_id: registrationId, owner_id: ownerId, email: normalized, session_hash: hashCommissionerSession(token), expires_at: expiresAt.toISOString() } });
  return { token, expiresAt };
}

export async function resolveOwnerSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const parsed = await verifyOwnerToken(token);
  if (!parsed) return null;
  const sessions = await supabaseRest<OwnerSessionRow[]>("b36_owner_sessions", { query: { select: "id,email,owner_id,expires_at,revoked_at", id: q.eq(parsed.sessionId), session_hash: q.eq(hashCommissionerSession(token)), limit: "1" } });
  const session = sessions[0];
  if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now() || normalizeCommissionerEmail(session.email) !== parsed.email) return null;
  await supabaseRest("b36_owner_sessions", { method: "PATCH", query: { id: q.eq(session.id) }, body: { last_seen_at: new Date().toISOString() }, prefer: "return=minimal" });
  return ownerUser(parsed.email);
}

export async function revokeCommissionerSession(token: string | undefined) {
  if (!token) return;
  const parsed = await verifyCommissionerToken(token);
  if (!parsed) return;
  await supabaseRest("b36_commissioner_sessions", { method: "PATCH", query: { id: q.eq(parsed.sessionId), session_hash: q.eq(hashCommissionerSession(token)) }, body: { revoked_at: new Date().toISOString() }, prefer: "return=minimal" });
}

export async function revokeOwnerSession(token: string | undefined) {
  if (!token) return;
  const parsed = await verifyOwnerToken(token);
  if (!parsed) return;
  await supabaseRest("b36_owner_sessions", { method: "PATCH", query: { id: q.eq(parsed.sessionId), session_hash: q.eq(hashCommissionerSession(token)) }, body: { revoked_at: new Date().toISOString() }, prefer: "return=minimal" });
}
