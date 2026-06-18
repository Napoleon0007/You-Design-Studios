"""
Gelato API client (read-only catalog use for now).

Single source of truth for product/variant UIDs — we NEVER hand-type a UID.
Auth is the `X-API-KEY` header. The key is read from the environment
(GELATO_API_KEY), loaded from a git-ignored .env so the secret never touches
source control or chat.

Zero third-party deps (urllib) so it runs anywhere.

Endorsed endpoints (Product/Catalog API, base product.gelatoapis.com):
  GET  /v3/catalogs                                  list catalogs
  GET  /v3/catalogs/{catalogUid}                     catalog + its attributes
  POST /v3/catalogs/{catalogUid}/products:search     products in a catalog
  GET  /v3/products/{productUid}                      one product (variant UIDs)
  GET  /v3/products/{productUid}/prices               prices for a product
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path

try:  # macOS Python often lacks system CA certs; use certifi's bundle
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()

BASE_PRODUCT = "https://product.gelatoapis.com"
BASE_ORDER = "https://order.gelatoapis.com"

_ENV = Path(__file__).resolve().parent / ".env"


def _load_env() -> None:
    """Minimal .env loader (no python-dotenv dependency)."""
    if not _ENV.exists():
        return
    for line in _ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()


class GelatoError(RuntimeError):
    pass


def api_key() -> str:
    return os.environ.get("GELATO_API_KEY", "").strip()


def has_key() -> bool:
    return bool(api_key())


def _request(method: str, url: str, body: dict | None = None) -> dict | list:
    if not has_key():
        raise GelatoError("GELATO_API_KEY not set — add it to .env")
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        "X-API-KEY": api_key(),
        "Accept": "application/json",
        # Gelato sits behind Cloudflare, which 1010-bans the default urllib UA.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40, context=_SSL_CTX) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise GelatoError(f"Gelato {e.code} on {method} {url}: {detail}") from None
    except urllib.error.URLError as e:
        raise GelatoError(f"Network error reaching Gelato: {e.reason}") from None


# --------------------------------------------------------------- catalog --- #
def list_catalogs() -> list:
    r = _request("GET", f"{BASE_PRODUCT}/v3/catalogs")
    return r.get("data", r) if isinstance(r, dict) else r


def get_catalog(catalog_uid: str) -> dict:
    return _request("GET", f"{BASE_PRODUCT}/v3/catalogs/{catalog_uid}")


def search_products(catalog_uid: str, limit: int = 100, offset: int = 0,
                    attribute_filters: dict | None = None) -> dict:
    body: dict = {"limit": limit, "offset": offset}
    if attribute_filters:
        body["attributeFilters"] = attribute_filters
    return _request("POST", f"{BASE_PRODUCT}/v3/catalogs/{catalog_uid}/products:search", body)


def get_product(product_uid: str) -> dict:
    return _request("GET", f"{BASE_PRODUCT}/v3/products/{product_uid}")


def get_prices(product_uid: str, country: str = "ZA", currency: str = "ZAR") -> list:
    return _request("GET",
                    f"{BASE_PRODUCT}/v3/products/{product_uid}/prices"
                    f"?country={country}&currency={currency}")
