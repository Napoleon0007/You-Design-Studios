"""
Gooten API client — THIRD fulfilment provider, and the first one whose order API
we can drive straight from our own custom site exactly the way we want.

Base:  https://api.print.io/api/v/5/source/api/
Auth:  `recipeId` in the URL query  (PUBLIC — your Gooten id).
       `PartnerBillingKey`          (PRIVATE — never client-side). Required to
       price + submit orders; it charges the payment method on YOUR Gooten
       account. So OUR checkout (Paystack) collects from the customer and Gooten
       bills us the wholesale cost. Gooten itself collects nothing from buyers —
       which is why we own the cart (we already do).

Why it slots in cleanly:
  * order images attach as publicly-accessible URLs (Images[].Url) — that's
    exactly what printfile.py + storage.py + PUBLIC_BASE_URL already produce.
  * SpaceId on each image = which print space (front/back).
  * IsInTestMode lets us submit safe test orders before going live.

Keys live in a git-ignored .env: GOOTEN_RECIPE_ID, GOOTEN_PARTNER_BILLING_KEY.
Zero third-party deps (urllib).
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()

BASE = "https://api.print.io/api/v/5/source/api"
GEO_IP = "https://printio-geo.appspot.com/ip"   # client-side country detection
_ENV = Path(__file__).resolve().parent / ".env"


def _load_env() -> None:
    if not _ENV.exists():
        return
    for line in _ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


class GootenError(RuntimeError):
    pass


def recipe_id() -> str:
    return os.environ.get("GOOTEN_RECIPE_ID", "").strip()


def billing_key() -> str:
    return os.environ.get("GOOTEN_PARTNER_BILLING_KEY", "").strip()


def has_key() -> bool:
    """Catalog/estimates only need the RecipeID; orders also need the billing key."""
    return bool(recipe_id())


def has_order_key() -> bool:
    return bool(recipe_id() and billing_key())


def _url(path: str, params: dict | None = None) -> str:
    p = dict(params or {})
    p.setdefault("recipeId", recipe_id())
    return f"{BASE}/{path.lstrip('/')}?{urllib.parse.urlencode(p)}"


def _request(method: str, url: str, body: dict | None = None) -> dict:
    if not recipe_id():
        raise GootenError("GOOTEN_RECIPE_ID not set — add it to .env")
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=45, context=_SSL_CTX) as r:
            payload = json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise GootenError(f"Gooten {e.code} on {method} {url.split('?')[0]}: {detail}") from None
    except urllib.error.URLError as e:
        raise GootenError(f"Network error reaching Gooten: {e.reason}") from None
    # Gooten signals logical failures with HadError=true even on a 2xx.
    if isinstance(payload, dict) and payload.get("HadError"):
        errs = "; ".join(f"{x.get('PropertyName')}: {x.get('ErrorMessage')}"
                         for x in payload.get("Errors", []))
        raise GootenError(f"Gooten error [{payload.get('ErrorReferenceCode')}]: {errs}")
    return payload


# ------------------------------------------------------------------ catalog -- #
def supported_countries() -> list:
    """Countries Gooten can ship to (+ each one's default currency). Run this
    FIRST with a RecipeID — if South Africa (ZA) isn't supported, Gooten is a
    non-starter, same as the local printers without an API."""
    r = _request("GET", _url("countries"))
    return r.get("Countries", r) if isinstance(r, dict) else r


def supports_country(code: str = "ZA") -> tuple[bool, str]:
    """Is `code` a supported shipping destination? Returns (ok, default_currency)."""
    for c in supported_countries():
        if (c.get("Code") or "").upper() == code.upper():
            cur = (c.get("DefaultCurrency") or {}).get("Code", "")
            return bool(c.get("IsSupported", True)), cur
    return False, ""


CATALOG_URL = "https://gtnadminassets.blob.core.windows.net/productdatav3/catalog.json"


def list_products() -> list:
    """Full product catalog. Gooten serves this as a static JSON blob (no
    recipeId). Returns a flat list of products (each: product_id, name, type,
    description, cheapest_price, cheapest_shipping, deprecated, out_of_stock)."""
    req = urllib.request.Request(CATALOG_URL, headers={
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"})
    with urllib.request.urlopen(req, timeout=45, context=_SSL_CTX) as r:
        raw = r.read()
    if raw[:2] == b"\x1f\x8b":  # the blob is gzip-compressed
        import gzip
        raw = gzip.decompress(raw)
    data = json.loads(raw or "null")
    out = []
    for cat in (data.get("product-catalog", []) if isinstance(data, dict) else []):
        out.extend(cat.get("items", []))
    return out


def get_variants(product_id: str | int, country: str = "ZA",
                 currency: str = "ZAR", page: int = 1, page_size: int = 200) -> dict:
    """SKUs + options (colour RgbaColor, size, CmValue dims), prices, templates."""
    return _request("GET", _url("productvariants", {
        "productId": product_id, "countryCode": country, "currencyCode": currency,
        "page": page, "pageSize": page_size}))


# ------------------------------------------------------------------ cart ----- #
def shipping_estimate(product_id: str | int, country: str = "ZA",
                      currency: str = "ZAR") -> dict:
    """Min/Max shipping price + EstShipDays + VendorCountryCode (where it ships
    FROM) — run this for ZA FIRST so we don't repeat the Gelato R1400 surprise."""
    return _request("GET", _url("shippriceestimate", {
        "productId": product_id, "countryCode": country, "currencyCode": currency}))


def price_estimate(items: list[dict], ship_to: dict, currency: str = "ZAR") -> dict:
    """items: [{Quantity, SKU, ShipType}]. Needs the billing key. Returns the
    full price breakdown (partner cost + customer price + tax + shipping)."""
    if not billing_key():
        raise GootenError("GOOTEN_PARTNER_BILLING_KEY not set — needed to price")
    return _request("POST", _url("price"), {
        "ShipToAddress": ship_to,
        "Items": items,
        "Payment": {"CurrencyCode": currency, "PartnerBillingKey": billing_key()}})


# ------------------------------------------------------------------ orders --- #
def submit_order(items: list[dict], ship_to: dict, billing_address: dict | None = None,
                 source_id: str | None = None, test: bool = True, unique: bool = True) -> dict:
    """Submit an order. items: [{Quantity, SKU, ShipType, Images:[{Url,SpaceId,Index}]}].
    Pass `source_id` = OUR order reference; with `unique` set, IsPartnerSourceIdUnique
    makes Gooten BLOCK a duplicate submission of the same reference (no double-charge).
    `test=True` uses IsInTestMode so nothing is charged/produced. Returns {Id}."""
    if not has_order_key():
        raise GootenError("Gooten RecipeID + PartnerBillingKey required to order")
    body = {
        "ShipToAddress": ship_to,
        "BillingAddress": billing_address or ship_to,
        "Items": items,
        "Payment": {"PartnerBillingKey": billing_key()},
        "IsInTestMode": bool(test),
    }
    if source_id:
        body["SourceId"] = source_id
        body["IsPartnerSourceIdUnique"] = bool(unique)
    return _request("POST", _url("orders/"), body)


def get_order(order_id: str) -> dict:
    return _request("GET", _url("order", {"id": order_id}))


# ------------------------------------------------------------------ guard ---- #
# Loose map from a Gooten product/option name -> our garment category.
_TYPE_TO_CATEGORY = [
    ("hoodie", "hoodie"), ("sweatshirt", "sweatshirt"), ("crew", "sweatshirt"),
    ("tank", "tank-top"), ("polo", "polo"), ("t-shirt", "t-shirt"), ("tee", "t-shirt"),
]


def verify_sku(sku: str, expected_category: str | None = None,
               product_id: str | int | None = None, country: str = "ZA") -> tuple[bool, str]:
    """LIVE guard: confirm the SKU is real + orderable on Gooten (and, when a
    productId is known, that its category matches). Network errors are not fatal;
    a definitive rejection is."""
    if not has_key():
        return True, "skipped (no key)"
    try:
        if product_id is not None:
            data = get_variants(product_id, country=country)
            variants = data.get("ProductVariants", data.get("Variants", [])) or []
            skus = {v.get("Sku") or v.get("SKU") for v in variants}
            if sku not in skus:
                return False, f"SKU not found in Gooten product {product_id}: {sku}"
            return True, "ok"
        # No productId: prove the SKU prices (existence + orderable) via estimate.
        if billing_key():
            ship_to = {"CountryCode": country, "PostalCode": "8001", "City": "Cape Town"}
            price_estimate([{"Quantity": 1, "SKU": sku, "ShipType": "standard"}], ship_to)
        return True, "ok"
    except GootenError as e:
        msg = str(e)
        if any(t in msg.lower() for t in ("not found", "invalid", "sku", "should not")):
            return False, f"Gooten rejected SKU: {msg[:140]}"
        return True, f"live check skipped ({msg[:80]})"
