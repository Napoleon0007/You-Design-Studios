/**
 * db.ts — data-access layer, ported 1:1 from db.py's raw-sqlite3 functions to
 * D1's async prepared-statement API. Same schema (migrations/0001_init.sql),
 * same function shapes and behavior.
 */

export interface User {
  id: number;
  email: string | null;
  name: string | null;
  password_hash: string | null;
  reset_token: string | null;
  reset_token_expires: number | null;
  created_at: number;
}

export interface Address {
  id: number;
  user_id: number | null;
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string;
  is_default: number;
  created_at: number;
}

export interface Design {
  id: number;
  token: string;
  user_id: number | null;
  product_slug: string;
  provider: string | null;
  gelato_uid: string | null;
  color: string | null;
  color_code: string | null;
  size: string | null;
  size_code: string | null;
  art_key: string | null;
  placement: string | null;
  printfile_front_url: string | null;
  printfile_back_url: string | null;
  preview_url: string | null;
  moderation_status: string;
  moderation_reason: string | null;
  rights_confirmed: number;
  created_at: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  design_id: number | null;
  provider: string | null;
  gelato_uid: string | null;
  quantity: number;
  unit_price: number;
  upsize_fee_cents: number;
  printfile_front_url: string | null;
  printfile_back_url: string | null;
  // enriched (LEFT JOIN designs) fields present on get_order()'s items:
  design_token?: string | null;
  product_slug?: string | null;
  preview_url?: string | null;
  moderation_status?: string | null;
  moderation_reason?: string | null;
  rights_confirmed?: number | null;
  // route-level enrichment (mirrors app.py's `it["product_name"] = _product_name(...)`):
  product_name?: string;
  art_key?: string | null;
  color?: string | null;
  color_code?: string | null;
  size?: string | null;
  size_code?: string | null;
}

export interface Order {
  id: number;
  reference: string;
  resume_token: string | null;
  user_id: number | null;
  status: string;
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
  shipping_json: string | null;
  gelato_order_id: string | null;
  tracking_url: string | null;
  notes: string | null;
  paid_at: number | null;
  pay_channel: string | null;
  pay_last4: string | null;
  pay_fees_cents: number;
  pay_gateway_response: string | null;
  created_at: number;
  updated_at: number;
  // enriched on get_order():
  email?: string | null;
  name?: string | null;
  items?: OrderItem[];
}

export interface OrderEvent {
  id: number;
  order_id: number;
  reference: string | null;
  event: string;
  detail: string | null;
  amount_cents: number | null;
  created_at: number;
}

// valid order states (the fulfillment state machine) — mirrors db.py's ORDER_STATES
export const ORDER_STATES = [
  "created",
  "payment_initiated",
  "paid",
  "in_review",
  "awaiting_redo",
  "submitted",
  "in_production",
  "shipped",
  "delivered",
  "declined",
  "rejected",
  "failed",
  "cancelled",
  "refunded",
] as const;

// Statuses that represent a successful (paid) order, for revenue/conversion.
export const PAID_STATUSES = [
  "paid",
  "in_review",
  "awaiting_redo",
  "submitted",
  "in_production",
  "shipped",
  "delivered",
] as const;

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomUrlSafe(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ----------------------------------------------------------------- users --- //
export async function upsertUser(db: D1Database, email: string | null, name?: string | null): Promise<number | null> {
  if (!email) return null;
  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: number }>();
  if (existing) return existing.id;
  const res = await db
    .prepare("INSERT INTO users(email, name, created_at) VALUES(?,?,?)")
    .bind(email, name ?? null, now())
    .run();
  return res.meta.last_row_id;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<User>();
  return row ?? null;
}

export async function getUserById(db: D1Database, userId: number): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<User>();
  return row ?? null;
}

export async function setPassword(db: D1Database, userId: number, passwordHash: string): Promise<void> {
  await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(passwordHash, userId).run();
}

export async function setResetToken(db: D1Database, userId: number, token: string, expires: number): Promise<void> {
  await db
    .prepare("UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?")
    .bind(token, expires, userId)
    .run();
}

export async function getByResetToken(db: D1Database, token: string): Promise<User | null> {
  if (!token) return null;
  const row = await db
    .prepare("SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?")
    .bind(token, now())
    .first<User>();
  return row ?? null;
}

export async function clearResetToken(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = ?")
    .bind(userId)
    .run();
}

export async function getUserOrders(db: D1Database, userId: number, limit: number = 20): Promise<Order[]> {
  const { results } = await db
    .prepare("SELECT reference FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<{ reference: string }>();
  const orders: Order[] = [];
  for (const r of results) {
    const o = await getOrder(db, r.reference);
    if (o) orders.push(o);
  }
  return orders;
}

// ------------------------------------------------------------ addresses --- //
export async function saveAddress(
  db: D1Database,
  userId: number,
  name: string,
  line1: string,
  line2: string,
  city: string,
  province: string,
  postalCode: string,
  country: string = "ZA",
  isDefault: boolean = false
): Promise<number> {
  if (isDefault) {
    await db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").bind(userId).run();
  }
  const res = await db
    .prepare(
      `INSERT INTO addresses(user_id, name, line1, line2, city, province,
         postal_code, country, is_default, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(userId, name, line1, line2, city, province, postalCode, country, isDefault ? 1 : 0, now())
    .run();
  return res.meta.last_row_id;
}

export async function listAddresses(db: D1Database, userId: number): Promise<Address[]> {
  const { results } = await db
    .prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC")
    .bind(userId)
    .all<Address>();
  return results;
}

export async function deleteAddress(db: D1Database, addressId: number, userId: number): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?")
    .bind(addressId, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// --------------------------------------------------------------- designs --- //
export interface CreateDesignFields {
  user_id?: number | null;
  product_slug: string;
  provider?: string | null;
  gelato_uid?: string | null;
  color?: string | null;
  color_code?: string | null;
  size?: string | null;
  size_code?: string | null;
  art_key?: string | null;
  placement?: unknown;
  printfile_front_url?: string | null;
  printfile_back_url?: string | null;
  preview_url?: string | null;
  moderation_status?: string;
  moderation_reason?: string | null;
  rights_confirmed?: boolean;
}

export async function createDesign(db: D1Database, f: CreateDesignFields): Promise<Design> {
  const token = randomHex(8);
  let placement: string | null = null;
  if (f.placement !== undefined && f.placement !== null) {
    placement = typeof f.placement === "string" ? f.placement : JSON.stringify(f.placement);
  }
  const res = await db
    .prepare(
      `INSERT INTO designs
        (token, user_id, product_slug, provider, gelato_uid, color, color_code,
         size, size_code, art_key, placement, printfile_front_url,
         printfile_back_url, preview_url, moderation_status, moderation_reason,
         rights_confirmed, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      token,
      f.user_id ?? null,
      f.product_slug,
      f.provider ?? null,
      f.gelato_uid ?? null,
      f.color ?? null,
      f.color_code ?? null,
      f.size ?? null,
      f.size_code ?? null,
      f.art_key ?? null,
      placement,
      f.printfile_front_url ?? null,
      f.printfile_back_url ?? null,
      f.preview_url ?? null,
      f.moderation_status ?? "review",
      f.moderation_reason ?? null,
      f.rights_confirmed ? 1 : 0,
      now()
    )
    .run();
  const row = await db.prepare("SELECT * FROM designs WHERE id = ?").bind(res.meta.last_row_id).first<Design>();
  return row as Design;
}

export async function getDesignById(db: D1Database, designId: number): Promise<Design | null> {
  const row = await db.prepare("SELECT * FROM designs WHERE id = ?").bind(designId).first<Design>();
  return row ?? null;
}

export async function getDesign(db: D1Database, token: string): Promise<Design | null> {
  const row = await db.prepare("SELECT * FROM designs WHERE token = ?").bind(token).first<Design>();
  return row ?? null;
}

/** Admin approve/reject a design. status in moderation.STATUSES. */
export async function setModeration(
  db: D1Database,
  token: string,
  status: string,
  reason?: string | null
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE designs SET moderation_status = ?, moderation_reason = ? WHERE token = ?")
    .bind(status, reason ?? null, token)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Designs at a given moderation status (newest first) — powers the review queue. */
export async function listModeration(db: D1Database, status: string = "review", limit: number = 200): Promise<Design[]> {
  const { results } = await db
    .prepare("SELECT * FROM designs WHERE moderation_status = ? ORDER BY created_at DESC LIMIT ?")
    .bind(status, limit)
    .all<Design>();
  return results;
}

export async function saveDesignForUser(
  db: D1Database,
  userId: number,
  designId: number,
  name: string | null
): Promise<number> {
  const res = await db
    .prepare("INSERT INTO saved_designs(user_id, design_id, name, created_at) VALUES(?,?,?,?)")
    .bind(userId, designId, name, now())
    .run();
  return res.meta.last_row_id;
}

export async function listSavedDesigns(db: D1Database, userId: number): Promise<(Design & { saved_name: string | null; saved_at: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT d.*, s.name AS saved_name, s.created_at AS saved_at
       FROM saved_designs s JOIN designs d ON d.id = s.design_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`
    )
    .bind(userId)
    .all<Design & { saved_name: string | null; saved_at: number }>();
  return results;
}

// ---------------------------------------------------------------- orders --- //
export interface CreateOrderItemInput {
  design_id?: number | null;
  provider?: string | null;
  gelato_uid?: string | null;
  quantity?: number;
  unit_price?: number;
  upsize_fee?: number;
  printfile_front_url?: string | null;
  printfile_back_url?: string | null;
}

/** items: [{design_id, gelato_uid, quantity, unit_price(cents), printfile_front_url, printfile_back_url}] */
export async function createOrder(
  db: D1Database,
  userId: number | null,
  items: CreateOrderItemInput[],
  currency: string = "ZAR",
  shippingCents: number = 0,
  shippingJson?: unknown
): Promise<Order | null> {
  const subtotal = items.reduce(
    (sum, i) => sum + (Number(i.unit_price ?? 0) + Number(i.upsize_fee ?? 0)) * Math.max(1, Number(i.quantity ?? 1)),
    0
  );
  const total = subtotal + Number(shippingCents);
  const ts = now();
  const resumeToken = randomUrlSafe(24); // the magic-link key for design redos

  // Step 1: insert with a placeholder reference to get the autoincrement id
  // (mirrors db.py: the id must exist before the reference string can be built).
  const insertRes = await db
    .prepare(
      `INSERT INTO orders(reference, resume_token, user_id, status, currency, subtotal,
                          shipping, total, shipping_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      "PENDING",
      resumeToken,
      userId,
      "created",
      currency,
      subtotal,
      Math.round(shippingCents),
      total,
      shippingJson ? JSON.stringify(shippingJson) : null,
      ts,
      ts
    )
    .run();
  const oid = insertRes.meta.last_row_id;
  const reference = `YDS-${ts}-${oid}`;

  // Step 2: finalize reference + insert items + audit event atomically.
  const statements = [
    db.prepare("UPDATE orders SET reference = ? WHERE id = ?").bind(reference, oid),
    ...items.map((i) =>
      db
        .prepare(
          `INSERT INTO order_items(order_id, design_id, provider, gelato_uid,
                                   quantity, unit_price, upsize_fee_cents,
                                   printfile_front_url, printfile_back_url)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .bind(
          oid,
          i.design_id ?? null,
          i.provider ?? null,
          i.gelato_uid ?? null,
          Math.max(1, Number(i.quantity ?? 1)),
          Math.round(Number(i.unit_price ?? 0)),
          Math.round(Number(i.upsize_fee ?? 0)),
          i.printfile_front_url ?? null,
          i.printfile_back_url ?? null
        )
    ),
    db
      .prepare(
        `INSERT INTO order_events(order_id, reference, event, detail, amount_cents, created_at)
         VALUES (?,?,?,?,?,?)`
      )
      .bind(oid, reference, "created", `${items.length} item(s)`, total, ts),
  ];
  await db.batch(statements);

  return getOrder(db, reference);
}

export async function getOrder(db: D1Database, reference: string): Promise<Order | null> {
  const row = await db.prepare("SELECT * FROM orders WHERE reference = ?").bind(reference).first<Order>();
  if (!row) return null;
  const order: Order = { ...row, email: null };
  if (order.user_id) {
    const u = await db
      .prepare("SELECT email, name FROM users WHERE id = ?")
      .bind(order.user_id)
      .first<{ email: string | null; name: string | null }>();
    if (u) {
      order.email = u.email;
      order.name = u.name;
    }
  }
  const { results: items } = await db
    .prepare(
      `SELECT oi.*, d.token AS design_token, d.product_slug, d.preview_url,
              d.moderation_status, d.moderation_reason, d.rights_confirmed,
              d.art_key, d.color, d.color_code, d.size, d.size_code
       FROM order_items oi LEFT JOIN designs d ON d.id = oi.design_id
       WHERE oi.order_id = ?`
    )
    .bind(order.id)
    .all<OrderItem>();
  order.items = items;
  return order;
}

/** Admin queue: orders (newest first), optionally filtered to given statuses. */
export async function listOrders(db: D1Database, statuses?: readonly string[], limit: number = 100): Promise<Order[]> {
  let refs: { reference: string }[];
  if (statuses && statuses.length) {
    const q = statuses.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT reference FROM orders WHERE status IN (${q}) ORDER BY created_at DESC LIMIT ?`)
      .bind(...statuses, limit)
      .all<{ reference: string }>();
    refs = results;
  } else {
    const { results } = await db
      .prepare("SELECT reference FROM orders ORDER BY created_at DESC LIMIT ?")
      .bind(limit)
      .all<{ reference: string }>();
    refs = results;
  }
  const orders: Order[] = [];
  for (const r of refs) {
    const o = await getOrder(db, r.reference);
    if (o) orders.push(o);
  }
  return orders;
}

const UPDATE_ORDER_ITEM_ALLOWED = [
  "design_id",
  "provider",
  "gelato_uid",
  "printfile_front_url",
  "printfile_back_url",
] as const;

/** Swap a line item's design/print files in place (used by the resume flow). */
export async function updateOrderItem(
  db: D1Database,
  itemId: number,
  fields: Partial<Record<(typeof UPDATE_ORDER_ITEM_ALLOWED)[number], unknown>>
): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of UPDATE_ORDER_ITEM_ALLOWED) {
    if (k in fields) {
      sets.push(`${k} = ?`);
      vals.push(fields[k]);
    }
  }
  if (!sets.length) return false;
  vals.push(itemId);
  const res = await db
    .prepare(`UPDATE order_items SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...vals)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

/** Resolve the magic 'fix your design' link back to its order. */
export async function getOrderByResumeToken(db: D1Database, token: string): Promise<Order | null> {
  if (!token) return null;
  const row = await db.prepare("SELECT reference FROM orders WHERE resume_token = ?").bind(token).first<{ reference: string }>();
  return row ? getOrder(db, row.reference) : null;
}

/** Find an order by the fulfilment provider's order id. Stored in gelato_order_id,
 * which now holds whichever provider fulfilled it. */
export async function getOrderByProviderId(db: D1Database, providerOrderId: string): Promise<Order | null> {
  const row = await db
    .prepare("SELECT reference FROM orders WHERE gelato_order_id = ?")
    .bind(providerOrderId)
    .first<{ reference: string }>();
  return row ? getOrder(db, row.reference) : null;
}

export async function setOrderStatus(
  db: D1Database,
  reference: string,
  status: string,
  opts?: { gelatoOrderId?: string; trackingUrl?: string; notes?: string }
): Promise<boolean> {
  if (!(ORDER_STATES as readonly string[]).includes(status)) {
    throw new Error(`Unknown order status: ${status}`);
  }
  const sets: string[] = ["status = ?", "updated_at = ?"];
  const vals: unknown[] = [status, now()];
  if (opts?.gelatoOrderId !== undefined) {
    sets.push("gelato_order_id = ?");
    vals.push(opts.gelatoOrderId);
  }
  if (opts?.trackingUrl !== undefined) {
    sets.push("tracking_url = ?");
    vals.push(opts.trackingUrl);
  }
  if (opts?.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(opts.notes);
  }
  vals.push(reference);
  const res = await db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE reference = ?`).bind(...vals).run();
  // audit trail: log every status transition with its timestamp + note
  const row = await db.prepare("SELECT id FROM orders WHERE reference = ?").bind(reference).first<{ id: number }>();
  if (row) {
    await db
      .prepare(`INSERT INTO order_events(order_id, reference, event, detail, created_at) VALUES (?,?,?,?,?)`)
      .bind(row.id, reference, status, opts?.notes ?? null, now())
      .run();
  }
  return (res.meta.changes ?? 0) > 0;
}

/** Append an arbitrary lifecycle event (payment_initiated, declined, …). */
export async function addOrderEvent(
  db: D1Database,
  reference: string,
  event: string,
  detail?: string | null,
  amountCents?: number | null
): Promise<void> {
  const row = await db.prepare("SELECT id FROM orders WHERE reference = ?").bind(reference).first<{ id: number }>();
  if (!row) return;
  await db
    .prepare(
      `INSERT INTO order_events(order_id, reference, event, detail, amount_cents, created_at) VALUES (?,?,?,?,?,?)`
    )
    .bind(row.id, reference, event, detail ?? null, amountCents ?? null, now())
    .run();
}

/** Full start-to-finish timeline for one order, oldest first. */
export async function getOrderEvents(db: D1Database, reference: string): Promise<OrderEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM order_events WHERE reference = ? ORDER BY created_at ASC, id ASC")
    .bind(reference)
    .all<OrderEvent>();
  return results;
}

/** Store Paystack payment details captured on settle/verify. */
export async function setPaymentMeta(
  db: D1Database,
  reference: string,
  opts: {
    paidAt?: number;
    channel?: string;
    last4?: string;
    feesCents?: number;
    gatewayResponse?: string;
  }
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (opts.paidAt !== undefined) {
    sets.push("paid_at = ?");
    vals.push(Math.round(opts.paidAt));
  }
  if (opts.channel !== undefined) {
    sets.push("pay_channel = ?");
    vals.push(opts.channel);
  }
  if (opts.last4 !== undefined) {
    sets.push("pay_last4 = ?");
    vals.push(opts.last4);
  }
  if (opts.feesCents !== undefined) {
    sets.push("pay_fees_cents = ?");
    vals.push(Math.round(opts.feesCents));
  }
  if (opts.gatewayResponse !== undefined) {
    sets.push("pay_gateway_response = ?");
    vals.push(opts.gatewayResponse);
  }
  if (!sets.length) return;
  vals.push(reference);
  await db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE reference = ?`).bind(...vals).run();
}

// ----------------------------------------------------------- analytics --- //
export interface DashboardStats {
  revenue: number;
  revenue_7d: number;
  revenue_30d: number;
  orders_total: number;
  orders_paid: number;
  orders_7d: number;
  declined: number;
  aov: number;
  conversion: number;
  decline_rate: number;
  fees: number;
  status_counts: Record<string, number>;
  series: { day: string; orders: number; revenue: number }[];
  best_sellers: { slug: string | null; qty: number; revenue: number }[];
  channels: { channel: string; n: number }[];
  locations: [string, number][];
  recent_events: OrderEvent[];
}

/** Everything the admin dashboards render: KPIs, a daily orders+revenue series,
 * status funnel, best-sellers, payment-channel mix, customer locations and the
 * latest activity — all from real order data. */
export async function dashboardStats(db: D1Database, days: number = 14): Promise<DashboardStats> {
  const nowTs = now();
  const since = nowTs - days * 86400;
  const paidQ = PAID_STATUSES.map(() => "?").join(",");

  const { results: statusRows } = await db
    .prepare("SELECT status, COUNT(*) n FROM orders GROUP BY status")
    .all<{ status: string; n: number }>();
  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r.n;
  const totalOrders = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const paidCountRow = await db
    .prepare(`SELECT COUNT(*) n FROM orders WHERE status IN (${paidQ})`)
    .bind(...PAID_STATUSES)
    .first<{ n: number }>();
  const paidCount = paidCountRow?.n ?? 0;

  const revenueRow = await db
    .prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN (${paidQ})`)
    .bind(...PAID_STATUSES)
    .first<{ s: number }>();
  const revenue = revenueRow?.s ?? 0;

  const feesRow = await db
    .prepare(`SELECT COALESCE(SUM(pay_fees_cents),0) s FROM orders WHERE status IN (${paidQ})`)
    .bind(...PAID_STATUSES)
    .first<{ s: number }>();
  const fees = feesRow?.s ?? 0;

  const declined = (statusCounts["declined"] ?? 0) + (statusCounts["failed"] ?? 0);

  async function revSince(ts: number) {
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(total),0) s, COUNT(*) n FROM orders
         WHERE status IN (${paidQ}) AND created_at >= ?`
      )
      .bind(...PAID_STATUSES, ts)
      .first<{ s: number; n: number }>();
    return row ?? { s: 0, n: 0 };
  }
  const r7 = await revSince(nowTs - 7 * 86400);
  const r30 = await revSince(nowTs - 30 * 86400);

  // daily series (orders + paid revenue) for the window
  const { results: dayRows } = await db
    .prepare(
      `SELECT date(created_at,'unixepoch') d, COUNT(*) orders,
              COALESCE(SUM(CASE WHEN status IN (${paidQ}) THEN total ELSE 0 END),0) revenue
       FROM orders WHERE created_at >= ? GROUP BY d ORDER BY d`
    )
    .bind(...PAID_STATUSES, since)
    .all<{ d: string; orders: number; revenue: number }>();
  const byDay: Record<string, { orders: number; revenue: number }> = {};
  for (const r of dayRows) byDay[r.d] = { orders: r.orders, revenue: r.revenue };
  const series: { day: string; orders: number; revenue: number }[] = [];
  for (let i = days; i >= 0; i--) {
    const day = new Date((nowTs - i * 86400) * 1000).toISOString().slice(0, 10);
    const rec = byDay[day];
    series.push({ day, orders: rec?.orders ?? 0, revenue: rec?.revenue ?? 0 });
  }

  // best-selling products (paid orders)
  const { results: best } = await db
    .prepare(
      `SELECT d.product_slug slug, COALESCE(SUM(oi.quantity),0) qty,
              COALESCE(SUM(oi.quantity*oi.unit_price),0) revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       LEFT JOIN designs d ON d.id = oi.design_id
       WHERE o.status IN (${paidQ})
       GROUP BY d.product_slug ORDER BY qty DESC LIMIT 6`
    )
    .bind(...PAID_STATUSES)
    .all<{ slug: string | null; qty: number; revenue: number }>();

  // payment-channel mix
  const { results: channels } = await db
    .prepare(
      `SELECT COALESCE(pay_channel,'—') channel, COUNT(*) n
       FROM orders WHERE status IN (${paidQ}) GROUP BY pay_channel ORDER BY n DESC`
    )
    .bind(...PAID_STATUSES)
    .all<{ channel: string; n: number }>();

  // customer locations (province) from shipping_json on paid orders
  const { results: locRows } = await db
    .prepare(
      `SELECT shipping_json FROM orders WHERE status IN (${paidQ}) AND shipping_json IS NOT NULL`
    )
    .bind(...PAID_STATUSES)
    .all<{ shipping_json: string }>();
  const locations: Record<string, number> = {};
  for (const r of locRows) {
    let addr: { province?: string; city?: string } = {};
    try {
      addr = JSON.parse(r.shipping_json || "{}") ?? {};
    } catch {
      addr = {};
    }
    const key = (addr.province || addr.city || "Unknown").trim() || "Unknown";
    locations[key] = (locations[key] ?? 0) + 1;
  }

  const { results: recentEvents } = await db
    .prepare("SELECT * FROM order_events ORDER BY created_at DESC, id DESC LIMIT 20")
    .all<OrderEvent>();

  const aov = paidCount ? Math.round(revenue / paidCount) : 0;
  const conversion = totalOrders ? Math.round((100 * paidCount / totalOrders) * 10) / 10 : 0.0;
  const declineRate = declined + paidCount ? Math.round((100 * declined / (declined + paidCount)) * 10) / 10 : 0.0;

  return {
    revenue,
    revenue_7d: r7.s,
    revenue_30d: r30.s,
    orders_total: totalOrders,
    orders_paid: paidCount,
    orders_7d: r7.n,
    declined,
    aov,
    conversion,
    decline_rate: declineRate,
    fees,
    status_counts: statusCounts,
    series,
    best_sellers: best,
    channels,
    locations: Object.entries(locations).sort((a, b) => b[1] - a[1]),
    recent_events: recentEvents,
  };
}
