/**
 * auth.ts — session-based auth, ported 1:1 from auth.py.
 *
 * Password hashing: werkzeug's default is `scrypt` (format
 * `scrypt:N:r:p$salt$hexhash`, salt/password as UTF-8, 64-byte derived key)
 * — NOT PBKDF2. Verified compatible with Node's `node:crypto.scryptSync`
 * (same N/r/p/maxmem, same salt encoding) — see the spike test in Phase 3;
 * this means existing users' password hashes verify without a forced reset.
 *
 * Sessions: signed cookies (HMAC-SHA256 over a JSON payload + expiry) via
 * Web Crypto — mirrors Flask's client-signed session cookies 1:1, no new
 * server-side session store.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// ------------------------------------------------------------- passwords --- //
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function genSalt(length: number = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += SALT_CHARS[bytes[i] % SALT_CHARS.length];
  return out;
}

/** Matches werkzeug's generate_password_hash(password, method="scrypt", salt_length=16). */
export function generatePasswordHash(password: string): string {
  const salt = genSalt(16);
  const n = 32768,
    r = 8,
    p = 1;
  const maxmem = 132 * n * r * p;
  const hash = scryptSync(password, salt, 64, { N: n, r, p, maxmem }).toString("hex");
  return `scrypt:${n}:${r}:${p}$${salt}$${hash}`;
}

/** Matches werkzeug's check_password_hash — verifies scrypt (this app's only
 * format in practice) via a constant-time comparison. */
export function checkPasswordHash(pwhash: string, password: string): boolean {
  const parts = pwhash.split("$");
  if (parts.length !== 3) return false;
  const [method, salt, hashHex] = parts;
  const methodParts = method.split(":");
  if (methodParts[0] !== "scrypt") return false; // pbkdf2 never used by this app
  const n = parseInt(methodParts[1] ?? "32768", 10);
  const r = parseInt(methodParts[2] ?? "8", 10);
  const p = parseInt(methodParts[3] ?? "1", 10);
  const maxmem = 132 * n * r * p;
  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, 64, { N: n, r, p, maxmem });
  } catch {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// -------------------------------------------------------------- sessions --- //
export interface SessionData {
  user_id: number;
  user_email?: string | null;
  user_name?: string | null;
  exp: number; // unix seconds
}

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches Flask's default PERMANENT_SESSION_LIFETIME order of magnitude

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Create a signed session cookie value (payload + signature, both base64url). */
export async function signSession(secret: string, data: Omit<SessionData, "exp">): Promise<string> {
  const payload: SessionData = { ...data, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64Url(new TextEncoder().encode(payloadJson));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${toBase64Url(sig)}`;
}

/** Verify + decode a session cookie value. Returns null if missing/invalid/expired. */
export async function verifySession(secret: string, cookieValue: string | undefined | null): Promise<SessionData | null> {
  if (!cookieValue) return null;
  const [payloadB64, sigB64] = cookieValue.split(".");
  if (!payloadB64 || !sigB64) return null;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    fromBase64Url(sigB64),
    new TextEncoder().encode(payloadB64)
  );
  if (!valid) return null;
  let data: SessionData;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
  } catch {
    return null;
  }
  if (data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

export function sessionCookieHeader(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | undefined | null): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  return match?.[1];
}

// ---------------------------------------------------------------- flows --- //
import * as db from "./db";

const RESET_TOKEN_TTL = 3600; // 1 hour

function randomUrlSafeToken(bytes: number = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Create a new account. Returns [user_id, null] on success, [null, error] on failure. */
export async function register(
  dbHandle: D1Database,
  emailRaw: string,
  nameRaw: string,
  password: string
): Promise<[number | null, string | null]> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return [null, "A valid email address is required."];
  if (password.length < 8) return [null, "Password must be at least 8 characters."];
  if (await db.getUserByEmail(dbHandle, email)) return [null, "An account with that email already exists."];
  const userId = await db.upsertUser(dbHandle, email, (nameRaw ?? "").trim() || null);
  if (!userId) return [null, "Could not create account — please try again."];
  await db.setPassword(dbHandle, userId, generatePasswordHash(password));
  return [userId, null];
}

/** Returns user_id on success, null if credentials don't match. */
export async function authenticate(dbHandle: D1Database, emailRaw: string, password: string): Promise<number | null> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  const user = await db.getUserByEmail(dbHandle, email);
  if (!user || !user.password_hash) return null;
  if (!checkPasswordHash(user.password_hash, password)) return null;
  return user.id;
}

/** Generate a password-reset token. Returns [user, token] or [null, null] if not found. */
export async function createResetToken(
  dbHandle: D1Database,
  emailRaw: string
): Promise<[db.User | null, string | null]> {
  const email = (emailRaw ?? "").trim().toLowerCase();
  const user = await db.getUserByEmail(dbHandle, email);
  if (!user) return [null, null];
  const token = randomUrlSafeToken(32);
  await db.setResetToken(dbHandle, user.id, token, Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL);
  return [user, token];
}

/** Validate token, set new password, clear token. Returns [user_id, null] or [null, error]. */
export async function redeemResetToken(
  dbHandle: D1Database,
  token: string,
  newPassword: string
): Promise<[number | null, string | null]> {
  if (newPassword.length < 8) return [null, "Password must be at least 8 characters."];
  const user = await db.getByResetToken(dbHandle, token);
  if (!user) return [null, "This reset link is invalid or has expired."];
  await db.setPassword(dbHandle, user.id, generatePasswordHash(newPassword));
  await db.clearResetToken(dbHandle, user.id);
  return [user.id, null];
}

/** Mirrors app.py's current_user(): resolves the full user row from a verified session. */
export async function currentUser(dbHandle: D1Database, session: SessionData | null): Promise<db.User | null> {
  if (!session?.user_id) return null;
  return db.getUserById(dbHandle, session.user_id);
}

/** Mirrors app.py's _login_user(): the session payload to sign after a successful
 * register/login/reset-redeem. Fetches fresh user fields (email/name) same as Flask did. */
export async function loginSessionData(dbHandle: D1Database, userId: number): Promise<Omit<SessionData, "exp"> | null> {
  const user = await db.getUserById(dbHandle, userId);
  if (!user) return null;
  return { user_id: user.id, user_email: user.email, user_name: user.name ?? "" };
}
