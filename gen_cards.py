"""
gen_cards.py — pre-render the "2D shirts that have been done" for the rolodex.

For every design in data/designs/, composite it onto a recoloured garment (via
mockup.studio_card) and save a web-sized card to static/v2/cards/<slug>.jpg.
The garment colour is chosen for contrast (bright art -> dark shirt, dark art ->
light shirt) and the garment type is varied for visual interest.

Pre-rendering to static/ means the landing rolodex loads instant images with zero
runtime cost. Re-run this whenever you add/remove designs in data/designs/:

    python3 gen_cards.py
"""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

import mockup

HERE = Path(__file__).resolve().parent
DESIGNS = HERE / "data" / "designs"
OUT = HERE / "static" / "v2" / "cards"
CARD_W = 760                       # web card width (downscaled from mockup's 1080)
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}

DARK = ["#1b1b1b", "#23232a"]      # for bright / colourful art
LIGHT = ["#f4f3ef", "#e9e5dc"]     # for dark / line art
# Garment family per card index — mostly tees, the odd hoodie/sweatshirt.
FAMILY_CYCLE = ["tee", "tee", "hoodie", "tee", "tee", "sweatshirt", "tee", "tee"]


def pick_colour(im: Image.Image, i: int) -> str:
    """Choose a shirt colour that gives the print contrast, judged by the brightness
    of the ARTWORK ITSELF (its visible/non-transparent pixels): a bright design goes
    on a DARK shirt, a dark design (e.g. the black-outlined ghost) on a LIGHT shirt."""
    im = im.convert("RGBA").resize((64, 64))
    px = im.load()
    tot = n = 0.0
    for y in range(64):
        for x in range(64):
            r, g, b, a = px[x, y]
            if a < 24:                           # ignore transparent background
                continue
            w = a / 255.0
            tot += (0.299 * r + 0.587 * g + 0.114 * b) * w
            n += w
    luma = (tot / n) if n else 128.0
    return (DARK if luma > 135 else LIGHT)[i % 2]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    designs = sorted(p for p in DESIGNS.iterdir()
                     if p.is_file() and p.suffix.lower() in IMG_EXT)
    if not designs:
        print("No designs found in", DESIGNS)
        return
    print(f"Rendering {len(designs)} cards -> {OUT}")
    for i, p in enumerate(designs):
        data = p.read_bytes()
        art = Image.open(io.BytesIO(data))
        colour = pick_colour(art, i)
        family = FAMILY_CYCLE[i % len(FAMILY_CYCLE)]
        try:
            jpeg = mockup.studio_card(data, family, colour)
        except Exception as e:                       # one bad file shouldn't stop the batch
            print(f"  ! {p.name}: {e}")
            continue
        card = Image.open(io.BytesIO(jpeg)).convert("RGB")
        h = round(card.height * CARD_W / card.width)
        card = card.resize((CARD_W, h), Image.LANCZOS)
        dest = OUT / (p.stem + ".jpg")
        card.save(dest, format="JPEG", quality=86, optimize=True)
        print(f"  + {dest.name:22} {family:10} {colour}")
    print("Done.")


if __name__ == "__main__":
    main()
