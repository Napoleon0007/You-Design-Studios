"""
Paystack payment client (South Africa).

Paystack charges the card immediately (it does NOT hold/authorise-then-capture
for one-off cards), then settles funds to your bank ~T+1/T+2. So our "escrow"
is the ORDER STATE, not a card hold: we take the money, hold the order in
'in_review', and either release to the factory on approval or REFUND on reject.

Test vs live is just which key is in .env — no code change to go live:
  PAYSTACK_SECRET_KEY=sk_test_...  / sk_live_...
  PAYSTACK_PUBLIC_KEY=pk_test_...  / pk_live_...   (used by the browser checkout)

Amounts are in the currency SUBUNIT (ZAR cents) — which is exactly how db.py
already stores prices, so we pass order totals straight through. Zero deps (urllib).
"""
from __future__ import annotations

import hashlib
import hmac
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

BASE = "https://api.paystack.co"
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


class PaystackError(RuntimeError):
    pass


def secret_key() -> str:
    return os.environ.get("PAYSTACK_SECRET_KEY", "").strip()


def public_key() -> str:
    return os.environ.get("PAYSTACK_PUBLIC_KEY", "").strip()


def has_keys() -> bool:
    return bool(secret_key())


def is_test() -> bool:
    return secret_key().startswith("sk_test")


def _request(method: str, path: str, body: dict | None = None) -> dict:
    if not has_keys():
        raise PaystackError("PAYSTACK_SECRET_KEY not set — add a test key to .env")
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {secret_key()}", "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40, context=_SSL_CTX) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise PaystackError(f"Paystack {e.code} on {method} {path}: {detail}") from None
    except urllib.error.URLError as e:
        raise PaystackError(f"Network error reaching Paystack: {e.reason}") from None


# --------------------------------------------------------------- payments --- #
def initialize_transaction(email: str, amount_cents: int, reference: str,
                           currency: str = "ZAR", callback_url: str | None = None,
                           metadata: dict | None = None) -> dict:
    """Start a checkout. Returns {authorization_url, access_code, reference}.
    `amount_cents` is the ZAR subunit (R399.00 -> 39900), matching db cents."""
    body = {"email": email, "amount": int(amount_cents), "currency": currency,
            "reference": reference}
    if callback_url:
        body["callback_url"] = callback_url
    if metadata:
        body["metadata"] = metadata
    res = _request("POST", "/transaction/initialize", body)
    if not res.get("status"):
        raise PaystackError(f"initialize failed: {res.get('message')}")
    return res["data"]


def verify_transaction(reference: str) -> dict:
    """Confirm a payment. Returns the transaction data (check data['status']=='success')."""
    res = _request("GET", f"/transaction/verify/{urllib.parse.quote(reference)}")
    if not res.get("status"):
        raise PaystackError(f"verify failed: {res.get('message')}")
    return res["data"]


def refund(reference: str, amount_cents: int | None = None) -> dict:
    """Refund a transaction (full, or partial if amount_cents given). Last-resort
    path when a rejected design can't be redone. Note: the gateway fee is NOT
    returned — every refund costs ~the Paystack fee, so prefer the redo flow."""
    body: dict = {"transaction": reference}
    if amount_cents is not None:
        body["amount"] = int(amount_cents)
    res = _request("POST", "/refund", body)
    if not res.get("status"):
        raise PaystackError(f"refund failed: {res.get('message')}")
    return res["data"]


# ---------------------------------------------------------------- webhook --- #
def verify_webhook(raw_body: bytes, signature: str) -> bool:
    """Paystack signs webhook bodies with HMAC-SHA512 using your SECRET key.
    Reject any /api/webhooks/paystack call whose x-paystack-signature fails this."""
    if not signature or not has_keys():
        return False
    digest = hmac.new(secret_key().encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, signature)
