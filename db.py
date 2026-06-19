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
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT UNIQUE,
  name        TEXT,
  created_at  INTEGER NOT NULL
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
  printfile_front_url TEXT,
  printfile_back_url  TEXT
);

CREATE INDEX IF NOT EXISTS idx_designs_user  ON designs(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user   ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_items_order   ON order_items(order_id);
"""

# valid order states (the fulfillment state machine)
#   created     – order persisted, not yet paid
#   paid        – Paystack payment confirmed (money captured; settles to bank ~T+2)
#   in_review   – paid but HELD: a design awaits moderation approval (our "escrow")
#   awaiting_redo – a design was rejected; customer invited to upload a compliant one
#   submitted   – released to the fulfilment provider (Gelato/…)
#   in_production / shipped / delivered – provider lifecycle (via webhooks)
#   rejected / failed / cancelled / refunded – terminal outcomes
ORDER_STATES = ("created", "paid", "in_review", "awaiting_redo", "submitted",
                "in_production", "shipped", "delivered",
                "rejected", "failed", "cancelled", "refunded")


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
    subtotal = sum(int(i.get("unit_price", 0)) * int(i.get("quantity", 1)) for i in items)
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
                                           quantity, unit_price, printfile_front_url,
                                           printfile_back_url)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (oid, i.get("design_id"), i.get("provider"), i.get("gelato_uid"),
                 int(i.get("quantity", 1)), int(i.get("unit_price", 0)),
                 i.get("printfile_front_url"), i.get("printfile_back_url")))
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
        return cur.rowcount > 0
