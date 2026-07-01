/**
 * bundles.ts — multi-buy pricing, ported 1:1 from bundles.py.
 * Pure functions, no I/O. Env-tunable like shipping.ts (explicit env param,
 * not global process.env — Workers doesn't populate that from wrangler vars).
 */

export interface BundleEnv {
  BUNDLE_STRATEGY?: string;
  BUNDLE_TIER2_PCT?: string;
  BUNDLE_TIER3_PCT?: string;
  BUNDLE_TIER4_PCT?: string;
  BUNDLE_NTH_PCT?: string;
}

const DEF_TIERS: Record<number, number> = { 2: 10, 3: 15, 4: 20 };

function pct(env: BundleEnv, key: keyof BundleEnv, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(90, n));
}

export function strategy(env: BundleEnv): string {
  return (env.BUNDLE_STRATEGY ?? "tiered_pct").trim().toLowerCase();
}

function tiers(env: BundleEnv): Record<number, number> {
  return {
    2: pct(env, "BUNDLE_TIER2_PCT", DEF_TIERS[2]),
    3: pct(env, "BUNDLE_TIER3_PCT", DEF_TIERS[3]),
    4: pct(env, "BUNDLE_TIER4_PCT", DEF_TIERS[4]),
  };
}

interface CartLine {
  slug?: string;
  quantity?: number;
  unit_price?: number;
}

function unitPrices(lines: CartLine[]): number[] {
  const out: number[] = [];
  for (const ln of lines) {
    const price = ln.unit_price ?? 0;
    const qty = Math.max(1, ln.quantity ?? 1);
    for (let i = 0; i < qty; i++) out.push(price);
  }
  return out;
}

function tierFor(qty: number, tierMap: Record<number, number>): [number, number] {
  let bestPct = 0;
  let bestThresh = 0;
  for (const t of Object.keys(tierMap).map(Number).sort((a, b) => a - b)) {
    if (qty >= t && tierMap[t] >= bestPct) {
      bestPct = tierMap[t];
      bestThresh = t;
    }
  }
  return [bestPct, bestThresh];
}

function rand(centsAmt: number): string {
  return `R${Math.round(centsAmt / 100).toLocaleString("en-ZA")}`;
}

export interface NextOffer {
  kind: "bundle" | "shipping";
  add_qty?: number;
  unlock_pct?: number;
  you_save_cents?: number;
  gap_cents?: number;
  label: string;
}

export interface BundleQuote {
  strategy: string;
  total_qty: number;
  original_subtotal_cents: number;
  discount_cents: number;
  discounted_subtotal_cents: number;
  tier_label: string | null;
  applied: boolean;
  next_offer: NextOffer | null;
  note: string;
}

function nextOffer(
  strat: string,
  units: number[],
  subtotal: number,
  discount: number,
  discounted: number,
  tierMap: Record<number, number>,
  freeOverCents: number | null | undefined
): NextOffer | null {
  const qty = units.length;
  if (strat === "tiered_pct") {
    const avg = qty ? Math.round(subtotal / qty) : 0;
    for (const t of Object.keys(tierMap).map(Number).sort((a, b) => a - b)) {
      if (t > qty && tierMap[t] > 0) {
        const add = t - qty;
        const projSub = subtotal + avg * add;
        const projDisc = Math.round((projSub * tierMap[t]) / 100);
        const extraSaved = projDisc - discount;
        if (extraSaved > 0) {
          return {
            kind: "bundle",
            add_qty: add,
            unlock_pct: tierMap[t],
            you_save_cents: extraSaved,
            label: `Add ${add} more and save ${tierMap[t]}% on your order`,
          };
        }
        break;
      }
    }
  }
  if (freeOverCents && discounted < freeOverCents) {
    const gap = freeOverCents - discounted;
    return { kind: "shipping", gap_cents: gap, label: `You're ${rand(gap)} away from free shipping` };
  }
  return null;
}

/** Compute the bundle discount + the best next-step nudge for a cart. */
export function quote(
  env: BundleEnv,
  lines: CartLine[],
  freeOverCents?: number | null
): BundleQuote {
  const units = unitPrices(lines);
  const qty = units.length;
  const subtotal = units.reduce((a, b) => a + b, 0);
  let strat = strategy(env);
  const tierMap = tiers(env);

  let discount = 0;
  let label: string | null = null;
  if (strat === "none" || qty === 0) {
    strat = "none";
  } else if (strat === "nth_off") {
    const nth = pct(env, "BUNDLE_NTH_PCT", 25);
    const extras = [...units].sort((a, b) => b - a).slice(1);
    discount = Math.round(extras.reduce((s, p) => s + (p * nth) / 100, 0));
    if (extras.length && nth) label = `Extra items ${nth}% off`;
  } else {
    strat = "tiered_pct";
    const [p, thresh] = tierFor(qty, tierMap);
    discount = Math.round((subtotal * p) / 100);
    if (p) label = `Buy ${thresh}+ · ${p}% off`;
  }

  discount = Math.max(0, Math.min(discount, subtotal));
  const discounted = subtotal - discount;

  return {
    strategy: strat,
    total_qty: qty,
    original_subtotal_cents: subtotal,
    discount_cents: discount,
    discounted_subtotal_cents: discounted,
    tier_label: label,
    applied: discount > 0,
    next_offer: nextOffer(strat, units, subtotal, discount, discounted, tierMap, freeOverCents),
    note: "Discount tiers are placeholders — tune via BUNDLE_* env, Luke's call.",
  };
}
