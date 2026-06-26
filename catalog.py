"""
You Design Studios catalogue — OTC Printing products only.

Loads `data/otc_catalog.json`. All fulfilment is through OTC Printing (local-sa).

Public surface (kept stable for app.py + studio.js):
  PRODUCTS                 compat list for templates
  PRINT_AREA               front/back print dims (px @ DPI)
  studio_products(url_for) rich front-end payload (per-size retail, real hex)
  build_uid(slug, color_code, size_code, sides="front")  -> OTC order reference
  unit_price_cents(slug, size_code)                       -> retail for a size
  verify_item(slug, color_code, size_code)                -> structural guard
"""
from __future__ import annotations

import json
from pathlib import Path

_DATA = Path(__file__).resolve().parent / "data" / "otc_catalog.json"

_REF = {
    "t-shirts": "media/ref_tee.jpg",
    "hoodies":  "media/ref_hoodie.jpg",
    "headwear": "media/ref_tee.jpg",
}

# Default print area — overridden by the catalogue file when present. Matches
# printfile.py (30x40cm @ 300 DPI) so render + catalogue never disagree.
PRINT_AREA = {
    "front": {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
    "back":  {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
}


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

# Enlarge the printable area a touch so designs can be pushed a bit bigger on the
# shirt. MUST stay in sync with the 3D print-zone in garment3d.js (calibrateArea
# factors are this same PRINT_GROW) so the preview matches the printed result.
# Apparel only — caps/hats are hardware-limited (small fixed areas, skipped).
PRINT_GROW = 1.15


def _grow_print_area(pa: dict) -> dict:
    out = {}
    for side, a in (pa or {}).items():
        out[side] = dict(a)
        out[side]["w_cm"] = round(a["w_cm"] * PRINT_GROW, 1)
        out[side]["h_cm"] = round(a["h_cm"] * PRINT_GROW, 1)
        out[side]["w_px"] = int(round(a["w_px"] * PRINT_GROW))
        out[side]["h_px"] = int(round(a["h_px"] * PRINT_GROW))
    return out


for _b in BASES:
    _pa = _b.get("print_area")
    if _pa and _pa.get("front", {}).get("w_cm", 0) >= 20:   # apparel only
        _b["print_area"] = _grow_print_area(_pa)

if BASES and BASES[0].get("print_area"):
    PRINT_AREA = BASES[0]["print_area"]

_BY_SLUG = {b["slug"]: b for b in BASES}


def _ref_image(base: dict) -> str:
    return _REF.get(base.get("catalog", ""), "media/ref_tee.jpg")


# --------------------------------------------------------------- compat ----- #
def provider_of(slug: str) -> str:
    b = _BY_SLUG.get(slug)
    return (b or {}).get("provider", "local-sa")


def _compat_product(b: dict) -> dict:
    return {
        "slug": b["slug"],
        "name": b["name"],
        "blurb": b["blurb"],
        "provider": b.get("provider", "local-sa"),
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
        product_print_area = b.get("print_area") or PRINT_AREA
        out.append({
            "slug": b["slug"],
            "name": b["name"],
            "otc_garment": b.get("otc_garment", b["name"]),
            "blank": b.get("blank"),
            "blurb": b["blurb"],
            "gender": b.get("gender", "unisex"),
            "fabric": b.get("fabric"),
            "gsm": b.get("gsm"),
            "price": b.get("price_from"),
            "price_from": b.get("price_from"),
            "ref_image": url_for("static", filename=_ref_image(b)),
            "print_area": product_print_area,
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
    """Build an OTC order reference string used as the internal order identifier."""
    if not _BY_SLUG.get(slug):
        return None
    return f"otc_{slug}_{color_code}_{size_code}_{sides}"


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


# ----------------------------------------------------------- print upsize --- #
# Bigger prints cost more (OTC add-on). A line is "large" when the printed art
# WIDTH exceeds the threshold; at/below it the standard print is included in the
# base price. The threshold sits ABOVE the current 30cm max print width, so this
# stays dormant (no fee charged) until the print area is grown with the studio UI.
UPSIZE_THRESHOLD_W_CM = 31.0
UPSIZE_FEE_CENTS = {"light": 0, "dark": 0}   # DISABLED for now — bigger prints carry no extra charge yet (set to OTC's add-on × markup when ready)


def color_hex(slug: str, color_code: str) -> str | None:
    """Hex for a product's colour code (used to judge light vs dark for the fee)."""
    b = _BY_SLUG.get(slug)
    if not b:
        return None
    for c in b["colors"]:
        if c.get("gelato_code") == color_code:
            return c.get("hex")
    return None


def is_light_hex(hex_str: str | None) -> bool:
    """Perceived-luminance light test — mirrors studio.js isLightColor()."""
    h = (hex_str or "").lstrip("#")
    if len(h) < 6:
        return False
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.78


def _max_scale(placement) -> float:
    """Largest art width-scale across sides from a saved placement (JSON or dict)."""
    if isinstance(placement, str):
        try:
            placement = json.loads(placement)
        except (ValueError, TypeError):
            return 0.0
    if not isinstance(placement, dict):
        return 0.0
    best = 0.0
    for side in ("front", "back"):
        p = placement.get(side)
        if isinstance(p, dict) and p.get("scale") is not None:
            try:
                best = max(best, float(p["scale"]))
            except (TypeError, ValueError):
                pass
    return best


def is_large_print(placement, area_w_cm: float | None = None) -> bool:
    aw = float(area_w_cm if area_w_cm is not None else PRINT_AREA["front"]["w_cm"])
    return _max_scale(placement) * aw > UPSIZE_THRESHOLD_W_CM


def upsize_fee_cents(slug: str, color_code: str, placement,
                     area_w_cm: float | None = None) -> int:
    """Per-unit large-print add-on for this line, or 0 for a standard-size print."""
    if not is_large_print(placement, area_w_cm):
        return 0
    light = is_light_hex(color_hex(slug, color_code))
    return UPSIZE_FEE_CENTS["light"] if light else UPSIZE_FEE_CENTS["dark"]


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
    return True, "otc"
