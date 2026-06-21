"""
You Design Studios catalogue — VERIFIED, apparel only.

Loads `data/gelato_apparel.json` (built by build_apparel_catalog.py from the
LIVE Gelato Catalog API). Every product UID here was pulled and verified to
resolve against Gelato — never hand-typed — so an order can't map to the wrong
product (Luke's #1 concern: no cup -> shirt).

Public surface (kept stable for app.py + studio.js):
  PRODUCTS                 compat list for templates
  PRINT_AREA               front/back print dims (px @ DPI)
  studio_products(url_for) rich front-end payload (per-size retail, real hex)
  build_uid(slug, color_code, size_code, sides="front")  -> exact Gelato UID
  unit_price_cents(slug, size_code)                       -> retail for a size
  verify_item(slug, color_code, size_code)                -> structural guard
  live_verify_uid(uid, expected_gca)                      -> live Gelato guard

If the verified file is missing the module still imports (empty catalogue) so
the app boots; run `python3 build_apparel_catalog.py` to populate it.
"""
from __future__ import annotations

import json
from pathlib import Path

_DATA = Path(__file__).resolve().parent / "data" / "gelato_apparel.json"

# Reference photos per garment category (real per-garment/colour photos are a
# separate open TODO; the studio also tints these via the --garment CSS var).
_REF = {
    "t-shirt": "media/ref_tee.jpg",
    "hoodie": "media/ref_hoodie.jpg",
    "sweatshirt": "media/ref_hoodie.jpg",
}

# Default print area — overridden by the catalogue file when present. Matches
# printfile.py (30x40cm @ 300 DPI) so render + catalogue never disagree.
PRINT_AREA = {
    "front": {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
    "back":  {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
}

# Print-config tokens (gpr_): which sides carry artwork.
PRINT_TOKENS = {"front": "4-0", "back": "0-4", "both": "4-4"}


def _load() -> dict:
    if _DATA.exists():
        try:
            return json.loads(_DATA.read_text())
        except (ValueError, OSError):
            pass
    return {"mode": "stub", "currency": "ZAR", "bases": []}


_CATALOG = _load()
MODE = _CATALOG.get("mode", "stub")
CURRENCY = _CATALOG.get("currency", "ZAR")
MARKUP = _CATALOG.get("markup")
BASES = _CATALOG.get("bases", [])
if BASES and BASES[0].get("print_area"):
    PRINT_AREA = BASES[0]["print_area"]

_BY_SLUG = {b["slug"]: b for b in BASES}


def _ref_image(base: dict) -> str:
    return _REF.get(base.get("attrs", {}).get("gca", ""), "media/ref_tee.jpg")


# --------------------------------------------------------------- compat ----- #
def provider_of(slug: str) -> str:
    """Which fulfilment system makes this product. Single source of truth."""
    b = _BY_SLUG.get(slug)
    return (b or {}).get("provider", "gelato")


def _compat_product(b: dict) -> dict:
    """Shape the templates/orders expect (price = the 'from' retail)."""
    return {
        "slug": b["slug"],
        "name": b["name"],
        "blurb": b["blurb"],
        "provider": b.get("provider", "gelato"),
        "gender": b.get("gender", "unisex"),
        "price": b.get("price_from"),
        "ref_image": _ref_image(b),
        "colors": [{"name": c["name"], "hex": c["hex"],
                    "gelato_code": c["gelato_code"]} for c in b["colors"]],
        "sizes": [{"label": s["label"], "gelato_code": s["code"]} for s in b["sizes"]],
    }


PRODUCTS = [_compat_product(b) for b in BASES]


def studio_products(url_for) -> list[dict]:
    """Front-end payload. `url_for` is Flask's static URL builder."""
    out = []
    for b in BASES:
        out.append({
            "slug": b["slug"],
            "name": b["name"],
            "blank": b.get("blank"),
            "blurb": b["blurb"],
            "gender": b.get("gender", "unisex"),
            "fabric": b.get("fabric"),
            "gsm": b.get("gsm"),
            "price": b.get("price_from"),       # display "from"; sizes carry their own
            "price_from": b.get("price_from"),
            "ref_image": url_for("static", filename=_ref_image(b)),
            "print_area": PRINT_AREA,
            "uid_template": build_uid(b["slug"], "{color}", "{size}", "front"),
            "colors": [{"name": c["name"], "hex": c["hex"],
                        "gelato_code": c["gelato_code"]} for c in b["colors"]],
            "sizes": [{"label": s["label"], "gelato_code": s["code"],
                       "retail": s.get("retail_zar")} for s in b["sizes"]],
        })
    return out


# --------------------------------------------------------------- UIDs ------- #
def build_uid(slug: str, color_code: str, size_code: str,
              sides: str = "front") -> str | None:
    """Compose the exact Gelato product UID. `sides` in front/back/both."""
    b = _BY_SLUG.get(slug)
    if not b:
        return None
    a = b["attrs"]
    gpr = PRINT_TOKENS.get(sides, "4-0")
    return (f"apparel_product_gca_{a['gca']}_gsc_{a['gsc']}_gcu_{a['gcu']}"
            f"_gqa_{a['gqa']}_gsi_{size_code}_gco_{color_code}_gpr_{gpr}_{a['brand']}")


def sides_for(has_front: bool, has_back: bool) -> str:
    if has_front and has_back:
        return "both"
    return "back" if has_back else "front"


# --------------------------------------------------------------- pricing ---- #
def unit_price_cents(slug: str, size_code: str) -> int:
    """Retail price (cents) for a specific size; falls back to 'from' price."""
    b = _BY_SLUG.get(slug)
    if not b:
        return 0
    for s in b["sizes"]:
        if s["code"] == size_code and s.get("retail_zar"):
            return int(round(s["retail_zar"] * 100))
    return int(round((b.get("price_from") or 0) * 100))


# --------------------------------------------------------------- guards ----- #
def verify_item(slug: str, color_code: str, size_code: str) -> tuple[bool, str]:
    """STRUCTURAL guard (offline): the variant must exist in our verified
    catalogue. Returns (ok, expected_gca) or (False, reason)."""
    b = _BY_SLUG.get(slug)
    if not b:
        return False, f"Unknown product '{slug}'"
    if size_code not in {s["code"] for s in b["sizes"]}:
        return False, f"Size '{size_code}' not offered for {b['name']}"
    if color_code not in {c["gelato_code"] for c in b["colors"]}:
        return False, f"Colour '{color_code}' not offered for {b['name']}"
    return True, b["attrs"]["gca"]
