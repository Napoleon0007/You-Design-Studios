"""
Transactional email — provider-agnostic with a dev preview.

Two modes, chosen by env (no code change to go live):
  • RESEND_API_KEY set  -> sends for real via Resend (zero deps, urllib).
  • not set (dev)       -> writes the rendered email to data/outbox/<file>.html
                           and returns its /outbox URL so you can open it in a
                           browser and SEE exactly what the customer would get.

Every template is one function returning (subject, html, text). The HTML is a
single-column, inline-styled, mobile-first layout (max 480px) that renders the
same in Gmail / Apple Mail / Outlook — no external CSS, no web fonts.

Used by the checkout/escrow flow:
  order_confirmation – we took payment, order is being prepared
  design_redo        – a design needs swapping; carries the magic /resume link
  refund_notice      – we refunded (last-resort path)
  order_released     – released to the factory / in production
"""
from __future__ import annotations

import html as _html
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()

BASE_DIR = Path(__file__).resolve().parent
OUTBOX_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data")) / "outbox"
_ENV = BASE_DIR / ".env"

# Brand surface for emails (kept here so emails don't import the Flask app).
BRAND_NAME = "The TRUeF Studios"
BRAND_COLOR = "#0a0a0a"
ACCENT = "#ff5a1f"


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


def mail_from() -> str:
    return os.environ.get("MAIL_FROM", f"{BRAND_NAME} <onboarding@resend.dev>").strip()


def has_provider() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


def is_live() -> bool:
    return has_provider()


# --------------------------------------------------------------- transport --- #
def _resend(to: str, subject: str, html_body: str, text: str) -> dict:
    key = os.environ.get("RESEND_API_KEY", "").strip()
    body = json.dumps({"from": mail_from(), "to": [to], "subject": subject,
                       "html": html_body, "text": text}).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails", data=body, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=_SSL_CTX) as r:
            data = json.loads(r.read() or "null") or {}
        return {"ok": True, "provider": "resend", "id": data.get("id"), "to": to}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        return {"ok": False, "provider": "resend", "to": to,
                "error": f"Resend {e.code}: {detail}"}
    except urllib.error.URLError as e:
        return {"ok": False, "provider": "resend", "to": to,
                "error": f"Network error reaching Resend: {e.reason}"}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "email").lower()).strip("-")[:40] or "email"


def _dev_preview(to: str, subject: str, html_body: str, text: str) -> dict:
    """Write the email to data/outbox/ and return its previewable path."""
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    fn = f"{stamp}_{_slug(to)}_{_slug(subject)}.html"
    banner = (f'<div style="background:#fffbe6;border-bottom:1px solid #f0e0a0;'
              f'padding:8px 12px;font:12px/1.4 -apple-system,sans-serif;color:#7a6a1a">'
              f'DEV PREVIEW — not actually sent. To: <b>{_html.escape(to)}</b> · '
              f'Subject: <b>{_html.escape(subject)}</b>. Set RESEND_API_KEY to send for real.'
              f'</div>')
    (OUTBOX_DIR / fn).write_text(banner + html_body, encoding="utf-8")
    return {"ok": True, "provider": "dev-preview", "to": to, "subject": subject,
            "preview_url": f"/outbox/{fn}", "file": str(OUTBOX_DIR / fn)}


def send(to: str, subject: str, html_body: str, text: Optional[str] = None) -> dict:
    """Dispatch one email. Real send if RESEND_API_KEY is set, else dev preview.
    Never raises — returns {ok, provider, ...} so the order flow can't be broken
    by an email hiccup."""
    if not to:
        return {"ok": False, "error": "no recipient"}
    text = text or re.sub(r"<[^>]+>", "", html_body)
    if has_provider():
        return _resend(to, subject, html_body, text)
    return _dev_preview(to, subject, html_body, text)


# --------------------------------------------------------------- rendering --- #
def _money(cents: int, currency: str = "R") -> str:
    return f"{currency}{(int(cents) / 100):,.2f}"


def _shell(title: str, intro: str, rows_html: str = "", cta: Optional[tuple] = None,
           footer: str = "") -> str:
    """Shared mobile-first email layout. cta = (label, url)."""
    btn = ""
    if cta:
        label, url = cta
        btn = (f'<tr><td style="padding:8px 0 4px"><a href="{_html.escape(url)}" '
               f'style="display:block;background:{ACCENT};color:#fff;text-decoration:none;'
               f'font:600 16px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;'
               f'padding:16px;border-radius:12px">{_html.escape(label)}</a></td></tr>')
    rows = f'<tr><td style="padding:4px 0">{rows_html}</td></tr>' if rows_html else ""
    foot = footer or (f"You're receiving this because you placed an order at {BRAND_NAME}.")
    return f"""\
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f2;padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="background:#f4f4f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;
 box-shadow:0 2px 18px rgba(0,0,0,.06)">
 <tr><td style="background:{BRAND_COLOR};padding:18px 24px">
   <span style="color:#fff;font:700 18px/1 -apple-system,Segoe UI,Roboto,sans-serif;
   letter-spacing:.3px">{BRAND_NAME}</span></td></tr>
 <tr><td style="padding:24px 24px 8px">
   <h1 style="margin:0 0 8px;font:700 22px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;
   color:{BRAND_COLOR}">{_html.escape(title)}</h1>
   <p style="margin:0;font:400 15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;
   color:#444">{intro}</p></td></tr>
 <tr><td style="padding:8px 24px 20px">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}{btn}</table>
 </td></tr>
 <tr><td style="padding:16px 24px 22px;border-top:1px solid #eee">
   <p style="margin:0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
   color:#999">{foot}</p></td></tr>
</table></td></tr></table></body></html>"""


def _items_table(order: dict, currency: str = "R") -> str:
    cells = []
    for it in order.get("items", []):
        name = _html.escape(str(it.get("product_name") or it.get("gelato_uid") or "Item"))
        qty = int(it.get("quantity", 1))
        line = int(it.get("unit_price", 0)) * qty
        cells.append(
            f'<tr><td style="padding:6px 0;font:400 14px/1.4 -apple-system,sans-serif;'
            f'color:#333">{name} <span style="color:#999">×{qty}</span></td>'
            f'<td align="right" style="padding:6px 0;font:600 14px/1.4 -apple-system,sans-serif;'
            f'color:#333;white-space:nowrap">{_money(line, currency)}</td></tr>')
    sub = int(order.get("subtotal", 0))
    ship = int(order.get("shipping", 0))
    total = int(order.get("total", sub + ship))
    foot = (
        f'<tr><td colspan="2" style="border-top:1px solid #eee;padding-top:8px"></td></tr>'
        f'<tr><td style="padding:2px 0;font:400 13px/1.4 -apple-system,sans-serif;color:#777">Subtotal</td>'
        f'<td align="right" style="font:400 13px/1.4 -apple-system,sans-serif;color:#777">{_money(sub, currency)}</td></tr>'
        f'<tr><td style="padding:2px 0;font:400 13px/1.4 -apple-system,sans-serif;color:#777">Shipping</td>'
        f'<td align="right" style="font:400 13px/1.4 -apple-system,sans-serif;color:#777">'
        f'{"FREE" if ship == 0 else _money(ship, currency)}</td></tr>'
        f'<tr><td style="padding:4px 0;font:700 15px/1.4 -apple-system,sans-serif;color:#111">Total</td>'
        f'<td align="right" style="font:700 15px/1.4 -apple-system,sans-serif;color:#111">{_money(total, currency)}</td></tr>')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{"".join(cells)}{foot}</table>'


# ----------------------------------------------------------------- emails --- #
def order_confirmation(order: dict, currency: str = "R", status_url: str = "") -> tuple:
    ref = order.get("reference", "")
    title = "Thanks — we've got your order"
    intro = (f"Payment received. We're preparing your custom order "
             f"<b>{_html.escape(ref)}</b>. We'll email you the moment it's sent to print.")
    cta = ("Track my order", status_url) if status_url else None
    html_body = _shell(title, intro, rows_html=_items_table(order, currency),
                       cta=cta, footer=f"Order {_html.escape(ref)} · {BRAND_NAME}")
    text = f"Payment received for order {ref}. Total {_money(order.get('total', 0), currency)}."
    if status_url:
        text += f" Track your order: {status_url}"
    return (f"Order confirmed — {ref}", html_body, text)


def printer_job_notification(order: dict, dashboard_url: str, currency: str = "R") -> tuple:
    """Alert the SA print shop that a new job is ready to print."""
    ref = order.get("reference", "")
    name = order.get("name") or "Customer"
    try:
        addr = json.loads(order.get("shipping_json") or "{}") or {}
    except (ValueError, TypeError):
        addr = {}

    items_html = ""
    for it in order.get("items", []):
        product = _html.escape(str(it.get("product_name") or it.get("product_slug") or "Item"))
        colour = _html.escape(str(it.get("color") or "—"))
        size = _html.escape(str(it.get("size") or "—"))
        qty = int(it.get("quantity", 1))
        front = it.get("printfile_front_url") or ""
        back = it.get("printfile_back_url") or ""
        items_html += (f'<tr><td style="padding:8px 0;border-bottom:1px solid #eee">'
                       f'<b>{product}</b><br>'
                       f'<span style="color:#666;font-size:13px">{colour} · {size} · Qty {qty}</span>')
        if front:
            items_html += (f'<br><a href="{_html.escape(front)}" '
                           f'style="color:#0066cc;font-size:13px">⬇ Front print file</a>')
        if back:
            items_html += (f' &nbsp;<a href="{_html.escape(back)}" '
                           f'style="color:#0066cc;font-size:13px">⬇ Back print file</a>')
        items_html += '</td></tr>'

    addr_parts = [addr.get("line1", ""), addr.get("line2", ""), addr.get("city", ""),
                  addr.get("province", ""), addr.get("postal_code", "")]
    addr_str = ", ".join(p for p in addr_parts if p)

    rows_html = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
                 f'{items_html}'
                 f'<tr><td style="padding:10px 0 4px;font:400 14px/1.5 -apple-system,sans-serif">'
                 f'<b>Ship to:</b> {_html.escape(name)}'
                 f'{(" — " + _html.escape(addr_str)) if addr_str else ""}'
                 f'</td></tr></table>')

    title = f"New print job — {ref}"
    intro = ("A new order is ready to print. Accept the job in the dashboard, "
             "produce it, then mark it shipped with a tracking number.")
    html_body = _shell(title, intro, rows_html=rows_html,
                       cta=("Open Dashboard → Accept Job", dashboard_url),
                       footer=f"Job {_html.escape(ref)} · TRUEF Studios printer portal")
    text = (f"New print job {ref}.\nOpen the dashboard: {dashboard_url}\n"
            f"Ship to: {name}{(', ' + addr_str) if addr_str else ''}")
    return (f"New print job — {ref}", html_body, text)


def design_redo(order: dict, resume_url: str, reason: str = "", currency: str = "R") -> tuple:
    ref = order.get("reference", "")
    title = "One quick fix to your design"
    why = (f' Reason: {_html.escape(reason)}' if reason else "")
    intro = ("We couldn't print one of your designs as-is — usually a rights/quality "
             f"issue.{why} Your payment is safe and your order is held. Tap below to "
             "swap in a new design and we'll get it printed right away.")
    html_body = _shell(title, intro, rows_html=_items_table(order, currency),
                       cta=("Fix my design", resume_url),
                       footer=f"Order {_html.escape(ref)} · this link is private to you.")
    return (f"Action needed: update your design — {ref}", html_body,
            f"Update your design for order {ref}: {resume_url}")


def refund_notice(order: dict, amount_cents: int, currency: str = "R") -> tuple:
    ref = order.get("reference", "")
    title = "Your refund is on the way"
    intro = (f"We've refunded <b>{_money(amount_cents, currency)}</b> for order "
             f"<b>{_html.escape(ref)}</b>. It usually lands back on your card within "
             "5–10 working days, depending on your bank.")
    html_body = _shell(title, intro, footer=f"Order {_html.escape(ref)} · {BRAND_NAME}")
    return (f"Refund processed — {ref}", html_body,
            f"Refunded {_money(amount_cents, currency)} for order {ref}.")


def order_released(order: dict, currency: str = "R") -> tuple:
    ref = order.get("reference", "")
    title = "Your order is in production"
    intro = (f"Good news — order <b>{_html.escape(ref)}</b> has been approved and sent "
             "to print. We'll send tracking as soon as it ships.")
    html_body = _shell(title, intro, rows_html=_items_table(order, currency),
                       footer=f"Order {_html.escape(ref)} · {BRAND_NAME}")
    return (f"In production — {ref}", html_body,
            f"Order {ref} is in production.")
