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

try:
    from PIL import Image
except Exception:  # Pillow should be present; fail loud if not
    Image = None

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
    )


# --------------------------------------------------------------------------- #
# API — swap-in integration stubs (Gelato / Paystack / email / tracking).
# These return realistic shapes so the front-end is built against the final
# contract; flip them to live calls when keys are in place.
# --------------------------------------------------------------------------- #
@app.route("/api/save-design", methods=["POST"])
def save_design():
    # TODO(phase): persist design (art + placement + variant) to DB.
    payload = request.get_json(silent=True) or {}
    return jsonify(ok=True, design_id="demo-design", echo=payload)


@app.route("/api/orders", methods=["POST"])
def create_order():
    # TODO(phase): create local order -> Paystack init -> on success, Gelato order.
    return jsonify(ok=True, order_id="demo-order",
                   note="Stub. Wire Paystack init + Gelato fulfillment here.")


@app.route("/api/track/<order_id>")
def track(order_id: str):
    # TODO(phase): proxy Gelato fulfillment/tracking status.
    return jsonify(ok=True, order_id=order_id, status="demo",
                   note="Stub. Proxy Gelato tracking here.")


# Serve raw originals folder is intentionally NOT exposed; only /static is.
@app.route("/favicon.ico")
def favicon():
    return send_from_directory(BASE_DIR / "static", "favicon.svg",
                               mimetype="image/svg+xml") if (
        (BASE_DIR / "static" / "favicon.svg").exists()) else ("", 204)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7450))
    app.run(host="0.0.0.0", port=port, debug=True)
