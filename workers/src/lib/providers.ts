/**
 * providers.ts — fulfilment routing, ported 1:1 from providers.py.
 * THE anti-mix-up keystone: every order line must pass provider verification
 * before it can be priced or sent for fulfilment.
 */
import * as printful from "./printful";
import type { PrintfulEnv } from "./printful";

export const PRINTFUL = "printful";
export const LOCAL_SA = "local-sa";
export const SUPPORTED = [PRINTFUL, LOCAL_SA] as const;

// Grammar fingerprint — a bare integer catalog-variant id.
const PRINTFUL_UID = /^\d+$/;

/** Infer the provider purely from a UID's shape (no network). */
export function uidProvider(uid: string | number | null | undefined): string | null {
  if (uid === null || uid === undefined) return null;
  const u = String(uid).trim();
  if (PRINTFUL_UID.test(u)) return PRINTFUL;
  return null;
}

export function belongsTo(provider: string, uid: string): boolean {
  return uidProvider(uid) === provider;
}

export function hasKey(env: PrintfulEnv, provider: string): boolean {
  if (provider === PRINTFUL) return printful.hasKey(env);
  return false;
}

/** Route one line to its provider and validate it. Returns [ok, message]. */
export async function verify(
  env: PrintfulEnv,
  provider: string,
  uid: string,
  expectedCategory?: string | null
): Promise<[boolean, string]> {
  if (!SUPPORTED.includes(provider as (typeof SUPPORTED)[number])) {
    return [false, `Unknown provider '${provider}'`];
  }
  if (!uid) return [false, "Missing product UID"];
  if (provider === LOCAL_SA) {
    // Fulfilled via the SA printer dashboard (OTC Printing) — no live API check
    // needed. The structural catalogue guard (verifyItem) has already passed.
    return [true, "local-sa"];
  }
  // Printful UIDs are bare integers — reject on shape first, so a UID can never
  // be sent to the wrong factory even before a network call.
  if (!belongsTo(provider, uid)) {
    return [
      false,
      `UID does not belong to provider '${provider}' (grammar says '${uidProvider(uid) ?? "unknown"}'): ${String(uid).slice(0, 48)}`,
    ];
  }
  return printful.verifyVariant(env, uid, expectedCategory);
}

interface ProviderItem {
  provider?: string;
  [key: string]: unknown;
}

/** Split a cart into per-provider buckets — each becomes its own fulfilment
 * order (a mixed cart can mean more than one shipment). */
export function groupByProvider(items: ProviderItem[]): Record<string, ProviderItem[]> {
  const out: Record<string, ProviderItem[]> = {};
  for (const it of items) {
    const key = it.provider ?? "unknown";
    (out[key] ??= []).push(it);
  }
  return out;
}
