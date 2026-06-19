"""
mockup.py — photoreal-ish design mockups & shareable social cards.

Turns a customer's print-ready design into a presentation image:

  • STUDIO CARD (default, asset-free) — a clean flat-lay style garment generated
    in the customer's CHOSEN colour, with their artwork composited on the chest
    and modulated by procedural fabric shading (folds show through), floated on a
    neutral background with a soft contact shadow. Because the garment is drawn,
    not photographed, it works for every product + every colour today and doubles
    as the social SHARE card (#4).

  • PHOTO MOCKUP — the SAME compositing core run over a real garment PHOTO. The
    moment a clean blank garment/model photo exists, register it in TEMPLATES and
    that garment switches to a true "on a real person" shot. (The bundled
    static/media/ref_*.jpg are NOT clean — they already have a print on them — so
    they are deliberately not used as bases.)

Pure Pillow (no numpy) so it deploys against the existing requirements.txt. Pure
functions: bytes in, JPEG/PNG bytes out. Nothing here touches the studio JS/CSS,
so it is safe to build alongside the front-end work happening in parallel.

Public surface:
  studio_card(design_bytes, family, hex_color, *, wordmark="", size="portrait",
              bg=None)                     -> JPEG bytes  (the hero output)
  photo_mockup(design_bytes, base_path, region, *, ...)  -> JPEG bytes
  family_for(slug)                          -> "tee" | "sweatshirt" | "hoodie"
  TEMPLATES                                 -> real-photo template registry
"""
from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Optional

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

_HERE = Path(__file__).resolve().parent

# Output sizes (w, h). Portrait 4:5 is the Instagram/WhatsApp sweet spot.
_SIZES = {
    "portrait": (1080, 1350),
    "square": (1080, 1080),
}
_BG_DEFAULT = (244, 242, 237)   # calm studio cream (matches the light studio)
_SS = 3                          # supersample factor for crisp garment edges

# Where the chest print sits, as a fraction of the GARMENT bounding box
# (x0, y0, x1, y1). Tuned per family so the art lands on the chest, not the neck.
_PRINT_REGION = {
    "tee": (0.278, 0.250, 0.722, 0.640),
    "sweatshirt": (0.285, 0.270, 0.715, 0.650),
    "hoodie": (0.300, 0.335, 0.700, 0.655),
}

# Real-photo templates: garment family -> {base, region}. EMPTY by default
# because no clean blank photo has been sourced yet. Example once you have one:
#   TEMPLATES["tee"] = {"base": "static/media/blank_tee_white.jpg",
#                       "region": (0.34, 0.30, 0.66, 0.62)}
TEMPLATES: dict[str, dict] = {}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def family_for(slug: str) -> str:
    """Map a product slug to a garment family (mirrors shipping.family_for)."""
    s = (slug or "").lower()
    if "hood" in s:
        return "hoodie"
    if "sweat" in s or "crew" in s:
        return "sweatshirt"
    return "tee"


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = (hex_color or "#ffffff").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore
    except ValueError:
        return (255, 255, 255)


def _scale(rgb: tuple[int, int, int], f: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(c * f))) for c in rgb)  # type: ignore


def _open_rgba(data: bytes) -> Image.Image:
    im = Image.open(io.BytesIO(data))
    im.load()
    return im.convert("RGBA")


# --------------------------------------------------------------------------- #
# Garment silhouette + procedural fabric shading
# --------------------------------------------------------------------------- #
def _tee_polygon(w: int, h: int) -> list[tuple[float, float]]:
    """A clean unisex tee outline (also serves crew/hoodie body), clockwise."""
    return [(x * w, y * h) for x, y in [
        (0.380, 0.075), (0.300, 0.110), (0.120, 0.190), (0.030, 0.330),
        (0.175, 0.405), (0.205, 0.380), (0.205, 0.965), (0.795, 0.965),
        (0.795, 0.380), (0.825, 0.405), (0.970, 0.330), (0.880, 0.190),
        (0.700, 0.110), (0.620, 0.075), (0.560, 0.120), (0.500, 0.135),
        (0.440, 0.120),
    ]]


def _silhouette_mask(w: int, h: int, family: str) -> Image.Image:
    """A 1-channel mask of the garment shape (L: 255 = garment)."""
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    if family == "hoodie":
        # hood draped behind the neck/shoulders (drawn first = sits behind body)
        d.ellipse([0.330 * w, 0.005 * h, 0.670 * w, 0.190 * h], fill=255)
        d.polygon([(0.330 * w, 0.150 * h), (0.670 * w, 0.150 * h),
                   (0.605 * w, 0.035 * h), (0.395 * w, 0.035 * h)], fill=255)
    d.polygon(_tee_polygon(w, h), fill=255)
    if family in ("tee", "sweatshirt"):
        # round the crew neckline back out (carve a soft collar dip)
        d.ellipse([0.430 * w, 0.055 * h, 0.570 * w, 0.140 * h], fill=0)
    mask = mask.filter(ImageFilter.GaussianBlur(w / 600))  # anti-alias edge
    return mask


def _shading(w: int, h: int, family: str) -> Image.Image:
    """Procedural grayscale fabric shading (L): mid-tone with a chest highlight,
    a centre sheen, side/hem shadows, diagonal chest folds and (for hoodies) a
    hood-opening shadow + kangaroo pocket. 255=lit, 0=shadow."""
    base = Image.new("L", (w, h), 166)
    hi = Image.new("L", (w, h), 0)
    dh = ImageDraw.Draw(hi)
    dh.ellipse([0.34 * w, 0.16 * h, 0.66 * w, 0.66 * h], fill=78)   # chest highlight
    dh.ellipse([0.45 * w, 0.10 * h, 0.55 * w, 0.95 * h], fill=38)   # centre sheen
    hi = hi.filter(ImageFilter.GaussianBlur(w / 10))
    base = ImageChops.add(base, hi)

    sh = Image.new("L", (w, h), 0)
    ds = ImageDraw.Draw(sh)
    for box, val in [
        ([0.00 * w, 0.10 * h, 0.20 * w, 0.60 * h], 82),   # left side
        ([0.80 * w, 0.10 * h, 1.00 * w, 0.60 * h], 82),   # right side
        ([0.20 * w, 0.87 * h, 0.80 * w, 1.00 * h], 62),   # hem
        ([0.42 * w, 0.05 * h, 0.58 * w, 0.21 * h], 58),   # under collar
    ]:
        ds.ellipse(box, fill=val)
    # diagonal chest folds so a print visibly creases with the cloth
    for x, y, val in [(0.30, 0.40, 46), (0.60, 0.34, 40), (0.40, 0.58, 38)]:
        ds.ellipse([x * w, y * h, (x + 0.17) * w, (y + 0.07) * h], fill=val)
    sh = sh.filter(ImageFilter.GaussianBlur(w / 16))
    base = ImageChops.subtract(base, sh)

    if family == "hoodie":
        ex = Image.new("L", (w, h), 0)
        de = ImageDraw.Draw(ex)
        de.polygon([(0.42 * w, 0.17 * h), (0.58 * w, 0.17 * h),
                    (0.50 * w, 0.35 * h)], fill=70)                 # hood opening V
        de.polygon([(0.34 * w, 0.665 * h), (0.66 * w, 0.665 * h),
                    (0.62 * w, 0.84 * h), (0.38 * w, 0.84 * h)], fill=34)  # pocket
        de.rectangle([0.34 * w, 0.655 * h, 0.66 * w, 0.678 * h], fill=58)  # pocket lip
        ex = ex.filter(ImageFilter.GaussianBlur(w / 44))
        base = ImageChops.subtract(base, ex)

    # low-frequency folds: heavily blurred noise blended in lightly
    folds = Image.effect_noise((w, h), 24).filter(ImageFilter.GaussianBlur(w / 24))
    base = Image.blend(base, folds, 0.09)
    return base


def _garment(w: int, h: int, family: str, hex_color: str
             ) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Return (garment_rgba, mask_L, shading_L) for a coloured garment."""
    mask = _silhouette_mask(w, h, family)
    shade = _shading(w, h, family)
    rgb = _hex_to_rgb(hex_color)
    # Map the shading ramp onto the chosen colour: shadow->mid(hex)->highlight.
    dark = _scale(rgb, 0.34)
    light = _scale(rgb, 1.30)
    coloured = ImageOps.colorize(shade, black=dark, white=light, mid=rgb)
    garment = coloured.convert("RGBA")
    garment.putalpha(mask)
    return garment, mask, shade


# --------------------------------------------------------------------------- #
# Compositing core
# --------------------------------------------------------------------------- #
def _place_design(garment: Image.Image, mask: Image.Image, shade: Image.Image,
                  design: Image.Image, region: tuple, *, shade_strength: float = 0.16
                  ) -> Image.Image:
    """Composite `design` (RGBA) into `region` of the garment, modulated by the
    local fabric shading so it folds with the cloth, clipped to the silhouette."""
    W, H = garment.size
    x0, y0, x1, y1 = (region[0] * W, region[1] * H, region[2] * W, region[3] * H)
    rw, rh = int(x1 - x0), int(y1 - y0)
    if rw <= 0 or rh <= 0:
        return garment

    # fit design inside the region, preserving aspect
    dw, dh = design.size
    ratio = min(rw / dw, rh / dh)
    nw, nh = max(1, int(dw * ratio)), max(1, int(dh * ratio))
    art = design.resize((nw, nh), Image.LANCZOS)
    px = int(x0 + (rw - nw) / 2)
    py = int(y0 + (rh - nh) / 2)

    # fabric modulation: scale local shading into a subtle multiplier
    crop = shade.crop((px, py, px + nw, py + nh))
    lo = 1.0 - shade_strength
    mod = crop.point(lambda v: int(255 * (lo + shade_strength * (v / 255.0))))
    mod_rgb = Image.merge("RGB", (mod, mod, mod))

    art_rgb = ImageChops.multiply(art.convert("RGB"), mod_rgb)
    art_a = art.split()[3].filter(ImageFilter.GaussianBlur(0.5))  # print softness
    art_shaded = Image.merge("RGBA", (*art_rgb.split(), art_a))

    layer = Image.new("RGBA", garment.size, (0, 0, 0, 0))
    layer.alpha_composite(art_shaded, (px, py))
    # clip art to the garment silhouette so nothing spills onto the background
    clipped_a = ImageChops.multiply(layer.split()[3], mask)
    layer.putalpha(clipped_a)
    return Image.alpha_composite(garment, layer)


def _compose_card(garment: Image.Image, mask: Image.Image, out_size: tuple,
                  bg: tuple, wordmark: str) -> bytes:
    """Float the garment on a neutral background with a soft contact shadow."""
    CW, CH = out_size
    canvas = Image.new("RGB", (CW, CH), bg)

    # fit garment into ~78% of the card, centred a touch high for the wordmark
    gw, gh = garment.size
    target_h = int(CH * 0.80)
    ratio = target_h / gh
    nw, nh = int(gw * ratio), int(gh * ratio)
    garment_s = garment.resize((nw, nh), Image.LANCZOS)
    mask_s = mask.resize((nw, nh), Image.LANCZOS)
    ox, oy = (CW - nw) // 2, int(CH * 0.075)

    # contact shadow from the mask: blurred, darkened, offset down
    shadow = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    sh_mask = mask_s.point(lambda v: int(v * 0.42)).filter(ImageFilter.GaussianBlur(nw / 22))
    shadow.paste((20, 18, 16, 255), (ox, oy + int(nh * 0.03)), sh_mask)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow).convert("RGB")
    canvas.paste(garment_s, (ox, oy), garment_s)

    if wordmark:
        d = ImageDraw.Draw(canvas)
        tw = d.textlength(wordmark)
        d.text(((CW - tw) / 2, CH - 70), wordmark, fill=(120, 116, 110))
    out = io.BytesIO()
    canvas.save(out, format="JPEG", quality=90, optimize=True)
    return out.getvalue()


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #
def studio_card(design_bytes: bytes, family: str, hex_color: str, *,
                wordmark: str = "", size: str = "portrait",
                bg: Optional[tuple] = None) -> bytes:
    """The hero output: customer's art on a generated, recoloured garment, on a
    clean card. `family` in tee/sweatshirt/hoodie; `hex_color` = garment colour."""
    fam = family if family in _PRINT_REGION else "tee"
    out_size = _SIZES.get(size, _SIZES["portrait"])
    bg = bg or _BG_DEFAULT
    W, H = out_size[0] * _SS, out_size[1] * _SS

    garment, mask, shade = _garment(W, H, fam, hex_color)
    design = _open_rgba(design_bytes)
    garment = _place_design(garment, mask, shade, design, _PRINT_REGION[fam],
                            shade_strength=0.22)
    return _compose_card(garment, mask, out_size, bg, wordmark)


def photo_mockup(design_bytes: bytes, base_path: str, region: tuple, *,
                 size: str = "portrait", shade_strength: float = 0.22) -> bytes:
    """Composite a design onto a REAL garment photo (a clean blank). `region` is
    the chest print box as fractions of the photo (x0,y0,x1,y1)."""
    p = Path(base_path)
    if not p.is_absolute():
        p = _HERE / base_path
    if not p.exists():
        raise FileNotFoundError(f"Mockup base photo not found: {p}")
    base = Image.open(p).convert("RGB")
    W, H = base.size
    shade = ImageOps.grayscale(base)
    mask = Image.new("L", (W, H), 255)  # full photo; design clipped by region only
    garment = base.convert("RGBA")
    composed = _place_design(garment, mask, shade, _open_rgba(design_bytes),
                             region, shade_strength=shade_strength)
    out = io.BytesIO()
    composed.convert("RGB").save(out, format="JPEG", quality=90, optimize=True)
    return out.getvalue()
