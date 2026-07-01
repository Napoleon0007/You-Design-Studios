"""
TRUEF Studios — image-processing microservice.

A tiny, stateless Pillow service standing in for the pieces of you-design-
studios' image pipeline that don't fit in a Cloudflare Worker:

  1. render_print_file (printfile.py) — composites a customer's artwork onto a
     3543x4724px (or similar) transparent print-ready canvas. Uncomfortably
     close to a Worker's 128MB isolate memory ceiling once decoded.
  2. studio_card / photo_mockup (mockup.py) — procedural fabric-shaded garment
     compositing (polygon masks, blurred shading gradients, blend-mode
     multiply, noise texture, contact shadows) that Cloudflare's WASM image
     library (Photon) has no primitives for.
  3. image grading (the print-quality DPI verdict on upload) — reuses the same
     Pillow decode (format/size/transparency detection incl. palette tRNS) as
     the other two, so there's one source of truth for "can Pillow read this
     file" rather than a second, JS-only image-header parser that could
     silently disagree with it.

Bytes in, bytes out — no filesystem, no database, no storage of its own. The
caller (the Worker) is responsible for fetching source art from R2 and
persisting whatever this service returns. Every endpoint is stateless and
pure; the same request always produces the same response.

Guarded by SERVICE_KEY (env var) in production via the X-Service-Key header —
open on local dev when unset, matching the existing ADMIN_KEY/PRINTER_KEY
pattern in app.py.
"""
from __future__ import annotations

import base64
import io
import os

from flask import Flask, jsonify, request
from PIL import Image

import mockup
import printfile

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # 40 MB request ceiling

# Mirrors app.py's MIN_DPI_WARN/MIN_DPI_FAIL — informational tiers only,
# resolution never blocks an upload (see grade_image_endpoint).
MIN_DPI_WARN = 100
MIN_DPI_FAIL = 45


def _service_ok() -> bool:
    key = os.environ.get("SERVICE_KEY")
    if not key:
        return True  # local dev — SET SERVICE_KEY before deploying
    given = request.headers.get("X-Service-Key")
    return bool(given) and given == key


@app.before_request
def _require_service_key():
    if request.path == "/healthz":
        return None
    if not _service_ok():
        return jsonify(ok=False, error="Unauthorized"), 401


@app.route("/healthz")
def healthz():
    return jsonify(ok=True, service="truef-image-service")


def _b64_to_bytes(s: str | None, field: str) -> bytes:
    if not s:
        raise ValueError(f"Missing '{field}'")
    try:
        return base64.b64decode(s)
    except Exception as exc:
        raise ValueError(f"Invalid base64 in '{field}': {exc}") from None


@app.route("/render-printfile", methods=["POST"])
def render_printfile_endpoint():
    """body: {art_base64, area:{w_px,h_px,dpi}, placement?}
    -> {ok, print_png_base64, preview_png_base64, width, height, dpi}"""
    d = request.get_json(silent=True) or {}
    try:
        art = _b64_to_bytes(d.get("art_base64"), "art_base64")
        area = d.get("area") or {}
        if "w_px" not in area or "h_px" not in area:
            return jsonify(ok=False, error="area.w_px and area.h_px are required"), 400
        png = printfile.render_print_file(art, area, d.get("placement") or {})
        preview = printfile.preview_thumb(png)
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception as exc:
        return jsonify(ok=False, error=f"Could not render print file: {exc}"), 400
    return jsonify(
        ok=True,
        print_png_base64=base64.b64encode(png).decode(),
        preview_png_base64=base64.b64encode(preview).decode(),
        width=int(area["w_px"]),
        height=int(area["h_px"]),
        dpi=int(area.get("dpi", 300)),
    )


@app.route("/mockup", methods=["POST"])
def mockup_endpoint():
    """body: {design_base64, family, hex_color, wordmark?, size?}
    -> {ok, image_base64}  (JPEG, studio-card style)"""
    d = request.get_json(silent=True) or {}
    try:
        design = _b64_to_bytes(d.get("design_base64"), "design_base64")
        family = d.get("family") or "tee"
        hex_color = d.get("hex_color") or "#ffffff"
        img = mockup.studio_card(
            design,
            family,
            hex_color,
            wordmark=d.get("wordmark") or "",
            size=d.get("size") or "portrait",
        )
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception as exc:
        return jsonify(ok=False, error=f"Could not render mockup: {exc}"), 400
    return jsonify(ok=True, image_base64=base64.b64encode(img).decode())


@app.route("/grade-image", methods=["POST"])
def grade_image_endpoint():
    """body: {image_base64, print_w_cm?, print_h_cm?}
    -> {ok, verdict, message, format, width, height, has_transparency,
        effective_dpi, recommended_max_cm, thresholds}

    Ported 1:1 from app.py's `_grade_and_store`, minus the storage.put call —
    the Worker persists the raw upload itself and mints the art_key. Resolution
    NEVER blocks an upload — at worst it's a soft heads-up; only an unreadable
    or unsupported file is rejected (400)."""
    d = request.get_json(silent=True) or {}
    try:
        raw = _b64_to_bytes(d.get("image_base64"), "image_base64")
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    print_w_cm = float(d.get("print_w_cm") or 30.0)
    print_h_cm = float(d.get("print_h_cm") or 40.0)

    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        return jsonify(ok=False, error="Unreadable image. Use PNG, JPG or WEBP."), 400
    fmt = (img.format or "").upper()
    if fmt not in {"PNG", "JPEG", "JPG", "WEBP"}:
        return jsonify(ok=False, error=f"Unsupported format: {fmt or 'unknown'}. Use PNG, JPG or WEBP."), 400
    w, h = img.size
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    cm_to_in = 1 / 2.54
    dpi_w = w / max(print_w_cm * cm_to_in, 0.01)
    dpi_h = h / max(print_h_cm * cm_to_in, 0.01)
    effective_dpi = round(min(dpi_w, dpi_h))
    max_w_cm = round((w / 300) / cm_to_in, 1)
    max_h_cm = round((h / 300) / cm_to_in, 1)
    if effective_dpi >= MIN_DPI_WARN:
        verdict, message = "pass", "Looks sharp — good to print."
    elif effective_dpi >= MIN_DPI_FAIL:
        verdict, message = ("warn", "Good to go. It may look a touch soft if printed very large.")
    else:
        verdict, message = ("warn", "This will print — it's a lower-resolution image, so it may "
                                    "look a little soft up close. Still totally fine for most designs.")
    return jsonify(
        ok=True, verdict=verdict, message=message, format=fmt, width=w, height=h,
        has_transparency=bool(has_alpha), effective_dpi=effective_dpi,
        recommended_max_cm={"width": max_w_cm, "height": max_h_cm},
        thresholds={"warn": MIN_DPI_WARN, "fail": MIN_DPI_FAIL},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 7461)), debug=True)
