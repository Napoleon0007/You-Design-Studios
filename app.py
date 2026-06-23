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
import json
import os
from pathlib import Path

from flask import (Flask, jsonify, redirect, render_template, request,
                   send_from_directory, url_for)

import bundles
import catalog
import db
import mailer
import mockup
import moderation
import paystack
import printfile
import providers
import shipping
import storage

try:
    from PIL import Image
except Exception:  # Pillow should be present; fail loud if not
    Image = None

db.init_db()

BASE_DIR = Path(__file__).resolve().parent
DESIGNS_DIR = BASE_DIR / "data" / "designs"   # ready-made design templates (Luke drops images here)
DESIGNS_DIR.mkdir(parents=True, exist_ok=True)
_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024  # 40 MB upload ceiling


@app.after_request
def _cache_heavy_static(resp):
    # The 3D models + hero frame sequence are big and immutable — cache them hard
    # so repeat visits (and product switches) are instant. Code assets stay fresh.
    p = request.path
    if p.startswith("/static/models/") or p.startswith("/static/media/"):
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp

# --------------------------------------------------------------------------- #
# Brand / store config  (rename here)
# --------------------------------------------------------------------------- #
BRAND = {
    "name": "TRUEF Studios",
    "tagline": "Custom print-on-demand",
    "country": "South Africa",
    "currency": "R",
    "email": "hello@youdesignstudios.co.za",
}

# Product catalogue — mock now, shaped like Gelato's Product Catalog API
# (see catalog.py). Flips to a live pull when a Gelato API key is added.
PRODUCTS = catalog.PRODUCTS

# Print-quality thresholds. We NEVER block an upload on resolution — people can
# print whatever they like, however humble the source (phone photos, memories).
# These only tune the friendly heads-up message; nothing here stops add-to-cart.
MIN_DPI_WARN = 100   # above -> "looks sharp"; below -> a gentle "may look soft" note
MIN_DPI_FAIL = 45    # informational tier boundary only (low-res is still ALLOWED)
PRINT_AREA_CM = {
    "width": catalog.PRINT_AREA["front"]["w_cm"],
    "height": catalog.PRINT_AREA["front"]["h_cm"],
}


def _product(slug):
    return next((p for p in catalog.PRODUCTS if p["slug"] == slug), None)


def _color_hex(slug, color_code):
    """Resolve a garment colour's hex from the catalogue (for mockup recolour)."""
    p = _product(slug)
    for c in (p or {}).get("colors", []):
        if c.get("gelato_code") == color_code:
            return c.get("hex")
    return None


def _area(side):
    return catalog.PRINT_AREA.get(side if side in catalog.PRINT_AREA else "front")


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    # The TRUeF (v2) landing is the public homepage — a static page that reuses
    # the live APIs (/healthz, /api/designs, /studio). The previous dark landing
    # is preserved at /classic.
    return app.send_static_file("v2/index.html")


@app.route("/classic")
def classic():
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
def _grade_and_store(raw: bytes, print_w_cm: float, print_h_cm: float) -> dict:
    """Grade print quality of `raw` image bytes at the requested physical size,
    store the original as an art key, and return the verdict payload. Shared by
    upload validation AND the ready-made design picker so both behave identically.
    Raises ValueError on an unreadable/unsupported image."""
    if Image is None:
        raise RuntimeError("Image processing unavailable on server")
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise ValueError("Unreadable image. Use PNG, JPG or WEBP.")
    fmt = (img.format or "").upper()
    if fmt not in {"PNG", "JPEG", "JPG", "WEBP"}:
        raise ValueError(f"Unsupported format: {fmt or 'unknown'}. Use PNG, JPG or WEBP.")
    w, h = img.size
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    cm_to_in = 1 / 2.54
    dpi_w = w / max(print_w_cm * cm_to_in, 0.01)
    dpi_h = h / max(print_h_cm * cm_to_in, 0.01)
    effective_dpi = round(min(dpi_w, dpi_h))
    max_w_cm = round((w / 300) / cm_to_in, 1)
    max_h_cm = round((h / 300) / cm_to_in, 1)
    # Resolution NEVER blocks — at worst it's a soft heads-up. Only an unreadable
    # or unsupported file is rejected (handled above by raising ValueError).
    if effective_dpi >= MIN_DPI_WARN:
        verdict, message = "pass", "Looks sharp — good to print."
    elif effective_dpi >= MIN_DPI_FAIL:
        verdict, message = ("warn", "Good to go. It may look a touch soft if printed very large.")
    else:
        verdict, message = ("warn", "This will print — it's a lower-resolution image, so it may "
                                    "look a little soft up close. Still totally fine for most designs.")
    ext = "jpg" if fmt == "JPEG" else fmt.lower()
    art_key = storage.new_key("art", ext)
    storage.put(raw, art_key)
    return dict(ok=True, verdict=verdict, message=message, format=fmt, width=w, height=h,
                has_transparency=bool(has_alpha), effective_dpi=effective_dpi,
                recommended_max_cm={"width": max_w_cm, "height": max_h_cm},
                thresholds={"warn": MIN_DPI_WARN, "fail": MIN_DPI_FAIL}, art_key=art_key)


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

    # Requested physical print size (cm). Falls back to full print area.
    try:
        print_w_cm = float(request.form.get("print_w_cm", PRINT_AREA_CM["width"]))
        print_h_cm = float(request.form.get("print_h_cm", PRINT_AREA_CM["height"]))
    except (TypeError, ValueError):
        print_w_cm, print_h_cm = PRINT_AREA_CM["width"], PRINT_AREA_CM["height"]

    try:
        payload = _grade_and_store(raw, print_w_cm, print_h_cm)
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    # IP / content pre-screen (advisory here; re-checked authoritatively on save + order)
    payload["moderation"] = moderation.check(file.filename or "", raw, source="upload")
    return jsonify(payload)


# --------------------------------------------------------------------------- #
# API — ready-made design library. Drop image files into data/designs/ and they
# appear in the studio's "Browse designs" picker; choosing one runs the exact
# same print-quality grading as an upload and returns an art key + URL.
# --------------------------------------------------------------------------- #
@app.route("/api/designs")
def list_designs():
    items = []
    for p in sorted(DESIGNS_DIR.iterdir()) if DESIGNS_DIR.exists() else []:
        if p.is_file() and p.suffix.lower() in _IMG_EXT:
            title = p.stem.replace("_", " ").replace("-", " ").strip().title()
            items.append({"id": p.name, "title": title,
                          "url": url_for("design_file", fn=p.name)})
    return jsonify(ok=True, designs=items)


@app.route("/designs/<path:fn>")
def design_file(fn: str):
    name = os.path.basename(fn)
    if not (DESIGNS_DIR / name).exists():
        return ("", 404)
    return send_from_directory(DESIGNS_DIR, name)


@app.route("/api/use-design", methods=["POST"])
def use_design():
    """Pick a ready-made design: grade it, store it as an art key (same as an
    upload), and return the key + URL so the studio can place it on the garment."""
    d = request.get_json(silent=True) or {}
    name = os.path.basename(d.get("design", "") or "")
    if not name:
        return jsonify(ok=False, error="No design specified"), 400
    fp = DESIGNS_DIR / name
    if not fp.exists() or not fp.is_file():
        return jsonify(ok=False, error="Design not found"), 404
    try:
        payload = _grade_and_store(fp.read_bytes(), PRINT_AREA_CM["width"], PRINT_AREA_CM["height"])
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    payload["url"] = url_for("design_file", fn=name)
    payload["moderation"] = moderation.check(name, source="library")  # curated → approved
    payload["library_design"] = name
    return jsonify(payload)


# --------------------------------------------------------------------------- #
# Admin — content-moderation review queue. User uploads land here as 'review';
# a human approves (-> fulfillable) or blocks them before any order can ship.
# Guard with the ADMIN_KEY env var in production (open on local dev only).
# --------------------------------------------------------------------------- #
def _admin_ok() -> bool:
    key = os.environ.get("ADMIN_KEY")
    if not key:
        return True  # local dev — SET ADMIN_KEY before deploying
    given = request.args.get("key") or request.headers.get("X-Admin-Key")
    return bool(given) and given == key


@app.route("/admin/moderation")
def admin_moderation():
    if not _admin_ok():
        return ("Unauthorized — append ?key=YOUR_ADMIN_KEY", 401)
    return render_template("admin_moderation.html", brand=BRAND,
                           pending=db.list_moderation("review"),
                           blocked=db.list_moderation("blocked", limit=50),
                           admin_key=request.args.get("key", ""))


@app.route("/api/admin/moderate", methods=["POST"])
def admin_moderate():
    if not _admin_ok():
        return jsonify(ok=False, error="Unauthorized"), 401
    d = request.get_json(silent=True) or {}
    token = d.get("token", "")
    status = {"approve": moderation.APPROVED, "block": moderation.BLOCKED}.get(d.get("action"))
    if not token or not status:
        return jsonify(ok=False, error="token and action (approve|block) required"), 400
    reason = d.get("reason") or ("Approved by reviewer" if status == moderation.APPROVED
                                 else "Rejected by reviewer")
    return jsonify(ok=db.set_moderation(token, status, reason), token=token, status=status)


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

    # Structural guard: the variant must exist in the verified catalogue.
    ok, expected = catalog.verify_item(d["slug"], d.get("color_code"), d.get("size_code"))
    if not ok:
        return jsonify(ok=False, error=expected), 400
    sides = catalog.sides_for(bool(art_front), bool(art_back))
    provider = catalog.provider_of(d["slug"])
    gelato_uid = catalog.build_uid(d["slug"], d.get("color_code"), d.get("size_code"), sides)

    # Authoritative IP / content verdict, re-derived server-side (never trust the
    # client). A curated-library pick is only honoured as 'library' if that file
    # genuinely exists in data/designs/ — otherwise it's treated as a user upload.
    lib = os.path.basename(str(d.get("library_design") or ""))
    src = "library" if (lib and (DESIGNS_DIR / lib).exists()) else "upload"
    mod = moderation.check(d.get("art_filename", "") or "", art_front, source=src)

    design = db.create_design(
        user_id=user_id, product_slug=d["slug"], provider=provider, gelato_uid=gelato_uid,
        color=d.get("color"), color_code=d.get("color_code"),
        size=d.get("size"), size_code=d.get("size_code"), art_key=d.get("art_key"),
        placement={"front": d.get("placement"), "back": d.get("placement_back")},
        printfile_front_url=front_url, printfile_back_url=back_url, preview_url=preview_url,
        moderation_status=mod["status"], moderation_reason=mod.get("reason"),
        rights_confirmed=bool(d.get("rights_confirmed")))

    if user_id:
        db.save_design_for_user(user_id, design["id"], d.get("name"))

    return jsonify(ok=True, design_token=design["token"], gelato_uid=gelato_uid,
                   printfile_front_url=front_url, printfile_back_url=back_url,
                   preview_url=preview_url, moderation=mod,
                   unit_price_cents=catalog.unit_price_cents(d["slug"], d.get("size_code")))


def _guard_items(raw_items):
    """Re-validate a cart server-side before it can reach a factory.

    For each line: (1) the design exists, (2) the variant exists in our verified
    catalogue, (3) providers.verify confirms the UID's grammar matches its
    declared provider AND resolves live with a matching category (anti-mix-up),
    (4) rights confirmed + not IP-blocked. A 'review' design is allowed but its
    token is returned in `pending` so the order is HELD from fulfilment.

    Returns (items, pending_tokens, error). On error, items/pending are None.
    """
    items, pending = [], []
    for it in (raw_items or []):
        design = db.get_design(it.get("design_token", ""))
        if not design:
            return None, None, f"Design not found: {it.get('design_token')}"
        provider = design["provider"] or catalog.provider_of(design["product_slug"])
        ok, expected_gca = catalog.verify_item(
            design["product_slug"], design["color_code"], design["size_code"])
        if not ok:
            return None, None, f"Rejected: {expected_gca}"
        sides = catalog.sides_for(bool(design["printfile_front_url"]),
                                  bool(design["printfile_back_url"]))
        verified_uid = catalog.build_uid(
            design["product_slug"], design["color_code"], design["size_code"], sides)
        ok2, msg = providers.verify(provider, verified_uid, expected_gca)
        if not ok2:
            return None, None, f"Rejected ({provider}): {msg}"
        if not design["rights_confirmed"]:
            return None, None, "Please confirm you own or have the rights to this artwork."
        if design["moderation_status"] == moderation.BLOCKED:
            return None, None, (design["moderation_reason"]
                                or "This design can't be printed for copyright/usage reasons.")
        if design["moderation_status"] != moderation.APPROVED:
            pending.append(design["token"])
        unit = catalog.unit_price_cents(design["product_slug"], design["size_code"])
        items.append({
            "design_id": design["id"], "provider": provider, "gelato_uid": verified_uid,
            "slug": design["product_slug"],
            "quantity": max(1, int(it.get("quantity", 1))), "unit_price": unit,
            "printfile_front_url": design["printfile_front_url"],
            "printfile_back_url": design["printfile_back_url"]})
    if not items:
        return None, None, "No items to order"
    return items, pending, None


def _abs_url(path: str) -> str:
    """Absolute URL for links handed to Paystack / put in emails."""
    base = (os.environ.get("PUBLIC_BASE_URL") or request.host_url).rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def _product_name(slug: str) -> str:
    p = _product(slug)
    return p["name"] if p else (slug or "Item")


def _enrich_for_email(order: dict) -> dict:
    """Add human product names to the order's items for email rendering."""
    for it in order.get("items", []):
        it["product_name"] = _product_name(it.get("product_slug"))
    return order


def _held_designs(order: dict) -> list[dict]:
    """Line items whose design still needs moderation approval (or was rejected)."""
    return [it for it in order.get("items", [])
            if (it.get("moderation_status") or moderation.REVIEW) != moderation.APPROVED]


def _settle_payment(order: dict) -> str:
    """Idempotently move a freshly-paid order into the right state + email the
    customer. Escrow: if any design is still in review, hold the order in
    'in_review'; otherwise it's 'paid' and ready for an admin to release."""
    if order["status"] not in ("created",):
        return order["status"]   # already settled — idempotent (webhook + callback)
    held = _held_designs(order)
    new_status = "in_review" if held else "paid"
    note = (f"Paid. HELD: {len(held)} design(s) awaiting moderation." if held
            else "Paid. All designs cleared — ready to release.")
    db.set_order_status(order["reference"], new_status, notes=note)
    fresh = db.get_order(order["reference"])
    if fresh and fresh.get("email"):
        status_url = _abs_url(f"/order/{fresh['reference']}")
        subj, html_body, text = mailer.order_confirmation(
            _enrich_for_email(fresh), status_url=status_url)
        mailer.send(fresh["email"], subj, html_body, text)
    return new_status


@app.route("/api/orders", methods=["POST"])
def create_order():
    """Persist an order + line items from saved designs (no payment).

    Kept for back-compat / direct API use; the storefront now goes through
    /api/checkout which also initiates payment.
    """
    d = request.get_json(silent=True) or {}
    user_id = db.upsert_user(d.get("user_email"), d.get("user_name"))
    items, pending_review, err = _guard_items(d.get("items"))
    if err:
        return jsonify(ok=False, error=err), 400

    order = db.create_order(user_id, items, currency="ZAR", shipping_json=d.get("shipping"))
    fulfilment = {p: len(its) for p, its in providers.group_by_provider(items).items()}
    if pending_review:
        db.set_order_status(order["reference"], "created",
                            notes=f"HELD: {len(pending_review)} design(s) awaiting moderation approval.")
    return jsonify(ok=True, reference=order["reference"], total=order["total"],
                   currency=order["currency"], status=order["status"],
                   fulfilment_by_provider=fulfilment,
                   needs_review=pending_review,
                   note=("Order persisted. " + ("Held from fulfilment until "
                         f"{len(pending_review)} design(s) pass review." if pending_review
                         else "All designs cleared.")))


# --------------------------------------------------------------------------- #
# Checkout + payment (Paystack) + escrow. Paystack charges immediately, so our
# "escrow" is the order STATE: paid -> in_review (held) -> released or refunded.
# Works with NO keys in dev: a "simulate payment" path drives the same flow so
# the whole pipeline is testable end-to-end before real keys land.
# --------------------------------------------------------------------------- #
@app.route("/api/shipping-quote", methods=["POST"])
def shipping_quote():
    """Preview the cart's subtotal + shipping WITHOUT creating an order, so the
    checkout screen can show an honest total before the customer pays."""
    d = request.get_json(silent=True) or {}
    lines, subtotal = [], 0
    for it in (d.get("items") or []):
        design = db.get_design(it.get("design_token", ""))
        if not design:
            continue
        qty = max(1, int(it.get("quantity", 1)))
        unit = catalog.unit_price_cents(design["product_slug"], design["size_code"])
        subtotal += unit * qty
        lines.append({"slug": design["product_slug"], "quantity": qty})
    if not lines:
        return jsonify(ok=False, error="Your cart is empty."), 400
    quote = shipping.quote(lines, subtotal, country="ZA")
    return jsonify(ok=True, subtotal=subtotal, shipping=quote,
                   total=subtotal + quote["amount_cents"], currency="ZAR")


@app.route("/api/checkout", methods=["POST"])
def checkout():
    """Create the order, price shipping, and start payment.

    body: {email, name, items:[{design_token, quantity}], shipping:{...address}}
    -> Paystack: {mode:'paystack', authorization_url, reference}
    -> dev (no keys): {mode:'dev', pay_url, reference}  (pay_url simulates success)
    """
    d = request.get_json(silent=True) or {}
    email = (d.get("email") or "").strip()
    if not email or "@" not in email:
        return jsonify(ok=False, error="A valid email is required for checkout."), 400

    items, pending_review, err = _guard_items(d.get("items"))
    if err:
        return jsonify(ok=False, error=err), 400

    subtotal = sum(i["unit_price"] * i["quantity"] for i in items)
    ship = shipping.quote([{"slug": i["slug"], "quantity": i["quantity"]} for i in items],
                          subtotal, country="ZA")
    user_id = db.upsert_user(email, d.get("name"))
    order = db.create_order(user_id, items, currency="ZAR",
                            shipping=ship["amount_cents"], shipping_json=d.get("shipping"))
    ref = order["reference"]

    if paystack.has_keys():
        try:
            init = paystack.initialize_transaction(
                email, order["total"], ref, currency="ZAR",
                callback_url=_abs_url(f"/checkout/callback?reference={ref}"),
                metadata={"reference": ref, "items": len(items)})
        except paystack.PaystackError as exc:
            return jsonify(ok=False, error=f"Payment init failed: {exc}"), 502
        return jsonify(ok=True, mode="paystack", reference=ref, total=order["total"],
                       currency="ZAR", shipping=ship,
                       authorization_url=init.get("authorization_url"),
                       public_key=paystack.public_key(), held=bool(pending_review))

    # Dev mode: no Paystack key. Hand back a link that simulates a successful
    # charge so the escrow/email/admin/resume flow can be exercised locally.
    return jsonify(ok=True, mode="dev", reference=ref, total=order["total"],
                   currency="ZAR", shipping=ship, held=bool(pending_review),
                   pay_url=_abs_url(f"/checkout/callback?reference={ref}&dev=1"),
                   note="No Paystack key set — use pay_url to simulate payment.")


@app.route("/checkout/callback")
def checkout_callback():
    """Where the buyer lands after paying. Verifies the payment (real Paystack)
    or simulates it (dev), settles the order, and shows a thank-you page."""
    ref = request.args.get("reference", "")
    order = db.get_order(ref)
    if not order:
        return render_template("checkout_result.html", brand=BRAND, order=None,
                               status="unknown", message="We couldn't find that order."), 404

    paid_ok = False
    if paystack.has_keys():
        try:
            txn = paystack.verify_transaction(ref)
            paid_ok = (txn.get("status") == "success")
        except paystack.PaystackError:
            paid_ok = False
    elif request.args.get("dev") == "1":
        paid_ok = True   # dev simulate

    if paid_ok:
        _settle_payment(order)
        order = db.get_order(ref)

    return render_template("checkout_result.html", brand=BRAND, order=order,
                           status=order["status"], paid=paid_ok)


@app.route("/api/webhooks/paystack", methods=["POST"])
def paystack_webhook():
    """Authoritative payment confirmation. Paystack signs the body with
    HMAC-SHA512 (secret key). We verify, then settle on charge.success.
    Idempotent with the callback verify."""
    raw = request.get_data()
    sig = request.headers.get("x-paystack-signature", "")
    if not paystack.verify_webhook(raw, sig):
        return ("", 401)
    event = request.get_json(silent=True) or {}
    if event.get("event") == "charge.success":
        ref = (event.get("data") or {}).get("reference", "")
        order = db.get_order(ref)
        if order:
            _settle_payment(order)
    return jsonify(ok=True)


@app.route("/outbox/<path:fn>")
def outbox(fn: str):
    """Serve dev email previews (only when no real mail provider is configured)."""
    if mailer.has_provider():
        return ("", 404)
    name = os.path.basename(fn)
    if not (mailer.OUTBOX_DIR / name).exists():
        return ("", 404)
    return send_from_directory(mailer.OUTBOX_DIR, name)


# --------------------------------------------------------------------------- #
# Admin — order queue + escrow actions (release / reject-redo / refund).
# Guarded by ADMIN_KEY in production (open on localhost).
# --------------------------------------------------------------------------- #
@app.route("/admin/orders")
def admin_orders():
    if not _admin_ok():
        return ("Unauthorized — append ?key=YOUR_ADMIN_KEY", 401)
    active = db.list_orders(["paid", "in_review", "awaiting_redo"], limit=100)
    recent = db.list_orders(limit=30)
    for o in active + recent:
        for it in o["items"]:
            it["product_name"] = _product_name(it.get("product_slug"))
    return render_template("admin_orders.html", brand=BRAND, active=active,
                           recent=recent, admin_key=request.args.get("key", ""),
                           paystack_live=paystack.has_keys(), mail_live=mailer.has_provider())


@app.route("/api/admin/order", methods=["POST"])
def admin_order_action():
    if not _admin_ok():
        return jsonify(ok=False, error="Unauthorized"), 401
    d = request.get_json(silent=True) or {}
    ref, action = d.get("reference", ""), d.get("action", "")
    order = db.get_order(ref)
    if not order:
        return jsonify(ok=False, error="Order not found"), 404

    if action == "release":
        held = _held_designs(order)
        if held:
            return jsonify(ok=False, error=(f"{len(held)} design(s) still need moderation "
                           "approval. Approve them in the moderation queue first.")), 400
        if order["status"] not in ("paid", "in_review"):
            return jsonify(ok=False, error=f"Can't release an order in '{order['status']}'."), 400
        results = _release_to_providers(order)
        db.set_order_status(ref, "submitted",
                            notes="Released to fulfilment: " + "; ".join(results))
        fresh = db.get_order(ref)
        sent = {}
        if fresh.get("email"):
            subj, html_body, text = mailer.order_released(_enrich_for_email(fresh))
            sent = mailer.send(fresh["email"], subj, html_body, text)
        return jsonify(ok=True, reference=ref, status="submitted", fulfilment=results, email=sent)

    if action == "reject":
        reason = d.get("reason") or "A design needs to be updated before we can print it."
        db.set_order_status(ref, "awaiting_redo", notes=f"Rejected: {reason}")
        resume_url = _abs_url(f"/resume/{order['resume_token']}")
        sent = {}
        if order.get("email"):
            subj, html_body, text = mailer.design_redo(_enrich_for_email(order), resume_url, reason)
            sent = mailer.send(order["email"], subj, html_body, text)
        return jsonify(ok=True, reference=ref, status="awaiting_redo",
                       resume_url=resume_url, email=sent)

    if action == "refund":
        amount = order["total"]
        refund_res = {"mode": "dev", "note": "No Paystack key — refund simulated."}
        if paystack.has_keys():
            try:
                refund_res = paystack.refund(ref, amount)
            except paystack.PaystackError as exc:
                return jsonify(ok=False, error=f"Refund failed: {exc}"), 502
        db.set_order_status(ref, "refunded", notes=f"Refunded {amount} cents.")
        sent = {}
        if order.get("email"):
            subj, html_body, text = mailer.refund_notice(_enrich_for_email(order), amount)
            sent = mailer.send(order["email"], subj, html_body, text)
        return jsonify(ok=True, reference=ref, status="refunded", refund=refund_res, email=sent)

    return jsonify(ok=False, error="Unknown action (release|reject|refund)."), 400


def _release_to_providers(order: dict) -> list[str]:
    """Submit each provider's lines to its factory. local-sa jobs are fulfilled
    via the printer dashboard — notify the shop by email when one lands."""
    by_provider: dict[str, int] = {}
    for it in order["items"]:
        p = it.get("provider") or "local-sa"
        by_provider[p] = by_provider.get(p, 0) + 1
    out = []
    for prov, n in by_provider.items():
        out.append(f"{prov}×{n}")
        if prov == "local-sa":
            printer_email = os.environ.get("PRINTER_EMAIL", "").strip()
            notify_to = printer_email or BRAND["email"]
            dashboard_url = _abs_url("/printer")
            subj, html_body, text = mailer.printer_job_notification(
                _enrich_for_email(order), dashboard_url)
            mailer.send(notify_to, subj, html_body, text)
    return out


# --------------------------------------------------------------------------- #
# SA PRINTER DASHBOARD — the local-fulfilment portal ("SA printer dashboard").
# South African print shops have no public API (TeePrint / OTC / OneOff / …),
# so released jobs land HERE instead: the print shop sees the print-ready files
# + garment specs + the shipping address, accepts the job (-> in_production) and
# marks it shipped (-> shipped, with optional tracking). Routing target is
# provider 'local-sa'; until a specific shop is wired, every released job shows
# so the queue is usable. Guarded by PRINTER_KEY in production (open on dev).
# --------------------------------------------------------------------------- #
def _printer_ok() -> bool:
    key = os.environ.get("PRINTER_KEY")
    if not key:
        return True  # local dev — SET PRINTER_KEY before deploying
    given = request.args.get("key") or request.headers.get("X-Printer-Key")
    return bool(given) and given == key


def _printer_view(order: dict) -> dict:
    """Shape one order for the print shop: address + line items + print files."""
    try:
        addr = json.loads(order.get("shipping_json") or "{}") or {}
    except (ValueError, TypeError):
        addr = {}
    items, units = [], 0
    for it in order.get("items", []):
        qty = it.get("quantity") or 1
        units += qty
        items.append({
            "product": _product_name(it.get("product_slug")),
            "colour": it.get("color") or "—",
            "size": it.get("size") or "—",
            "qty": qty,
            "provider": it.get("provider") or "gelato",
            "front": it.get("printfile_front_url"),
            "back": it.get("printfile_back_url"),
            "preview": it.get("preview_url"),
        })
    return {
        "reference": order["reference"],
        "status": order["status"],
        "created_at": order.get("created_at"),
        "name": order.get("name") or addr.get("name") or "Customer",
        "address": addr,
        "items": items,
        "units": units,
        "tracking_url": order.get("tracking_url"),
    }


@app.route("/printer")
def printer_dashboard():
    if not _printer_ok():
        return ("Unauthorized — append ?key=YOUR_PRINTER_KEY", 401)
    queue = [_printer_view(o) for o in db.list_orders(["submitted", "in_production"], limit=100)]
    done = [_printer_view(o) for o in db.list_orders(["shipped", "delivered"], limit=20)]
    return render_template("printer_dashboard.html", brand=BRAND, queue=queue,
                           done=done, printer_key=request.args.get("key", ""))


@app.route("/api/printer/job", methods=["POST"])
def printer_job_action():
    if not _printer_ok():
        return jsonify(ok=False, error="Unauthorized"), 401
    d = request.get_json(silent=True) or {}
    ref, action = d.get("reference", ""), d.get("action", "")
    order = db.get_order(ref)
    if not order:
        return jsonify(ok=False, error="Order not found"), 404

    if action == "accept":
        if order["status"] != "submitted":
            return jsonify(ok=False, error=f"Can only accept a 'submitted' job (this is '{order['status']}')."), 400
        db.set_order_status(ref, "in_production", notes="Accepted by SA print shop.")
        return jsonify(ok=True, reference=ref, status="in_production")

    if action == "ship":
        if order["status"] not in ("in_production", "submitted"):
            return jsonify(ok=False, error=f"Can't ship a job in '{order['status']}'."), 400
        tracking = (d.get("tracking") or "").strip() or None
        note = "Shipped by SA print shop." + (f" Tracking: {tracking}" if tracking else "")
        db.set_order_status(ref, "shipped", tracking_url=tracking, notes=note)
        # (Customer 'shipped' email intentionally left to the ops layer — no
        #  misleading template reuse here.)
        return jsonify(ok=True, reference=ref, status="shipped")

    return jsonify(ok=False, error="Unknown action (accept|ship)."), 400


@app.route("/resume/<token>")
def resume(token: str):
    """Magic 'fix your design' page. Loads the held order so the customer can
    swap in a compliant design without logging in."""
    order = db.get_order_by_resume_token(token)
    if not order:
        return render_template("resume.html", brand=BRAND, order=None, token=token,
                               held=[]), 404
    for it in order["items"]:
        it["product_name"] = _product_name(it.get("product_slug"))
    held = _held_designs(order)
    return render_template("resume.html", brand=BRAND, order=order, token=token, held=held)


@app.route("/order/<reference>")
def order_status(reference: str):
    """Public order-tracking page. Linked from the confirmation email."""
    order = db.get_order(reference)
    if not order:
        return render_template("order_status.html", brand=BRAND, order=None,
                               reference=reference, step=0), 404
    for it in order["items"]:
        it["product_name"] = _product_name(it.get("product_slug"))
    # Map order status to a 0-based progress step (0=unknown shown as received)
    _steps = {"created": 0, "paid": 1, "in_review": 1, "awaiting_redo": 1,
              "submitted": 2, "in_production": 3, "shipped": 4, "delivered": 5}
    step = _steps.get(order["status"], 0)
    terminal = order["status"] in ("cancelled", "refunded", "rejected", "failed")
    return render_template("order_status.html", brand=BRAND, order=order,
                           reference=reference, step=step, terminal=terminal)


@app.route("/api/resume/<token>/swap", methods=["POST"])
def resume_swap(token: str):
    """Attach a freshly-saved (compliant) design to a held order line and re-hold
    the order for moderation of the new artwork."""
    order = db.get_order_by_resume_token(token)
    if not order:
        return jsonify(ok=False, error="This link is no longer valid."), 404
    if order["status"] not in ("awaiting_redo", "in_review", "paid"):
        return jsonify(ok=False, error=f"This order can't be edited (status: {order['status']})."), 400

    d = request.get_json(silent=True) or {}
    design = db.get_design(d.get("design_token", ""))
    if not design:
        return jsonify(ok=False, error="New design not found — please save it again."), 400
    if not design["rights_confirmed"]:
        return jsonify(ok=False, error="Please confirm you own or have the rights to this artwork."), 400
    if design["moderation_status"] == moderation.BLOCKED:
        return jsonify(ok=False, error=(design["moderation_reason"]
                       or "This design can't be printed for copyright/usage reasons.")), 400

    # which line is being replaced (explicit item_id, else the first held line)
    item_id = d.get("item_id")
    target = None
    if item_id is not None:
        target = next((it for it in order["items"] if it["id"] == item_id), None)
    if target is None:
        held = _held_designs(order)
        target = held[0] if held else (order["items"][0] if order["items"] else None)
    if not target:
        return jsonify(ok=False, error="Nothing to replace on this order."), 400

    provider = design["provider"] or catalog.provider_of(design["product_slug"])
    sides = catalog.sides_for(bool(design["printfile_front_url"]),
                              bool(design["printfile_back_url"]))
    verified_uid = catalog.build_uid(design["product_slug"], design["color_code"],
                                     design["size_code"], sides)
    db.update_order_item(target["id"], design_id=design["id"], provider=provider,
                         gelato_uid=verified_uid,
                         printfile_front_url=design["printfile_front_url"],
                         printfile_back_url=design["printfile_back_url"])
    # Re-hold for moderation of the new artwork (admin releases once approved).
    db.set_order_status(order["reference"], "in_review",
                        notes="Customer swapped a design — re-held for review.")
    return jsonify(ok=True, reference=order["reference"], status="in_review")


@app.route("/api/webhooks/gooten", methods=["POST"])
def gooten_webhook():
    """Receive Gooten order-status changes and feed them into our order state
    machine. Configure this URL in Gooten Admin -> Settings -> API tab. We set
    Gooten's SourceId to OUR order reference on submit, so the callback maps
    straight back. Optional shared secret via ?token= (GOOTEN_WEBHOOK_SECRET)."""
    secret = os.environ.get("GOOTEN_WEBHOOK_SECRET")
    if secret and request.args.get("token") != secret:
        return ("", 403)
    d = request.get_json(silent=True) or {}
    ref = d.get("SourceId") or d.get("sourceId") or d.get("PartnerOrderId")
    gooten_id = str(d.get("Id") or d.get("OrderId") or d.get("id") or "") or None
    raw_status = d.get("Status") or d.get("OrderStatus") or d.get("status") or ""

    order = db.get_order(ref) if ref else None
    if not order and gooten_id:
        order = db.get_order_by_provider_id(gooten_id)
    if not order:
        return jsonify(ok=False, error="Order not found for webhook"), 404

    mapped = providers.map_gooten_status(raw_status)
    if mapped:
        db.set_order_status(order["reference"], mapped,
                            gelato_order_id=gooten_id,
                            notes=f"gooten:{raw_status}")
    return jsonify(ok=True, reference=order["reference"],
                   status=mapped or order["status"], gooten_status=raw_status)


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


# --------------------------------------------------------------------------- #
# Design mockups (#3) + multi-buy pricing (#8) — additive, self-contained.
# studio_card renders a shareable, recoloured garment preview; bundle-quote is
# the cart's multi-buy math. Both are informational endpoints (like
# shipping-quote) and touch no existing route.
# --------------------------------------------------------------------------- #
@app.route("/api/mockup", methods=["POST"])
def api_mockup():
    """Render a shareable studio-card mockup of a saved design.
    body: {design_token}  (or {art_key, slug, hex}).  -> {ok, url}."""
    if Image is None:
        return jsonify(ok=False, error="Image processing unavailable"), 500
    d = request.get_json(silent=True) or {}
    art_key, slug, hex_color = d.get("art_key"), d.get("slug"), d.get("hex")
    if d.get("design_token"):
        design = db.get_design(d["design_token"])
        if not design:
            return jsonify(ok=False, error="Design not found"), 404
        art_key = design.get("art_key")
        slug = design.get("product_slug")
        hex_color = _color_hex(slug, design.get("color_code")) or hex_color
    if not art_key:
        return jsonify(ok=False, error="No artwork to render"), 400
    art = storage.open_bytes(art_key)
    if not art:
        return jsonify(ok=False, error="Artwork file missing"), 404
    img = mockup.studio_card(art, mockup.family_for(slug or ""),
                             hex_color or "#ffffff", wordmark=BRAND.get("name", ""))
    return jsonify(ok=True, url=storage.put(img, storage.new_key("mockup", "jpg")))


@app.route("/api/bundle-quote", methods=["POST"])
def bundle_quote():
    """Cart math incl. multi-buy discount: subtotal -> bundle discount -> shipping
    -> total + the best upsell nudge. Informational (mirrors /api/shipping-quote);
    applying the discount to the charged order is the coordinated checkout hook."""
    d = request.get_json(silent=True) or {}
    lines = []
    for it in (d.get("items") or []):
        design = db.get_design(it.get("design_token", ""))
        if not design:
            continue
        lines.append({
            "slug": design["product_slug"],
            "quantity": max(1, int(it.get("quantity", 1))),
            "unit_price": catalog.unit_price_cents(design["product_slug"],
                                                   design["size_code"])})
    if not lines:
        return jsonify(ok=False, error="Your cart is empty."), 400
    ship_lines = [{"slug": l["slug"], "quantity": l["quantity"]} for l in lines]
    subtotal = sum(l["unit_price"] * l["quantity"] for l in lines)
    free_over = shipping.quote(ship_lines, subtotal, country="ZA").get("free_over_cents")
    b = bundles.quote(lines, free_over_cents=free_over)
    # shipping is computed on the discounted subtotal (what they actually pay)
    ship = shipping.quote(ship_lines, b["discounted_subtotal_cents"], country="ZA")
    return jsonify(ok=True, bundle=b, shipping=ship,
                   subtotal=b["original_subtotal_cents"],
                   discount=b["discount_cents"],
                   total=b["discounted_subtotal_cents"] + ship["amount_cents"],
                   currency="ZAR")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7450))
    app.run(host="0.0.0.0", port=port, debug=True)
