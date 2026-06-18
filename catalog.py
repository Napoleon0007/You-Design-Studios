"""
INKHAUS catalogue.

MOCK now — but structured exactly like Gelato's Product Catalog API so it flips
to live the moment a real Gelato API key is added:

  * Gelato product UIDs follow the real token format, e.g.
    apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_premium
    _gsi_{size}_gco_{color}_gpr_4-0
  * Each colour carries a `gelato_code` (Gelato's colour token) + a reference
    image (Gelato's flat product photo / a Grok-made stand-in for now).
  * Each size carries Gelato's size token.
  * Print areas mirror Gelato apparel print files (~30×40cm @ 300 DPI).

When the key lands, swap `MODE = "live"` and replace `STUDIO_PRODUCTS` with a
pull from product.gelatoapis.com (UIDs/variants/previewUrl already match).
"""
from __future__ import annotations

MODE = "mock"  # -> "live" once a Gelato API key is wired

# Gelato UID templates per garment. {size}/{color} are filled per variant.
UID_TEMPLATES = {
    "heavy-hoodie": "apparel_product_gca_hoodie_gsc_pullover_gcu_unisex_gqa_premium_gsi_{size}_gco_{color}_gpr_4-0",
    "oversized-tee": "apparel_product_gca_t-shirt_gsc_crewneck_gcu_unisex_gqa_premium_gsi_{size}_gco_{color}_gpr_4-0",
}

# Print areas (front/back) — cm + px @ 300 DPI, matching Gelato apparel files.
PRINT_AREA = {
    "front": {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
    "back":  {"w_cm": 30, "h_cm": 40, "w_px": 3543, "h_px": 4724, "dpi": 300},
}

PRODUCTS = [
    {
        "slug": "heavy-hoodie",
        "name": "Heavyweight Hoodie",
        "blurb": "450gsm brushed-back fleece. Oversized streetwear cut.",
        "price": 749,
        "ref_image": "media/ref_hoodie.jpg",   # mock Gelato photo (swap via Grok)
        # Curated from Gildan 18500 (Gelato's classic hoodie). Differs from the
        # tee on purpose — not every colour exists on every garment. Exact
        # availability + Gelato gco_ codes get synced from the Catalog API later.
        "colors": [
            {"name": "White",          "hex": "#f4f3ee", "gelato_code": "white"},
            {"name": "Black",          "hex": "#1b1b1b", "gelato_code": "black"},
            {"name": "Navy",           "hex": "#2a3145", "gelato_code": "navy"},
            {"name": "Sport Grey",     "hex": "#b6b6b1", "gelato_code": "sport_grey"},
            {"name": "Dark Heather",   "hex": "#46474c", "gelato_code": "dark_heather"},
            {"name": "Charcoal",       "hex": "#4a4a4d", "gelato_code": "charcoal"},
            {"name": "Military Green", "hex": "#4f5340", "gelato_code": "military_green"},
            {"name": "Maroon",         "hex": "#5a2230", "gelato_code": "maroon"},
            {"name": "Red",            "hex": "#b22232", "gelato_code": "red"},
            {"name": "Royal",          "hex": "#25408f", "gelato_code": "royal"},
            {"name": "Sand",           "hex": "#d8c7a4", "gelato_code": "sand"},
            {"name": "Light Pink",     "hex": "#e7bcc8", "gelato_code": "light_pink"},
        ],
        "sizes": [
            {"label": "S", "gelato_code": "s"}, {"label": "M", "gelato_code": "m"},
            {"label": "L", "gelato_code": "l"}, {"label": "XL", "gelato_code": "xl"},
            {"label": "2XL", "gelato_code": "2xl"},
        ],
    },
    {
        "slug": "oversized-tee",
        "name": "Oversized Boxy Tee",
        "blurb": "240gsm combed cotton. Drop shoulder, heavy drape.",
        "price": 349,
        "ref_image": "media/ref_tee.jpg",
        # Curated from Gildan 64000 Softstyle (Gelato's classic tee). Wider
        # range than the hoodie (e.g. Forest Green / Light Blue / Natural).
        "colors": [
            {"name": "White",          "hex": "#f4f3ee", "gelato_code": "white"},
            {"name": "Black",          "hex": "#1b1b1b", "gelato_code": "black"},
            {"name": "Navy",           "hex": "#2a3145", "gelato_code": "navy"},
            {"name": "Sport Grey",     "hex": "#b6b6b1", "gelato_code": "sport_grey"},
            {"name": "Dark Heather",   "hex": "#46474c", "gelato_code": "dark_heather"},
            {"name": "Charcoal",       "hex": "#4a4a4d", "gelato_code": "charcoal"},
            {"name": "Military Green", "hex": "#4f5340", "gelato_code": "military_green"},
            {"name": "Forest Green",   "hex": "#223b2a", "gelato_code": "forest_green"},
            {"name": "Maroon",         "hex": "#5a2230", "gelato_code": "maroon"},
            {"name": "Red",            "hex": "#b22232", "gelato_code": "red"},
            {"name": "Royal Blue",     "hex": "#25408f", "gelato_code": "royal"},
            {"name": "Light Blue",     "hex": "#92b6d5", "gelato_code": "light_blue"},
            {"name": "Sand",           "hex": "#d8c7a4", "gelato_code": "sand"},
            {"name": "Natural",        "hex": "#e6ddc9", "gelato_code": "natural"},
        ],
        "sizes": [
            {"label": "S", "gelato_code": "s"}, {"label": "M", "gelato_code": "m"},
            {"label": "L", "gelato_code": "l"}, {"label": "XL", "gelato_code": "xl"},
            {"label": "2XL", "gelato_code": "2xl"},
        ],
    },
]


def build_uid(slug: str, color_code: str, size_code: str) -> str | None:
    """Compose the Gelato product UID for a chosen variant."""
    tmpl = UID_TEMPLATES.get(slug)
    if not tmpl:
        return None
    return tmpl.format(size=size_code, color=color_code)


def studio_products(url_for) -> list[dict]:
    """Front-end payload. `url_for` is Flask's static URL builder."""
    out = []
    for p in PRODUCTS:
        out.append({
            "slug": p["slug"],
            "name": p["name"],
            "blurb": p["blurb"],
            "price": p["price"],
            "ref_image": url_for("static", filename=p["ref_image"]),
            "print_area": PRINT_AREA,
            "uid_template": UID_TEMPLATES[p["slug"]],
            "colors": p["colors"],
            "sizes": p["sizes"],
        })
    return out
