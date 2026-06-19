"""
South-African shipping quote — the money-critical, deliberately PLUGGABLE piece.

The customer-facing charging model is Luke's business decision (still open). So
rather than bake a number in, this module computes a quote from one of four
strategies, chosen by the SHIPPING_STRATEGY env var. Flip the var, no code
change:

  flat_free_over  (DEFAULT) – flat fee, but FREE over a threshold. The most
                              common, friendliest SA e-commerce model. Encourages
                              multi-buy (which is exactly where POD margin lives,
                              since per-parcel courier cost is front-loaded).
  flat                      – always a flat fee.
  passthrough               – charge the REAL estimated courier cost, computed
                              from the per-garment-type table below (first unit
                              full, each extra same-type unit discounted; mixed
                              types ship as separate parcels). Honest, but single
                              items look shipping-heavy.
  free                      – free shipping (cost baked into product prices).

Tune the numbers via env (all in ZAR cents):
  SHIPPING_FLAT_CENTS=8000        (R80 flat)
  SHIPPING_FREE_OVER_CENTS=80000  (free over R800)

The per-garment table below reflects the real per-parcel reality found in
testing (front-loaded, per-garment-type). Update it when the provider/quotes
are finalised; `passthrough` reads straight from it.
"""
from __future__ import annotations

import os

# Real per-parcel courier estimate, ZAR cents, per garment family.
#   first  – cost of the first unit of this family (a parcel gets opened)
#   extra  – each ADDITIONAL same-family unit in that parcel
# Different families ship as separate parcels (don't combine).
_FAMILY_SHIP = {
    "tee":       {"first": 25700, "extra": 7200},
    "sweatshirt": {"first": 28600, "extra": 7500},
    "hoodie":    {"first": 28600, "extra": 7500},
    "other":     {"first": 26000, "extra": 7200},
}


def _cents(env: str, default: int) -> int:
    try:
        return int(os.environ.get(env, default))
    except (TypeError, ValueError):
        return default


def strategy() -> str:
    return os.environ.get("SHIPPING_STRATEGY", "flat_free_over").strip().lower()


def family_for(slug: str) -> str:
    """Map a product slug to a shipping family."""
    s = (slug or "").lower()
    if "hood" in s:
        return "hoodie"
    if "sweat" in s or "crew" in s:
        return "sweatshirt"
    if "tee" in s or "shirt" in s or "tshirt" in s:
        return "tee"
    return "other"


def _passthrough_cost(lines: list[dict]) -> int:
    """Sum the real per-parcel estimate. `lines`: [{slug, quantity}]."""
    by_family: dict[str, int] = {}
    for ln in lines:
        fam = family_for(ln.get("slug", ""))
        by_family[fam] = by_family.get(fam, 0) + max(1, int(ln.get("quantity", 1)))
    total = 0
    for fam, qty in by_family.items():
        tbl = _FAMILY_SHIP.get(fam, _FAMILY_SHIP["other"])
        total += tbl["first"] + tbl["extra"] * max(0, qty - 1)
    return total


def quote(lines: list[dict], subtotal_cents: int, country: str = "ZA") -> dict:
    """Return a shipping quote for a cart.

    lines: [{slug, quantity}] · subtotal_cents: order subtotal (for thresholds).
    Returns {amount_cents, label, method, strategy, free_over_cents}.
    """
    strat = strategy()
    flat = _cents("SHIPPING_FLAT_CENTS", 8000)        # R80
    free_over = _cents("SHIPPING_FREE_OVER_CENTS", 80000)  # R800
    real = _passthrough_cost(lines)

    if strat == "free":
        amount, label = 0, "Free shipping"
    elif strat == "flat":
        amount, label = flat, "Standard shipping"
    elif strat == "passthrough":
        amount, label = real, "Courier (calculated)"
    else:  # flat_free_over (default)
        strat = "flat_free_over"
        if subtotal_cents >= free_over:
            amount, label = 0, f"Free shipping (over {_rand(free_over)})"
        else:
            amount, label = flat, "Standard shipping"

    return {
        "amount_cents": int(amount),
        "label": label,
        "method": strat,
        "strategy": strat,
        "free_over_cents": free_over if strat == "flat_free_over" else None,
        "real_estimate_cents": real,  # informational: the true courier estimate
        "country": country,
    }


def _rand(cents: int) -> str:
    return f"R{int(cents) / 100:,.0f}"
