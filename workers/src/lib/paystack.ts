/**
 * paystack.ts — Paystack payment client (South Africa), ported 1:1 from paystack.py.
 *
 * Paystack charges the card immediately (it does NOT hold/authorise-then-capture
 * for one-off cards), then settles funds to your bank ~T+1/T+2. So our "escrow"
 * is the ORDER STATE, not a card hold: we take the money, hold the order in
 * 'in_review', and either release to the factory on approval or REFUND on reject.
 *
 * Test vs live is just which key is bound as a Worker secret — no code change to
 * go live: PAYSTACK_SECRET_KEY=sk_test_.../sk_live_..., PAYSTACK_PUBLIC_KEY=pk_test_.../pk_live_...
 *
 * Amounts are in the currency SUBUNIT (ZAR cents) — matches how db.ts already
 * stores prices, so order totals pass straight through.
 */

export interface PaystackEnv {
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_PUBLIC_KEY?: string;
}

const BASE = "https://api.paystack.co";

export class PaystackError extends Error {}

export function secretKey(env: PaystackEnv): string {
  return (env.PAYSTACK_SECRET_KEY ?? "").trim();
}

export function publicKey(env: PaystackEnv): string {
  return (env.PAYSTACK_PUBLIC_KEY ?? "").trim();
}

export function hasKeys(env: PaystackEnv): boolean {
  return Boolean(secretKey(env));
}

export function isTest(env: PaystackEnv): boolean {
  return secretKey(env).startsWith("sk_test");
}

async function request(env: PaystackEnv, method: string, path: string, body?: unknown): Promise<any> {
  if (!hasKeys(env)) {
    throw new PaystackError("PAYSTACK_SECRET_KEY not set — add a test key (wrangler secret / .dev.vars)");
  }
  // A real User-Agent is REQUIRED: api.paystack.co sits behind Cloudflare, which
  // bans a missing/default UA with HTTP 403 Error 1010 (browser_signature_banned)
  // — the silent reason checkout never reached a card page. Preserve exactly.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey(env)}`,
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; YouDesignStudios/1.0; +https://youdesignstudios.co.za)",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new PaystackError(`Network error reaching Paystack: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new PaystackError(`Paystack ${res.status} on ${method} ${path}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

// --------------------------------------------------------------- payments --- //

/** Start a checkout. Returns {authorization_url, access_code, reference}.
 * `amountCents` is the ZAR subunit (R399.00 -> 39900), matching db cents. */
export async function initializeTransaction(
  env: PaystackEnv,
  email: string,
  amountCents: number,
  reference: string,
  currency: string = "ZAR",
  callbackUrl?: string,
  metadata?: Record<string, unknown>
): Promise<any> {
  const body: Record<string, unknown> = { email, amount: Math.round(amountCents), currency, reference };
  if (callbackUrl) body.callback_url = callbackUrl;
  if (metadata) body.metadata = metadata;
  const res = await request(env, "POST", "/transaction/initialize", body);
  if (!res?.status) throw new PaystackError(`initialize failed: ${res?.message}`);
  return res.data;
}

/** Confirm a payment. Returns the transaction data (check data.status === 'success'). */
export async function verifyTransaction(env: PaystackEnv, reference: string): Promise<any> {
  const res = await request(env, "GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  if (!res?.status) throw new PaystackError(`verify failed: ${res?.message}`);
  return res.data;
}

/** Refund a transaction (full, or partial if amountCents given). Last-resort path
 * when a rejected design can't be redone. Note: the gateway fee is NOT returned —
 * every refund costs ~the Paystack fee, so prefer the redo flow. */
export async function refund(env: PaystackEnv, reference: string, amountCents?: number): Promise<any> {
  const body: Record<string, unknown> = { transaction: reference };
  if (amountCents !== undefined) body.amount = Math.round(amountCents);
  const res = await request(env, "POST", "/refund", body);
  if (!res?.status) throw new PaystackError(`refund failed: ${res?.message}`);
  return res.data;
}

// ---------------------------------------------------------------- webhook --- //

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Paystack signs webhook bodies with HMAC-SHA512 using your SECRET key.
 * Reject any /api/webhooks/paystack call whose x-paystack-signature fails this. */
export async function verifyWebhook(env: PaystackEnv, rawBody: string, signature: string): Promise<boolean> {
  if (!signature || !hasKeys(env)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey(env)),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return timingSafeEqual(toHex(digest), signature);
}
