"""
bundles.py — multi-buy pricing, the deliberately PLUGGABLE upsell engine (#8).

Why it exists: POD courier cost is front-loaded (the first unit pays most of the
parcel; each extra same-garment unit is cheap — see shipping.py). So margin lives
in MULTI-BUY. This engine rewards bigger baskets and surfaces the nudge that gets
there ("add a 2nd and save 10%", "you're R120 from free shipping").

Like shipping.py, the customer-facing numbers are LUKE'S business decision, so
nothing is baked in — a strategy is chosen by the BUNDLE_STRATEGY env var and the
tiers are tunable via env. Flip the var, no code change:

  tiered_pct  (DEFAULT) — a whole-order % discount that grows with total garment
                          quantity:  2 → 10% · 3 → 15% · 4+ → 20%.
  nth_off               — the 1st (priciest) unit full price; every additional
                          unit gets BUNDLE_NTH_PCT off (default 25%).
  none                  — no bundle discount.

Tune via env (percentages as whole numbers):
  BUNDLE_TIER2_PCT=10  BUNDLE_TIER3_PCT=15  BUNDLE_TIER4_PCT=20
  BUNDLE_NTH_PCT=25

Pure functions, no DB, no I/O — trivially testable. `quote()` is informational
(like shipping.quote); applying the discount to the CHARGED total is a one-line
hook in checkout (subtract `discount_cents` before computing the total), wired in
the coordinated checkout step so this engine doesn't touch the live checkout now.
"""
from __future__ import annotations

import os

_DEF_TIERS = {2: 10, 3: 15, 4: 20}   # qty threshold -> % off whole order


def _pct(env: str, default: int) -> int:
    try:
        return max(0, min(90, int(os.environ.get(env, default))))
    except (TypeError, ValueError):
        return default


def strategy() -> str:
    return os.environ.get("BUNDLE_STRATEGY", "tiered_pct").strip().lower()


def _tiers() -> dict[int, int]:
    return {
        2: _pct("BUNDLE_TIER2_PCT", _DEF_TIERS[2]),
        3: _pct("BUNDLE_TIER3_PCT", _DEF_TIERS[3]),
        4: _pct("BUNDLE_TIER4_PCT", _DEF_TIERS[4]),
    }


def _unit_prices(lines: list[dict]) -> list[int]:
    """Expand cart lines into one price per physical unit (cents)."""
    out: list[int] = []
    for ln in lines:
        price = int(ln.get("unit_price", 0))
        out.extend([price] * max(1, int(ln.get("quantity", 1))))
    return out


def _tier_for(qty: int, tiers: dict[int, int]) -> tuple[int, int]:
    """Return (applied_pct, tier_threshold) for a given total quantity."""
    pct, thresh = 0, 0
    for t in sorted(tiers):
        if qty >= t and tiers[t] >= pct:
            pct, thresh = tiers[t], t
    return pct, thresh


def quote(lines: list[dict], *, free_over_cents: int | None = None) -> dict:
    """Compute the bundle discount + the best next-step nudge for a cart.

    lines: [{slug, quantity, unit_price(cents)}]
    Returns subtotal/discount/discounted totals, a tier label, and `next_offer`
    (the single most valuable nudge: reach the next discount tier, or hit the
    free-shipping threshold).
    """
    units = _unit_prices(lines)
    qty = len(units)
    subtotal = sum(units)
    strat = strategy()
    tiers = _tiers()

    discount = 0
    label = None
    if strat == "none" or qty == 0:
        strat = "none"
    elif strat == "nth_off":
        nth = _pct("BUNDLE_NTH_PCT", 25)
        # priciest unit full price; every additional unit discounted
        extras = sorted(units, reverse=True)[1:]
        discount = round(sum(p * nth / 100 for p in extras))
        if extras and nth:
            label = f"Extra items {nth}% off"
    else:  # tiered_pct (default)
        strat = "tiered_pct"
        pct, thresh = _tier_for(qty, tiers)
        discount = round(subtotal * pct / 100)
        if pct:
            label = f"Buy {thresh}+ · {pct}% off"

    discount = max(0, min(discount, subtotal))
    discounted = subtotal - discount

    return {
        "strategy": strat,
        "total_qty": qty,
        "original_subtotal_cents": subtotal,
        "discount_cents": discount,
        "discounted_subtotal_cents": discounted,
        "tier_label": label,
        "applied": discount > 0,
        "next_offer": _next_offer(strat, units, subtotal, discount, discounted,
                                  tiers, free_over_cents),
        "note": "Discount tiers are placeholders — tune via BUNDLE_* env, Luke's call.",
    }


def _next_offer(strat: str, units: list[int], subtotal: int, discount: int,
                discounted: int, tiers: dict[int, int],
                free_over_cents: int | None) -> dict | None:
    """The single most valuable nudge to show. Prefers an in-reach bundle tier;
    falls back to the free-shipping gap. Returns None if nothing to suggest."""
    qty = len(units)
    # 1) next bundle tier (tiered_pct) — adding units to unlock a bigger % off
    if strat == "tiered_pct":
        avg = round(subtotal / qty) if qty else 0
        for t in sorted(tiers):
            if t > qty and tiers[t] > 0:
                add = t - qty
                proj_sub = subtotal + avg * add
                proj_disc = round(proj_sub * tiers[t] / 100)
                # extra saved vs paying full for the added units at today's discount
                extra_saved = proj_disc - discount
                if extra_saved > 0:
                    return {
                        "kind": "bundle",
                        "add_qty": add,
                        "unlock_pct": tiers[t],
                        "you_save_cents": extra_saved,
                        "label": f"Add {add} more and save {tiers[t]}% on your order",
                    }
                break
    # 2) free-shipping gap
    if free_over_cents and discounted < free_over_cents:
        gap = free_over_cents - discounted
        return {
            "kind": "shipping",
            "gap_cents": gap,
            "label": f"You're {_rand(gap)} away from free shipping",
        }
    return None


def _rand(cents: int) -> str:
    return f"R{int(cents) / 100:,.0f}"
