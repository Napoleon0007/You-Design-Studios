-- Consolidated final schema, ported from db.py's SCHEMA + all historical
-- _ensure_column migrations. D1 starts clean, so this is written as one
-- final-state migration rather than replaying each historical ALTER TABLE —
-- there's no existing D1 database to migrate incrementally.

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
  provider      TEXT,
  gelato_uid    TEXT,
  color         TEXT,
  color_code    TEXT,
  size          TEXT,
  size_code     TEXT,
  art_key       TEXT,
  placement     TEXT,
  printfile_front_url TEXT,
  printfile_back_url  TEXT,
  preview_url   TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'review',
  moderation_reason TEXT,
  rights_confirmed  INTEGER NOT NULL DEFAULT 0,
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
  resume_token    TEXT,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'created',
  currency        TEXT NOT NULL DEFAULT 'ZAR',
  subtotal        INTEGER NOT NULL DEFAULT 0,
  shipping        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  shipping_json   TEXT,
  gelato_order_id TEXT,
  tracking_url    TEXT,
  notes           TEXT,
  paid_at             INTEGER,
  pay_channel         TEXT,
  pay_last4           TEXT,
  pay_fees_cents      INTEGER NOT NULL DEFAULT 0,
  pay_gateway_response TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  design_id   INTEGER REFERENCES designs(id) ON DELETE SET NULL,
  provider    TEXT,
  gelato_uid  TEXT,
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  INTEGER NOT NULL DEFAULT 0,
  upsize_fee_cents INTEGER NOT NULL DEFAULT 0,
  printfile_front_url TEXT,
  printfile_back_url  TEXT
);

-- Immutable audit trail: one row per lifecycle event (created, payment_initiated,
-- paid, declined, released, shipped, refunded, status changes).
CREATE TABLE IF NOT EXISTS order_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  reference    TEXT,
  event        TEXT NOT NULL,
  detail       TEXT,
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
