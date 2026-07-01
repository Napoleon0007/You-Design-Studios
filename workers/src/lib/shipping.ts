/**
 * South-African shipping quote — ported 1:1 from shipping.py.
 *
 * Flask read strategy/tuning from os.environ; Workers doesn't have a global
 * process.env populated from wrangler config, so these take an explicit
 * `env`-like object (the route handler passes `c.env` straight through —
 * same values, same env var names, just threaded explicitly instead of global).
 */

export interface ShippingEnv {
  SHIPPING_STRATEGY?: string;
  SHIPPING_FLAT_CENTS?: string;
  SHIPPING_FREE_OVER_CENTS?: string;
}

interface FamilyShip {
  first: number;
  extra: number;
}

// Real per-parcel courier estimate, ZAR cents, per garment family.
//   first – cost of the first unit of this family (a parcel gets opened)
//   extra – each ADDITIONAL same-family unit in that parcel
// Different families ship as separate parcels (don't combine).
const FAMILY_SHIP: Record<string, FamilyShip> = {
  tee: { first: 25700, extra: 7200 },
  sweatshirt: { first: 28600, extra: 7500 },
  hoodie: { first: 28600, extra: 7500 },
  other: { first: 26000, extra: 7200 },
};

function cents(env: ShippingEnv, key: keyof ShippingEnv, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function strategy(env: ShippingEnv): string {
  return (env.SHIPPING_STRATEGY ?? "flat_free_over").trim().toLowerCase();
}

export function familyFor(slug: string): string {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("hood")) return "hoodie";
  if (s.includes("sweat") || s.includes("crew")) return "sweatshirt";
  if (s.includes("tee") || s.includes("shirt") || s.includes("tshirt")) return "tee";
  return "other";
}

interface CartLine {
  slug?: string;
  quantity?: number;
}

function passthroughCost(lines: CartLine[]): number {
  const byFamily: Record<string, number> = {};
  for (const ln of lines) {
    const fam = familyFor(ln.slug ?? "");
    byFamily[fam] = (byFamily[fam] ?? 0) + Math.max(1, ln.quantity ?? 1);
  }
  let total = 0;
  for (const [fam, qty] of Object.entries(byFamily)) {
    const tbl = FAMILY_SHIP[fam] ?? FAMILY_SHIP.other;
    total += tbl.first + tbl.extra * Math.max(0, qty - 1);
  }
  return total;
}

function rand(centsAmt: number): string {
  return `R${Math.round(centsAmt / 100).toLocaleString("en-ZA")}`;
}

export interface ShippingQuote {
  amount_cents: number;
  label: string;
  method: string;
  strategy: string;
  free_over_cents: number | null;
  real_estimate_cents: number;
  country: string;
}

/** Return a shipping quote for a cart. lines: [{slug, quantity}] · subtotalCents: order subtotal (for thresholds). */
export function quote(
  env: ShippingEnv,
  lines: CartLine[],
  subtotalCents: number,
  country: string = "ZA"
): ShippingQuote {
  let strat = strategy(env);
  const flat = cents(env, "SHIPPING_FLAT_CENTS", 8000); // R80
  const freeOver = cents(env, "SHIPPING_FREE_OVER_CENTS", 80000); // R800
  const real = passthroughCost(lines);

  let amount: number, label: string;
  if (strat === "free") {
    amount = 0;
    label = "Free shipping";
  } else if (strat === "flat") {
    amount = flat;
    label = "Standard shipping";
  } else if (strat === "passthrough") {
    amount = real;
    label = "Courier (calculated)";
  } else {
    strat = "flat_free_over";
    if (subtotalCents >= freeOver) {
      amount = 0;
      label = `Free shipping (over ${rand(freeOver)})`;
    } else {
      amount = flat;
      label = "Standard shipping";
    }
  }

  return {
    amount_cents: Math.round(amount),
    label,
    method: strat,
    strategy: strat,
    free_over_cents: strat === "flat_free_over" ? freeOver : null,
    real_estimate_cents: real,
    country,
  };
}
