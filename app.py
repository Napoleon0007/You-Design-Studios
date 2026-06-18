"""
INKHAUS — Custom Print Studio (South Africa)
Flask backend. Cinematic POD storefront + real-time 3D design studio.

Brand name + most copy live in BRAND / config below so they are trivial to
rename. Gelato fulfillment, Paystack payments and transactional email are
designed as a single swap-in integration layer (see services/ stubs) so the
storefront is fully functional now and goes live the moment real keys land.
"""
from __future__ import annotations

import io
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory, url_for

import catalog
import db
import printfile
import storage

try:
    from PIL import Image
except Exception:  # Pillow should be present; fail loud if not
    Image = None

db.init_db()

BASE_DIR = Path(__file__).resolve().parent

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # 40 MB upload ceiling

# --------------------------------------------------------------------------- #
# Brand / store config  (rename here)
# --------------------------------------------------------------------------- #
BRAND = {
    "name": "You Design Studios",
    "tagline": "Custom print-on-demand",
    "country": "South Africa",
    "currency": "R",
    "email": "hello@youdesignstudios.co.za",
}

# Product catalogue — mock now, shaped like Gelato's Product Catalog API
# (see catalog.py). Flips to a live pull when a Gelato API key is added.
PRODUCTS = catalog.PRODUCTS

# Print-quality thresholds for upload validation.
MIN_DPI_WARN = 150   # below this at the chosen print size -> warn
MIN_DPI_FAIL = 100   # below this -> block add-to-cart
PRINT_AREA_CM = {
    "width": catalog.PRINT_AREA["front"]["w_cm"],
    "height": catalog.PRINT_AREA["front"]["h_cm"],
}


def _product(slug):
    return next((p for p in catalog.PRODUCTS if p["slug"] == slug), None)


def _area(side):
    return catalog.PRINT_AREA.get(side if side in catalog.PRINT_AREA else "front")


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html", brand=BRAND, products=PRODUCTS)


@app.route("/studio")
def studio():
    # The design studio. Products come from the Gelato-shaped catalogue payload
    # (mock now; live pull later) — includes colour hex/codes, sizes, print
    # areas and reference photos.
    return render_template("studio.html", brand=BRAND,
                           products=catalog.studio_products(url_for),
                           print_area=PRINT_AREA_CM)


@app.route("/healthz")
def healthz():
    return {"ok": True, "brand": BRAND["name"]}


# --------------------------------------------------------------------------- #
# API — image validation (REAL). Core requirement: strong design validation.
# --------------------------------------------------------------------------- #
@app.route("/api/validate-image", methods=["POST"])
def validate_image():
    """Inspect an uploaded design and report print-quality verdict.

    Computes the achievable DPI when the image is printed at the requested
    physical size (defaults to the full print area) and grades it
    pass / warn / fail, plus the largest size it can print crisply.
    """
    if Image is None:
        return jsonify(ok=False, error="Image processing unavailable on server"), 500

    file = request.files.get("design")
    if file is None or file.filename == "":
        return jsonify(ok=False, error="No file received"), 400

    raw = file.read()
    if not raw:
        return jsonify(ok=False, error="Empty file"), 400

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return jsonify(ok=False, error="Unreadable image. Use PNG, JPG or WEBP."), 400

    fmt = (img.format or "").upper()
    if fmt not in {"PNG", "JPEG", "JPG", "WEBP"}:
        return jsonify(ok=False, error=f"Unsupported format: {fmt or 'unknown'}. "
                                       "Use PNG, JPG or WEBP."), 400

    w, h = img.size
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

    # Requested physical print size (cm). Falls back to full print area.
    try:
        print_w_cm = float(request.form.get("print_w_cm", PRINT_AREA_CM["width"]))
        print_h_cm = float(request.form.get("print_h_cm", PRINT_AREA_CM["height"]))
    except (TypeError, ValueError):
        print_w_cm, print_h_cm = PRINT_AREA_CM["width"], PRINT_AREA_CM["height"]

    cm_to_in = 1 / 2.54
    dpi_w = w / max(print_w_cm * cm_to_in, 0.01)
    dpi_h = h / max(print_h_cm * cm_to_in, 0.01)
    effective_dpi = round(min(dpi_w, dpi_h))

    # Largest size (cm) that still prints at >= 300 DPI (gallery quality).
    max_w_cm = round((w / 300) / cm_to_in, 1)
    max_h_cm = round((h / 300) / cm_to_in, 1)

    if effective_dpi >= MIN_DPI_WARN:
        verdict, message = "pass", "Crisp at this size. Good to print."
    elif effective_dpi >= MIN_DPI_FAIL:
        verdict, message = ("warn",
                            "Usable, but may look soft on a large print. "
                            "A higher-resolution file is recommended.")
    else:
        verdict, message = ("fail",
                            "Too low-resolution to print sharply at this size. "
                            "Please upload a larger image.")

    # keep the raw art so a print file can be generated later (returns its key)
    ext = "jpg" if fmt == "JPEG" else fmt.lower()
    art_key = storage.new_key("art", ext)
    storage.put(raw, art_key)

    return jsonify(
        ok=True,
        verdict=verdict,
        message=message,
        format=fmt,
        width=w,
        height=h,
        has_transparency=bool(has_alpha),
        effective_dpi=effective_dpi,
        recommended_max_cm={"width": max_w_cm, "height": max_h_cm},
        thresholds={"warn": MIN_DPI_WARN, "fail": MIN_DPI_FAIL},
        art_key=art_key,
    )


# --------------------------------------------------------------------------- #
# API — swap-in integration stubs (Gelato / Paystack / email / tracking).
# These return realistic shapes so the front-end is built against the final
# contract; flip them to live calls when keys are in place.
# --------------------------------------------------------------------------- #
@app.route("/api/render-printfile", methods=["POST"])
def render_printfile():
    """Generate a print-ready file from stored art + placement (preview/checkout)."""
    if Image is None:
        return jsonify(ok=False, error="Image processing unavailable"), 500
    d = request.get_json(silent=True) or {}
    side = d.get("side", "front")
    art = storage.open_bytes(d["art_key"]) if d.get("art_key") else None
    if not art:
        return jsonify(ok=False, error="Artwork not found — please upload again"), 400
    area = _area(side)
    try:
        png = printfile.render_print_file(art, area, d.get("placement") or {})
    except Exception as exc:
        return jsonify(ok=False, error=f"Could not render print file: {exc}"), 400
    url = storage.put(png, storage.new_key("print", "png"))
    return jsonify(ok=True, url=url, side=side,
                   width=area["w_px"], height=area["h_px"], dpi=area["dpi"])


@app.route("/api/save-design", methods=["POST"])
def save_design():
    """Render the print file(s), persist the design, return its token."""
    if Image is None:
        return jsonify(ok=False, error="Image processing unavailable"), 500
    d = request.get_json(silent=True) or {}
    product = _product(d.get("slug"))
    if not product:
        return jsonify(ok=False, error="Unknown product"), 400

    user_id = db.upsert_user(d.get("user_email"), d.get("user_name"))
    front_url = back_url = preview_url = None

    art_front = storage.open_bytes(d["art_key"]) if d.get("art_key") else None
    if art_front:
        png = printfile.render_print_file(art_front, _area("front"), d.get("placement") or {})
        front_url = storage.put(png, storage.new_key("print", "png"))
        preview_url = storage.put(printfile.preview_thumb(png), storage.new_key("preview", "png"))

    art_back = storage.open_bytes(d["art_key_back"]) if d.get("art_key_back") else None
    if art_back:
        pngb = printfile.render_print_file(art_back, _area("back"), d.get("placement_back") or {})
        back_url = storage.put(pngb, storage.new_key("print", "png"))

    gelato_uid = catalog.build_uid(d["slug"], d.get("color_code"), d.get("size_code"))
    design = db.create_design(
        user_id=user_id, product_slug=d["slug"], gelato_uid=gelato_uid,
        color=d.get("color"), color_code=d.get("color_code"),
        size=d.get("size"), size_code=d.get("size_code"), art_key=d.get("art_key"),
        placement={"front": d.get("placement"), "back": d.get("placement_back")},
        printfile_front_url=front_url, printfile_back_url=back_url, preview_url=preview_url)

    if user_id:
        db.save_design_for_user(user_id, design["id"], d.get("name"))

    return jsonify(ok=True, design_token=design["token"], gelato_uid=gelato_uid,
                   printfile_front_url=front_url, printfile_back_url=back_url,
                   preview_url=preview_url)


@app.route("/api/orders", methods=["POST"])
def create_order():
    """Persist an order + line items from saved designs.

    NEXT (needs keys): Paystack init -> on payment success set status 'paid'
    -> submit to Gelato Order API with the print-file URLs -> store gelato id.
    """
    d = request.get_json(silent=True) or {}
    user_id = db.upsert_user(d.get("user_email"), d.get("user_name"))
    items = []
    for it in (d.get("items") or []):
        design = db.get_design(it.get("design_token", ""))
        if not design:
            return jsonify(ok=False, error=f"Design not found: {it.get('design_token')}"), 400
        product = _product(design["product_slug"])
        unit = int(round(product["price"] * 100)) if product else 0
        items.append({
            "design_id": design["id"], "gelato_uid": design["gelato_uid"],
            "quantity": int(it.get("quantity", 1)), "unit_price": unit,
            "printfile_front_url": design["printfile_front_url"],
            "printfile_back_url": design["printfile_back_url"]})
    if not items:
        return jsonify(ok=False, error="No items to order"), 400

    order = db.create_order(user_id, items, currency="ZAR", shipping_json=d.get("shipping"))
    return jsonify(ok=True, reference=order["reference"], total=order["total"],
                   currency=order["currency"], status=order["status"],
                   note="Order persisted. Wire Paystack + Gelato submission next.")


@app.route("/api/track/<reference>")
def track(reference: str):
    order = db.get_order(reference)
    if not order:
        return jsonify(ok=False, error="Order not found"), 404
    return jsonify(ok=True, reference=reference, status=order["status"],
                   tracking_url=order["tracking_url"],
                   gelato_order_id=order["gelato_order_id"])


@app.route("/files/<path:key>")
def files(key: str):
    """Serve stored art / print files (Gelato fetches print files from here)."""
    if not storage.path_for(key).exists():
        return ("", 404)
    return send_from_directory(storage.FILES_DIR, key)


# Serve raw originals folder is intentionally NOT exposed; only /static is.
@app.route("/favicon.ico")
def favicon():
    return send_from_directory(BASE_DIR / "static", "favicon.svg",
                               mimetype="image/svg+xml") if (
        (BASE_DIR / "static" / "favicon.svg").exists()) else ("", 204)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7450))
    app.run(host="0.0.0.0", port=port, debug=True)
