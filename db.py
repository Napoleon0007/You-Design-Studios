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
  gelato_uid    TEXT,
  color         TEXT,
  color_code    TEXT,
  size          TEXT,
  size_code     TEXT,
  art_key       TEXT,
  placement     TEXT,                 -- JSON {scale,cx,cy,rotation} per side
  printfile_front_url TEXT,
  printfile_back_url  TEXT,
  preview_url   TEXT,
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
  gelato_uid  TEXT,
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
ORDER_STATES = ("created", "paid", "submitted", "in_production",
                "shipped", "delivered", "rejected", "failed", "cancelled")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)


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
               (token, user_id, product_slug, gelato_uid, color, color_code,
                size, size_code, art_key, placement, printfile_front_url,
                printfile_back_url, preview_url, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (token, f.get("user_id"), f.get("product_slug"), f.get("gelato_uid"),
             f.get("color"), f.get("color_code"), f.get("size"), f.get("size_code"),
             f.get("art_key"), placement, f.get("printfile_front_url"),
             f.get("printfile_back_url"), f.get("preview_url"), _now()))
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
    with connect() as c:
        cur = c.execute(
            """INSERT INTO orders(reference, user_id, status, currency, subtotal,
                                  shipping, total, shipping_json, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("PENDING", user_id, "created", currency, subtotal, int(shipping), total,
             json.dumps(shipping_json) if shipping_json else None, ts, ts))
        oid = cur.lastrowid
        reference = f"YDS-{ts}-{oid}"
        c.execute("UPDATE orders SET reference = ? WHERE id = ?", (reference, oid))
        for i in items:
            c.execute(
                """INSERT INTO order_items(order_id, design_id, gelato_uid, quantity,
                                           unit_price, printfile_front_url, printfile_back_url)
                   VALUES (?,?,?,?,?,?,?)""",
                (oid, i.get("design_id"), i.get("gelato_uid"), int(i.get("quantity", 1)),
                 int(i.get("unit_price", 0)), i.get("printfile_front_url"),
                 i.get("printfile_back_url")))
    return get_order(reference)


def get_order(reference: str) -> Optional[dict]:
    with connect() as c:
        row = c.execute("SELECT * FROM orders WHERE reference = ?", (reference,)).fetchone()
        if not row:
            return None
        order = dict(row)
        items = c.execute("SELECT * FROM order_items WHERE order_id = ?", (order["id"],)).fetchall()
        order["items"] = [dict(i) for i in items]
        return order


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
