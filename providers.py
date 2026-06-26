"""
providers.py — fulfilment routing. THE anti-mix-up keystone.

Every product in the catalogue declares a `provider`. Today all live products
are fulfilled in South Africa via OTC Printing ("local-sa"). A "printful" path
is retained for its integer-UID grammar guard but is dormant — nothing is sent
there unless a product is explicitly tagged 'printful'.

Before any product UID can be priced or sent for fulfilment it must pass, IN
ORDER — fail any one and it's a hard reject:

  1. provider is known
  2. the UID's GRAMMAR matches that provider.
       Printful = a bare integer catalog-variant id (e.g. 4012)
  3. the UID RESOLVES live on that provider AND its product category matches
     what we expect (the cup -> shirt guard).

So an order line can only ever reach the factory that actually makes it.
local-sa lines skip the live API check — they are routed to the SA printer
dashboard, and the structural catalogue guard (verify_item) has already passed.
"""
from __future__ import annotations

import re

import printful

PRINTFUL = "printful"
LOCAL_SA = "local-sa"
SUPPORTED = (PRINTFUL, LOCAL_SA)

# Grammar fingerprint — a bare integer catalog-variant id.
_PRINTFUL_UID = re.compile(r"^\d+$")


def uid_provider(uid: str | int | None) -> str | None:
    """Infer the provider purely from a UID's shape (no network)."""
    if uid is None:
        return None
    u = str(uid).strip()
    if _PRINTFUL_UID.match(u):
        return PRINTFUL
    return None


def belongs_to(provider: str, uid: str) -> bool:
    return uid_provider(uid) == provider


def has_key(provider: str) -> bool:
    if provider == PRINTFUL:
        return printful.has_key()
    return False


def verify(provider: str, uid: str, expected_category: str | None = None) -> tuple[bool, str]:
    """Route one line to its provider and validate it. Returns (ok, message)."""
    if provider not in SUPPORTED:
        return False, f"Unknown provider '{provider}'"
    if not uid:
        return False, "Missing product UID"
    if provider == LOCAL_SA:
        # Fulfilled via the SA printer dashboard (OTC Printing) — no live API
        # check needed. The structural catalogue guard (verify_item) has already
        # passed.
        return True, "local-sa"
    # Printful UIDs are bare integers — reject on shape first, so a UID can never
    # be sent to the wrong factory even before a network call.
    if not belongs_to(provider, uid):
        return False, (f"UID does not belong to provider '{provider}' "
                       f"(grammar says '{uid_provider(uid) or 'unknown'}'): {str(uid)[:48]}")
    return printful.verify_variant(uid, expected_category)


def group_by_provider(items: list[dict]) -> dict[str, list[dict]]:
    """Split a cart into per-provider buckets — each becomes its own fulfilment
    order (a mixed cart can mean more than one shipment)."""
    out: dict[str, list[dict]] = {}
    for it in items:
        out.setdefault(it.get("provider") or "unknown", []).append(it)
    return out
