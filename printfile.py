"""
Print-file generator.

Turns a customer's uploaded artwork + placement into a PRINT-READY file at the
exact pixel dimensions Gelato expects for the chosen product/print area
(e.g. 3543×4724px @ 300 DPI for a 30×40cm front print), transparent
background, art composited where the customer placed it.

This is the file that actually gets printed — Gelato receives a public URL to
it, one per print side (front/back). Pure functions: bytes in, PNG bytes out.
"""
from __future__ import annotations

import io
from typing import Optional

from PIL import Image

# A placement describes where the art sits *inside the print area*, all
# normalised so it's resolution-independent:
#   scale     – art width as a fraction of the print-area width (0–1)
#   cx, cy    – centre of the art, fraction of width/height (0–1)
#   rotation  – degrees, clockwise
DEFAULT_PLACEMENT = {"scale": 0.62, "cx": 0.5, "cy": 0.46, "rotation": 0.0}


def render_print_file(art_bytes: bytes, area: dict,
                      placement: Optional[dict] = None) -> bytes:
    """Composite `art_bytes` onto a transparent print-area canvas.

    area:      {"w_px": int, "h_px": int, "dpi": int}
    placement: see DEFAULT_PLACEMENT (missing keys fall back to defaults)
    returns:   PNG bytes (RGBA, exact print-area size, DPI tagged)
    """
    p = {**DEFAULT_PLACEMENT, **(placement or {})}
    scale = _clamp(float(p["scale"]), 0.02, 1.0)
    cx = _clamp(float(p["cx"]), 0.0, 1.0)
    cy = _clamp(float(p["cy"]), 0.0, 1.0)
    rotation = float(p["rotation"])

    w_px, h_px = int(area["w_px"]), int(area["h_px"])
    dpi = int(area.get("dpi", 300))
    if w_px <= 0 or h_px <= 0:
        raise ValueError("Invalid print area dimensions")

    canvas = Image.new("RGBA", (w_px, h_px), (0, 0, 0, 0))

    art = Image.open(io.BytesIO(art_bytes))
    art.load()
    if art.mode != "RGBA":
        art = art.convert("RGBA")

    # target width from scale, preserve aspect, clamp so it fits the area
    target_w = max(1, round(scale * w_px))
    aspect = art.width / art.height
    target_h = max(1, round(target_w / aspect))
    if target_h > h_px:
        target_h = h_px
        target_w = max(1, round(h_px * aspect))
    art = art.resize((target_w, target_h), Image.LANCZOS)

    if rotation % 360 != 0:
        art = art.rotate(-rotation, expand=True, resample=Image.BICUBIC)

    # paste centred at (cx, cy); paste() clips automatically if it overflows
    px = round(cx * w_px - art.width / 2)
    py = round(cy * h_px - art.height / 2)
    canvas.paste(art, (px, py), art)

    out = io.BytesIO()
    canvas.save(out, format="PNG", dpi=(dpi, dpi), optimize=True)
    return out.getvalue()


def preview_thumb(print_png: bytes, max_px: int = 600) -> bytes:
    """Small RGBA thumbnail of a print file, for order summaries / admin."""
    img = Image.open(io.BytesIO(print_png))
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))
