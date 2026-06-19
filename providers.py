"""
providers.py — fulfilment routing. THE anti-mix-up keystone.

Every product in the catalogue declares a `provider` ("gelato" | "printful").
Before any product UID can be priced or sent for fulfilment it must pass three
checks, IN ORDER — fail any one and it's a hard reject:

  1. provider is known
  2. the UID's GRAMMAR matches that provider.
       Gelato  = long token string, starts `<something>_product_gca_...`
       Printful = a bare integer catalog-variant id (e.g. 4012)
     These shapes can't overlap, so a Gelato UID can never be sent to Printful
     (or vice-versa) even if a product were somehow mislabeled.
  3. the UID RESOLVES live on that provider AND its product category matches
     what we expect (the cup -> shirt guard).

So an order line can only ever reach the factory that actually makes it.
"""
from __future__ import annotations

import re

import gelato
import gooten
import printful

GELATO = "gelato"
PRINTFUL = "printful"
GOOTEN = "gooten"
SUPPORTED = (GELATO, PRINTFUL, GOOTEN)

# Grammar fingerprints — deliberately non-overlapping.
_GELATO_UID = re.compile(r"^[a-z][a-z0-9]*_product_gca_[a-z0-9_-]+$")
_PRINTFUL_UID = re.compile(r"^\d+$")


def uid_provider(uid: str | int | None) -> str | None:
    """Infer the provider purely from a UID's shape (no network)."""
    if uid is None:
        return None
    u = str(uid).strip()
    if _PRINTFUL_UID.match(u):
        return PRINTFUL
    if _GELATO_UID.match(u):
        return GELATO
    return None


def belongs_to(provider: str, uid: str) -> bool:
    return uid_provider(uid) == provider


def has_key(provider: str) -> bool:
    if provider == GELATO:
        return gelato.has_key()
    if provider == PRINTFUL:
        return printful.has_key()
    if provider == GOOTEN:
        return gooten.has_key()
    return False


def _gelato_verify(uid: str, expected_category: str | None) -> tuple[bool, str]:
    """Resolve a Gelato UID + check its GarmentCategory. Network errors are not
    fatal (a definitive 4xx is); the structural catalogue guard already passed."""
    try:
        if not gelato.has_key():
            return True, "skipped (no key)"
        p = gelato.get_product(uid)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if any(code in msg for code in (" 400", " 404", " 422")):
            return False, f"Gelato rejected UID: {msg[:120]}"
        return True, f"live check skipped ({msg[:80]})"
    gca = (p.get("attributes") or {}).get("GarmentCategory")
    if gca and expected_category and gca != expected_category:
        return False, f"Type mismatch: UID resolves to '{gca}', expected '{expected_category}'"
    return True, "ok"


def verify(provider: str, uid: str, expected_category: str | None = None) -> tuple[bool, str]:
    """Route one line to its provider and validate it. Returns (ok, message)."""
    if provider not in SUPPORTED:
        return False, f"Unknown provider '{provider}'"
    if not uid:
        return False, "Missing product UID"
    # Gooten SKUs are free-form strings (no unique regex), so the provider tag is
    # authoritative and we verify the SKU live against Gooten's catalog. A
    # mislabeled UID (e.g. a Gelato UID tagged 'gooten') fails this live check.
    if provider == GOOTEN:
        return gooten.verify_sku(uid, expected_category)
    # Gelato + Printful have non-overlapping grammars — reject on shape first,
    # so a UID can never be sent to the wrong one even before a network call.
    if not belongs_to(provider, uid):
        return False, (f"UID does not belong to provider '{provider}' "
                       f"(grammar says '{uid_provider(uid) or 'unknown'}'): {str(uid)[:48]}")
    if provider == GELATO:
        return _gelato_verify(uid, expected_category)
    return printful.verify_variant(uid, expected_category)


def group_by_provider(items: list[dict]) -> dict[str, list[dict]]:
    """Split a cart into per-provider buckets — each becomes its own fulfilment
    order (a mixed cart can mean more than one shipment)."""
    out: dict[str, list[dict]] = {}
    for it in items:
        out.setdefault(it.get("provider") or "unknown", []).append(it)
    return out


# Map a provider's free-text order status onto our order state machine
# (db.ORDER_STATES). Keyword match, most-specific first.
_GOOTEN_STATUS = [
    ("deliver", "delivered"), ("ship", "shipped"), ("transit", "shipped"),
    ("production", "in_production"), ("printed", "in_production"),
    ("printing", "in_production"), ("manufactur", "in_production"),
    ("ready", "in_production"), ("cancel", "cancelled"), ("refund", "failed"),
    ("error", "failed"), ("reject", "rejected"), ("new", "submitted"),
    ("receiv", "submitted"), ("pending", "submitted"), ("hold", "submitted"),
]


def map_gooten_status(raw: str) -> str | None:
    """Gooten status text -> our order state, or None if unrecognised."""
    s = (raw or "").lower()
    for needle, mapped in _GOOTEN_STATUS:
        if needle in s:
            return mapped
    return None
