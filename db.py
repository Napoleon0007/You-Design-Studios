"""
Persistence — SQLite (no ORM), Postgres-ready.

Tables mirror the order lifecycle:
  users           – accounts (lightweight; email-keyed)
  designs         – a configured product + uploaded art + placement + the
                    generated print-file URLs (front/back)
  saved_designs   – a user's saved designs ("save for later")
  orders          – one checkout; carries Gelato order id + status + tracking
  order_items     – line items (a design + quantity + frozen unit price)

Local file at data/app.db. On Railway, point DATA_DIR at a mounted Volume (and
move to Postgres) before real orders — container disk is ephemeral.
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
DB_PATH = DATA_DIR / "app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT UNIQUE,
  name                 TEXT,
  password_hash        TEXT,
  reset_token          TEXT,
  reset_token_expires  INTEGER,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS addresses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT,
  line1        TEXT,
  line2        TEXT,
  city         TEXT,
  province     TEXT,
  postal_code  TEXT,
  country      TEXT NOT NULL DEFAULT 'ZA',
  is_default   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS designs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT UNIQUE NOT NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_slug  TEXT NOT NULL,
  provider      TEXT,                 -- 'gelato' | 'printful' (fulfilment routing)
  gelato_uid    TEXT,                 -- the provider's product/variant UID
  color         TEXT,
  color_code    TEXT,
  size          TEXT,
  size_code     TEXT,
  art_key       TEXT,
  placement     TEXT,                 -- JSON {scale,cx,cy,rotation} per side
  printfile_front_url TEXT,
  printfile_back_url  TEXT,
  preview_url   TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'review',  -- approved | review | blocked
  moderation_reason TEXT,
  rights_confirmed  INTEGER NOT NULL DEFAULT 0,       -- user affirmed they own the art
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_designs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  design_id   INTEGER REFERENCES designs(id) ON DELETE CASCADE,
  name        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reference       TEXT UNIQUE NOT NULL,
  resume_token    TEXT,                          -- secret for the magic "fix your design" link
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'created',
  currency        TEXT NOT NULL DEFAULT 'ZAR',
  subtotal        INTEGER NOT NULL DEFAULT 0,   -- cents
  shipping        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  shipping_json   TEXT,
  gelato_order_id TEXT,
  tracking_url    TEXT,
  notes           TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  design_id   INTEGER REFERENCES designs(id) ON DELETE SET NULL,
  provider    TEXT,                            -- 'gelato' | 'printful'
  gelato_uid  TEXT,                            -- the provider's product/variant UID
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL DEFAULT 0,        -- cents
  upsize_fee_cents INTEGER NOT NULL DEFAULT 0,   -- per-unit large-print add-on (OTC upsize)
  printfile_front_url TEXT,
  printfile_back_url  TEXT
);

-- Immutable audit trail: one row per lifecycle event (created, payment_initiated,
-- paid, declined, released, shipped, refunded, status changes). Never overwritten,
-- so every order is traceable start-to-finish with exact timestamps.
CREATE TABLE IF NOT EXISTS order_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  reference    TEXT,                          -- denormalised for easy querying
  event        TEXT NOT NULL,                 -- created | payment_initiated | paid | declined | shipped | …
  detail       TEXT,                          -- human note / gateway response / reason
  amount_cents INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_designs_user   ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_items_order    ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_events_order   ON order_events(order_id);
CREATE INDEX IF NOT EXISTS idx_events_ref     ON order_events(reference);
"""

# valid order states (the fulfillment state machine)
#   created     – order persisted, not yet paid
#   paid        – Paystack payment confirmed (money captured; settles to bank ~T+2)
#   in_review   – paid but HELD: a design awaits moderation approval (our "escrow")
#   awaiting_redo – a design was rejected; customer invited to upload a compliant one
#   submitted   – released to the fulfilment provider (Gelato/…)
#   in_production / shipped / delivered – provider lifecycle (via webhooks)
#   rejected / failed / cancelled / refunded – terminal outcomes
ORDER_STATES = ("created", "payment_initiated", "paid", "in_review", "awaiting_redo",
                "submitted", "in_production", "shipped", "delivered",
                "declined", "rejected", "failed", "cancelled", "refunded")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def _ensure_column(c: sqlite3.Connection, table: str, col: str, decl: str = "TEXT") -> None:
    """Idempotent ALTER — add a column to an existing table if it's missing."""
    cols = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
    if col not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)
        # migrate older DBs that predate multi-provider fulfilment routing
        _ensure_column(c, "designs", "provider")
        _ensure_column(c, "order_items", "provider")
        # migrate older DBs that predate content moderation / IP gating
        _ensure_column(c, "designs", "moderation_status", "TEXT NOT NULL DEFAULT 'review'")
        _ensure_column(c, "designs", "moderation_reason")
        _ensure_column(c, "designs", "rights_confirmed", "INTEGER NOT NULL DEFAULT 0")
        # magic "fix your design" resume link
        _ensure_column(c, "orders", "resume_token")
        # auth columns (added 2026-06-25)
        _ensure_column(c, "users", "password_hash")
        _ensure_column(c, "users", "reset_token")
        _ensure_column(c, "users", "reset_token_expires", "INTEGER")
        # print-size upsize add-on (large prints cost more — OTC A3 tier, 2026-06-26)
        _ensure_column(c, "order_items", "upsize_fee_cents", "INTEGER NOT NULL DEFAULT 0")
        # payment metadata captured from Paystack on settle/verify (2026-06-26)
        _ensure_column(c, "orders", "paid_at", "INTEGER")
        _ensure_column(c, "orders", "pay_channel")             # card | bank | eft | …
        _ensure_column(c, "orders", "pay_last4")               # card last 4
        _ensure_column(c, "orders", "pay_fees_cents", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(c, "orders", "pay_gateway_response")    # "Successful" / decline reason


def _now() -> int:
    return int(time.time())


# ----------------------------------------------------------------- users --- #
def upsert_user(email: Optional[str], name: Optional[str] = None) -> Optional[int]:
    if not email:
        return None
    with connect() as c:
        cur = c.execute("SELECT id FROM users WHERE email = ?", (email,))
        row = cur.fetchone()
        if row:
            return row["id"]
        cur = c.execute("INSERT INTO users(email, name, created_at) VALUES(?,?,?)",
                        (email, name, _now()))
        return cur.lastrowid


def get_user_by_email(email: str) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def set_password(user_id: int, password_hash: str) -> None:
    with connect() as c:
        c.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))


def set_reset_token(user_id: int, token: str, expires: int) -> None:
    with connect() as c:
        c.execute("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?",
                  (token, expires, user_id))


def get_by_reset_token(token: str) -> Optional[dict]:
    if not token:
        return None
    with connect() as c:
        row = c.execute(
            "SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?",
            (token, _now())).fetchone()
        return dict(row) if row else None


def clear_reset_token(user_id: int) -> None:
    with connect() as c:
        c.execute("UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?",
                  (user_id,))


def get_user_orders(user_id: int, limit: int = 20) -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT reference FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit)).fetchall()
    return [o for o in (get_order(r["reference"]) for r in rows) if o]


# ------------------------------------------------------------ addresses --- #
def save_address(user_id: int, name: str, line1: str, line2: str,
                 city: str, province: str, postal_code: str,
                 country: str = "ZA", is_default: bool = False) -> int:
    with connect() as c:
        if is_default:
            c.execute("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (user_id,))
        cur = c.execute(
            """INSERT INTO addresses(user_id, name, line1, line2, city, province,
               postal_code, country, is_default, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (user_id, name, line1, line2, city, province, postal_code,
             country, 1 if is_default else 0, _now()))
        return cur.lastrowid


def list_addresses(user_id: int) -> list[dict]:
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
            (user_id,)).fetchall()
        return [dict(r) for r in rows]


def delete_address(address_id: int, user_id: int) -> bool:
    with connect() as c:
        cur = c.execute("DELETE FROM addresses WHERE id = ? AND user_id = ?",
                        (address_id, user_id))
        return cur.rowcount > 0


# --------------------------------------------------------------- designs --- #
def create_design(**f: Any) -> dict:
    token = secrets.token_hex(8)
    placement = f.get("placement")
    if isinstance(placement, (dict, list)):
        placement = json.dumps(placement)
    with connect() as c:
        cur = c.execute(
            """INSERT INTO designs
               (token, user_id, product_slug, provider, gelato_uid, color, color_code,
                size, size_code, art_key, placement, printfile_front_url,
                printfile_back_url, preview_url, moderation_status, moderation_reason,
                rights_confirmed, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (token, f.get("user_id"), f.get("product_slug"), f.get("provider"),
             f.get("gelato_uid"), f.get("color"), f.get("color_code"), f.get("size"),
             f.get("size_code"), f.get("art_key"), placement, f.get("printfile_front_url"),
             f.get("printfile_back_url"), f.get("preview_url"),
             f.get("moderation_status", "review"), f.get("moderation_reason"),
             1 if f.get("rights_confirmed") else 0, _now()))
        row = c.execute("SELECT * FROM designs WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def get_design_by_id(design_id: int) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM designs WHERE id = ?", (design_id,)).fetchone()
        return dict(row) if row else None


def get_design(token: str) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM designs WHERE token = ?", (token,)).fetchone()
        return dict(row) if row else None


def set_moderation(token: str, status: str, reason: Optional[str] = None) -> bool:
    """Admin approve/reject a design. status in moderation.STATUSES."""
    with connect() as c:
        cur = c.execute(
            "UPDATE designs SET moderation_status = ?, moderation_reason = ? WHERE token = ?",
            (status, reason, token))
        return cur.rowcount > 0


def list_moderation(status: str = "review", limit: int = 200) -> list[dict]:
    """Designs at a given moderation status (newest first) — powers the review queue."""
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM designs WHERE moderation_status = ? ORDER BY created_at DESC LIMIT ?",
            (status, limit)).fetchall()
        return [dict(r) for r in rows]


def save_design_for_user(user_id: int, design_id: int, name: Optional[str]) -> int:
    with connect() as c:
        cur = c.execute(
            "INSERT INTO saved_designs(user_id, design_id, name, created_at) VALUES(?,?,?,?)",
            (user_id, design_id, name, _now()))
        return cur.lastrowid


def list_saved_designs(user_id: int) -> list[dict]:
    with connect() as c:
        rows = c.execute(
            """SELECT d.*, s.name AS saved_name, s.created_at AS saved_at
               FROM saved_designs s JOIN designs d ON d.id = s.design_id
               WHERE s.user_id = ? ORDER BY s.created_at DESC""", (user_id,)).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------- orders --- #
def create_order(user_id: Optional[int], items: list[dict],
                 currency: str = "ZAR", shipping: int = 0,
                 shipping_json: Optional[dict] = None) -> dict:
    """items: [{design_id, gelato_uid, quantity, unit_price(cents),
               printfile_front_url, printfile_back_url}]"""
    subtotal = sum((int(i.get("unit_price", 0)) + int(i.get("upsize_fee", 0)))
                   * int(i.get("quantity", 1)) for i in items)
    total = subtotal + int(shipping)
    ts = _now()
    resume_token = secrets.token_urlsafe(24)   # the magic-link key for design redos
    with connect() as c:
        cur = c.execute(
            """INSERT INTO orders(reference, resume_token, user_id, status, currency, subtotal,
                                  shipping, total, shipping_json, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            ("PENDING", resume_token, user_id, "created", currency, subtotal, int(shipping),
             total, json.dumps(shipping_json) if shipping_json else None, ts, ts))
        oid = cur.lastrowid
        reference = f"YDS-{ts}-{oid}"
        c.execute("UPDATE orders SET reference = ? WHERE id = ?", (reference, oid))
        for i in items:
            c.execute(
                """INSERT INTO order_items(order_id, design_id, provider, gelato_uid,
                                           quantity, unit_price, upsize_fee_cents,
                                           printfile_front_url, printfile_back_url)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (oid, i.get("design_id"), i.get("provider"), i.get("gelato_uid"),
                 int(i.get("quantity", 1)), int(i.get("unit_price", 0)),
                 int(i.get("upsize_fee", 0)),
                 i.get("printfile_front_url"), i.get("printfile_back_url")))
        c.execute("""INSERT INTO order_events(order_id, reference, event, detail, amount_cents, created_at)
                     VALUES (?,?,?,?,?,?)""",
                  (oid, reference, "created", f"{len(items)} item(s)", total, ts))
    return get_order(reference)


def get_order(reference: str) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM orders WHERE reference = ?", (reference,)).fetchone()
        if not row:
            return None
        order = dict(row)
        # customer email (guest checkout upserts a user keyed by email)
        order["email"] = None
        if order.get("user_id"):
            u = c.execute("SELECT email, name FROM users WHERE id = ?", (order["user_id"],)).fetchone()
            if u:
                order["email"], order["name"] = u["email"], u["name"]
        # items enriched with the linked design's preview / moderation / slug
        items = c.execute(
            """SELECT oi.*, d.token AS design_token, d.product_slug, d.preview_url,
                      d.moderation_status, d.moderation_reason, d.rights_confirmed,
                      d.art_key, d.color, d.color_code, d.size, d.size_code
               FROM order_items oi LEFT JOIN designs d ON d.id = oi.design_id
               WHERE oi.order_id = ?""", (order["id"],)).fetchall()
        order["items"] = [dict(i) for i in items]
        return order


def list_orders(statuses: Optional[list[str]] = None, limit: int = 100) -> list[dict]:
    """Admin queue: orders (newest first), optionally filtered to given statuses."""
    with connect() as c:
        if statuses:
            q = ",".join("?" * len(statuses))
            rows = c.execute(
                f"SELECT reference FROM orders WHERE status IN ({q}) "
                f"ORDER BY created_at DESC LIMIT ?", (*statuses, limit)).fetchall()
        else:
            rows = c.execute(
                "SELECT reference FROM orders ORDER BY created_at DESC LIMIT ?",
                (limit,)).fetchall()
    return [o for o in (get_order(r["reference"]) for r in rows) if o]


def update_order_item(item_id: int, **fields: Any) -> bool:
    """Swap a line item's design/print files in place (used by the resume flow)."""
    allowed = ("design_id", "provider", "gelato_uid",
               "printfile_front_url", "printfile_back_url")
    sets, vals = [], []
    for k in allowed:
        if k in fields:
            sets.append(f"{k} = ?"); vals.append(fields[k])
    if not sets:
        return False
    vals.append(item_id)
    with connect() as c:
        cur = c.execute(f"UPDATE order_items SET {', '.join(sets)} WHERE id = ?", vals)
        return cur.rowcount > 0


def get_order_by_resume_token(token: str) -> Optional[dict]:
    """Resolve the magic 'fix your design' link back to its order."""
    if not token:
        return None
    with connect() as c:
        row = c.execute("SELECT reference FROM orders WHERE resume_token = ?", (token,)).fetchone()
    return get_order(row["reference"]) if row else None


def get_order_by_provider_id(provider_order_id: str) -> Optional[dict]:
    """Find an order by the fulfilment provider's order id (e.g. a Gooten Id).
    Stored in gelato_order_id, which now holds whichever provider fulfilled it."""
    with connect() as c:
        row = c.execute("SELECT reference FROM orders WHERE gelato_order_id = ?",
                        (provider_order_id,)).fetchone()
    return get_order(row["reference"]) if row else None


def set_order_status(reference: str, status: str,
                     gelato_order_id: Optional[str] = None,
                     tracking_url: Optional[str] = None,
                     notes: Optional[str] = None) -> bool:
    if status not in ORDER_STATES:
        raise ValueError(f"Unknown order status: {status}")
    sets, vals = ["status = ?", "updated_at = ?"], [status, _now()]
    if gelato_order_id is not None:
        sets.append("gelato_order_id = ?"); vals.append(gelato_order_id)
    if tracking_url is not None:
        sets.append("tracking_url = ?"); vals.append(tracking_url)
    if notes is not None:
        sets.append("notes = ?"); vals.append(notes)
    vals.append(reference)
    with connect() as c:
        cur = c.execute(f"UPDATE orders SET {', '.join(sets)} WHERE reference = ?", vals)
        # audit trail: log every status transition with its timestamp + note
        row = c.execute("SELECT id FROM orders WHERE reference = ?", (reference,)).fetchone()
        if row:
            c.execute("""INSERT INTO order_events(order_id, reference, event, detail, created_at)
                         VALUES (?,?,?,?,?)""",
                      (row["id"], reference, status, notes, _now()))
        return cur.rowcount > 0


def add_order_event(reference: str, event: str, detail: Optional[str] = None,
                    amount_cents: Optional[int] = None) -> None:
    """Append an arbitrary lifecycle event (payment_initiated, declined, …)."""
    with connect() as c:
        row = c.execute("SELECT id FROM orders WHERE reference = ?", (reference,)).fetchone()
        if not row:
            return
        c.execute("""INSERT INTO order_events(order_id, reference, event, detail, amount_cents, created_at)
                     VALUES (?,?,?,?,?,?)""",
                  (row["id"], reference, event, detail, amount_cents, _now()))


def get_order_events(reference: str) -> list[dict]:
    """Full start-to-finish timeline for one order, oldest first."""
    with connect() as c:
        rows = c.execute(
            "SELECT * FROM order_events WHERE reference = ? ORDER BY created_at ASC, id ASC",
            (reference,)).fetchall()
    return [dict(r) for r in rows]


def set_payment_meta(reference: str, *, paid_at: Optional[int] = None,
                     channel: Optional[str] = None, last4: Optional[str] = None,
                     fees_cents: Optional[int] = None,
                     gateway_response: Optional[str] = None) -> None:
    """Store Paystack payment details captured on settle/verify."""
    sets, vals = [], []
    if paid_at is not None:           sets.append("paid_at = ?"); vals.append(int(paid_at))
    if channel is not None:           sets.append("pay_channel = ?"); vals.append(channel)
    if last4 is not None:             sets.append("pay_last4 = ?"); vals.append(last4)
    if fees_cents is not None:        sets.append("pay_fees_cents = ?"); vals.append(int(fees_cents))
    if gateway_response is not None:  sets.append("pay_gateway_response = ?"); vals.append(gateway_response)
    if not sets:
        return
    vals.append(reference)
    with connect() as c:
        c.execute(f"UPDATE orders SET {', '.join(sets)} WHERE reference = ?", vals)


# ----------------------------------------------------------- analytics --- #
# Statuses that represent a successful (paid) order, for revenue/conversion.
PAID_STATUSES = ("paid", "in_review", "awaiting_redo", "submitted",
                 "in_production", "shipped", "delivered")


def dashboard_stats(days: int = 14) -> dict:
    """Everything the admin dashboards render: KPIs, a daily orders+revenue
    series, status funnel, best-sellers, payment-channel mix, customer
    locations and the latest activity — all from real order data."""
    now = _now()
    since = now - days * 86400
    paid_q = ",".join("?" * len(PAID_STATUSES))
    with connect() as c:
        status_counts = {r["status"]: r["n"]
                         for r in c.execute("SELECT status, COUNT(*) n FROM orders GROUP BY status")}
        total_orders = sum(status_counts.values())
        paid_count = c.execute(
            f"SELECT COUNT(*) n FROM orders WHERE status IN ({paid_q})", PAID_STATUSES).fetchone()["n"]
        revenue = c.execute(
            f"SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN ({paid_q})", PAID_STATUSES).fetchone()["s"]
        fees = c.execute(
            f"SELECT COALESCE(SUM(pay_fees_cents),0) s FROM orders WHERE status IN ({paid_q})", PAID_STATUSES).fetchone()["s"]
        declined = status_counts.get("declined", 0) + status_counts.get("failed", 0)

        def _rev_since(ts):
            return c.execute(
                f"SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM orders "
                f"WHERE status IN ({paid_q}) AND created_at >= ?", (*PAID_STATUSES, ts)).fetchone()
        r7, r30 = _rev_since(now - 7 * 86400), _rev_since(now - 30 * 86400)

        # daily series (orders + paid revenue) for the window
        rows = c.execute(
            f"""SELECT date(created_at,'unixepoch') d, COUNT(*) orders,
                       COALESCE(SUM(CASE WHEN status IN ({paid_q}) THEN total ELSE 0 END),0) revenue
                FROM orders WHERE created_at >= ? GROUP BY d ORDER BY d""",
            (*PAID_STATUSES, since)).fetchall()
        by_day = {r["d"]: dict(r) for r in rows}
        series = []
        for i in range(days, -1, -1):
            day = time.strftime("%Y-%m-%d", time.gmtime(now - i * 86400))
            rec = by_day.get(day)
            series.append({"day": day, "orders": rec["orders"] if rec else 0,
                           "revenue": rec["revenue"] if rec else 0})

        # best-selling products (paid orders)
        best = c.execute(
            f"""SELECT d.product_slug slug, COALESCE(SUM(oi.quantity),0) qty,
                       COALESCE(SUM(oi.quantity*oi.unit_price),0) revenue
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
                LEFT JOIN designs d ON d.id = oi.design_id
                WHERE o.status IN ({paid_q})
                GROUP BY d.product_slug ORDER BY qty DESC LIMIT 6""", PAID_STATUSES).fetchall()

        # payment-channel mix
        channels = [dict(r) for r in c.execute(
            f"""SELECT COALESCE(pay_channel,'—') channel, COUNT(*) n
                FROM orders WHERE status IN ({paid_q}) GROUP BY pay_channel ORDER BY n DESC""",
            PAID_STATUSES).fetchall()]

        # customer locations (province) from shipping_json on paid orders
        loc_rows = c.execute(
            f"SELECT shipping_json FROM orders WHERE status IN ({paid_q}) AND shipping_json IS NOT NULL",
            PAID_STATUSES).fetchall()
        locations: dict[str, int] = {}
        for r in loc_rows:
            try:
                addr = json.loads(r["shipping_json"] or "{}") or {}
            except (ValueError, TypeError):
                addr = {}
            key = (addr.get("province") or addr.get("city") or "Unknown").strip() or "Unknown"
            locations[key] = locations.get(key, 0) + 1

        recent_events = [dict(r) for r in c.execute(
            "SELECT * FROM order_events ORDER BY created_at DESC, id DESC LIMIT 20").fetchall()]

    aov = round(revenue / paid_count) if paid_count else 0
    conversion = round(100 * paid_count / total_orders, 1) if total_orders else 0.0
    decline_rate = round(100 * declined / (declined + paid_count), 1) if (declined + paid_count) else 0.0
    return {
        "revenue": revenue, "revenue_7d": r7["s"], "revenue_30d": r30["s"],
        "orders_total": total_orders, "orders_paid": paid_count, "orders_7d": r7["n"],
        "declined": declined, "aov": aov, "conversion": conversion,
        "decline_rate": decline_rate, "fees": fees,
        "status_counts": status_counts, "series": series, "best_sellers": [dict(b) for b in best],
        "channels": channels, "locations": sorted(locations.items(), key=lambda kv: -kv[1]),
        "recent_events": recent_events,
    }
