"""
Printful API client — SECOND fulfilment provider (apparel).

Read-only catalog use for now (browse what's available / trending). Ordering
comes later and needs a Printful *store* (X-PF-Store-Id) — the account behind
this key currently has none, so order calls are intentionally not wired yet.

Auth: `Authorization: Bearer <PRINTFUL_API_KEY>` (read from a git-ignored .env).
Base: https://api.printful.com. Zero third-party deps (urllib).

Printful identifies a printable variant by an INTEGER catalog variant id
(e.g. 4012) — completely unlike Gelato's long token UIDs. providers.py uses
that difference as a hard guard so the two systems can never be confused.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()

BASE = "https://api.printful.com"
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


class PrintfulError(RuntimeError):
    pass


def api_key() -> str:
    return os.environ.get("PRINTFUL_API_KEY", "").strip()


def has_key() -> bool:
    return bool(api_key())


def _request(method: str, path: str, body: dict | None = None,
             store_id: str | None = None) -> dict:
    if not has_key():
        raise PrintfulError("PRINTFUL_API_KEY not set — add it to .env")
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    if store_id:
        headers["X-PF-Store-Id"] = str(store_id)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40, context=_SSL_CTX) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise PrintfulError(f"Printful {e.code} on {method} {path}: {detail}") from None
    except urllib.error.URLError as e:
        raise PrintfulError(f"Network error reaching Printful: {e.reason}") from None


# ------------------------------------------------------------------ catalog -- #
def list_catalog(category_id: int | None = None, limit: int = 100,
                 offset: int = 0) -> list:
    """Catalog products (the blanks Printful can print). No store needed."""
    q = f"?limit={limit}&offset={offset}"
    if category_id is not None:
        q += f"&category_id={category_id}"
    r = _request("GET", f"/products{q}")
    return r.get("result", [])


def categories() -> list:
    return _request("GET", "/categories").get("result", {}).get("categories", [])


def get_product(product_id: int | str) -> dict:
    """A catalog product + all its variants."""
    return _request("GET", f"/products/{product_id}").get("result", {})


def get_variant(variant_id: int | str) -> dict:
    """A single catalog variant (+ its parent product). Resolves an integer UID."""
    return _request("GET", f"/products/variant/{variant_id}").get("result", {})


def list_stores() -> list:
    """Stores on this account (empty until one is created in the dashboard)."""
    return _request("GET", "/stores").get("result", [])


# Loose map from Printful product type_name -> our garment category, so a
# Printful variant can be type-checked the same way as a Gelato one.
_TYPE_TO_CATEGORY = [
    ("hoodie", "hoodie"), ("sweatshirt", "sweatshirt"), ("crewneck", "sweatshirt"),
    ("tank", "tank-top"), ("polo", "polo"), ("t-shirt", "t-shirt"), ("tee", "t-shirt"),
]


def category_of(product: dict) -> str | None:
    name = (product.get("type_name") or product.get("title") or "").lower()
    for needle, cat in _TYPE_TO_CATEGORY:
        if needle in name:
            return cat
    return None


def verify_variant(variant_id: str, expected_category: str | None = None) -> tuple[bool, str]:
    """LIVE guard: the variant must resolve in Printful's catalog, and (when we
    can tell) its product type must match the expected garment category."""
    if not has_key():
        return True, "skipped (no key)"
    try:
        res = get_variant(variant_id)
    except PrintfulError as e:
        msg = str(e)
        if any(code in msg for code in (" 400", " 404", " 422")):
            return False, f"Printful rejected variant {variant_id}: {msg[:120]}"
        return True, f"live check skipped ({msg[:80]})"
    product = res.get("product", {}) or {}
    cat = category_of(product)
    if expected_category and cat and cat != expected_category:
        return False, (f"Type mismatch: Printful variant {variant_id} is "
                       f"'{cat}', expected '{expected_category}'")
    return True, "ok"
