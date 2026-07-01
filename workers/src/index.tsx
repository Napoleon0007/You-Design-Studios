import { Hono } from "hono";
import * as catalog from "./lib/catalog";
import * as shipping from "./lib/shipping";
import * as bundles from "./lib/bundles";
import * as providers from "./lib/providers";
import type { PrintfulEnv } from "./lib/printful";
import * as db from "./lib/db";
import * as auth from "./lib/auth";
import * as mailer from "./lib/mailer";
import * as paystack from "./lib/paystack";
import * as storage from "./lib/storage";
import * as imageService from "./lib/imageService";
import * as moderation from "./lib/moderation";
import designsManifest from "./data/designs.json";
import { AuthLoginPage } from "./templates/authLogin";
import { AuthRegisterPage } from "./templates/authRegister";
import { AuthForgotPasswordPage } from "./templates/authForgotPassword";
import { AuthResetPasswordPage } from "./templates/authResetPassword";
import { OrderStatusPage } from "./templates/orderStatus";
import { ResumePage } from "./templates/resume";
import { AccountPage } from "./templates/account";
import { AdminModerationPage } from "./templates/adminModeration";
import { AdminOrdersPage } from "./templates/adminOrders";
import { AdminAnalyticsPage } from "./templates/adminAnalytics";
import type { EnrichedStats } from "./templates/adminAnalytics";
import { StudioPage } from "./templates/studio";
import { CheckoutResultPage } from "./templates/checkoutResult";
import { PrinterDashboardPage } from "./templates/printerDashboard";
import type { PrinterJobView } from "./templates/printerDashboard";
import type { OrderItem, Order } from "./lib/db";

// Mirrors app.py's `_held_designs`: line items whose design still needs
// moderation approval (or was rejected).
function heldDesigns(items: OrderItem[]): OrderItem[] {
  return items.filter((it) => (it.moderation_status ?? "review") !== "approved");
}

export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SECRET_KEY?: string; // session-signing key (wrangler secret put SECRET_KEY before cutover)
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PUBLIC_BASE_URL?: string;
  ADMIN_KEY?: string;
  PRINTER_KEY?: string;
  PRINTER_EMAIL?: string;
  // FILES (R2Bucket) comes from storage.StorageEnv below — bound in wrangler.jsonc.
} & shipping.ShippingEnv &
  bundles.BundleEnv &
  paystack.PaystackEnv &
  PrintfulEnv &
  storage.StorageEnv &
  imageService.ImageServiceEnv;

const SECRET_KEY_FALLBACK = "dev-secret-change-before-deploy"; // matches app.py's Flask SECRET_KEY default

function absUrl(c: { req: { url: string } }, env: Bindings, path: string): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (base) return `${base}${path}`;
  return new URL(path, c.req.url).toString();
}

async function getSession(c: { req: { header: (name: string) => string | undefined }; env: Bindings }) {
  const cookieHeader = c.req.header("Cookie");
  const value = auth.readSessionCookie(cookieHeader);
  return auth.verifySession(c.env.SECRET_KEY ?? SECRET_KEY_FALLBACK, value);
}

// Mirrors app.py's `_admin_ok`/`_printer_ok`: open on local dev (no key set),
// else require `?key=` query param or the X-Admin-Key/X-Printer-Key header.
function keyOk(c: { req: { query: (name: string) => string | undefined; header: (name: string) => string | undefined } }, configuredKey: string | undefined, headerName: string): boolean {
  if (!configuredKey) return true;
  const given = c.req.query("key") || c.req.header(headerName);
  return Boolean(given) && given === configuredKey;
}

// Mirrors app.py's `_printer_view`: shape one order for the print shop.
// Returns null if the order has no local-SA items (skip in dashboard).
function printerView(order: Order): PrinterJobView | null {
  let addr: Record<string, string | undefined> = {};
  try {
    addr = order.shipping_json ? JSON.parse(order.shipping_json) ?? {} : {};
  } catch {
    addr = {};
  }
  const items: PrinterJobView["items"] = [];
  let units = 0;
  for (const it of order.items ?? []) {
    const prov = (it.provider ?? "local-sa").toLowerCase();
    if (prov !== "local-sa") continue;
    const qty = it.quantity || 1;
    units += qty;
    items.push({
      product: catalog.productName(it.product_slug),
      colour: it.color || "—",
      size: it.size || "—",
      qty,
      provider: prov,
      front: it.printfile_front_url,
      back: it.printfile_back_url,
      preview: it.preview_url ?? null,
    });
  }
  if (!items.length) return null;
  return {
    reference: order.reference,
    status: order.status,
    created_at: order.created_at,
    name: order.name || addr.name || "Customer",
    address: addr,
    items,
    units,
    tracking_url: order.tracking_url,
  };
}

// Mirrors app.py's `_enrich_for_email`: adds human product names for email rendering.
function enrichForEmail(order: Order): Order {
  for (const it of order.items ?? []) it.product_name = catalog.productName(it.product_slug);
  return order;
}

// Mirrors app.py's `_release_to_providers`: notifies the SA print shop by email
// when a local-sa job lands, groups the rest by provider for the response summary.
async function releaseToProviders(c: { env: Bindings; req: { url: string } }, order: Order): Promise<string[]> {
  const byProvider: Record<string, number> = {};
  for (const it of order.items ?? []) {
    const p = it.provider || "local-sa";
    byProvider[p] = (byProvider[p] ?? 0) + 1;
  }
  const out: string[] = [];
  for (const [prov, n] of Object.entries(byProvider)) {
    out.push(`${prov}×${n}`);
    if (prov === "local-sa") {
      const notifyTo = (c.env.PRINTER_EMAIL ?? "").trim() || BRAND_EMAIL;
      const dashboardUrl = absUrl(c, c.env, "/printer");
      const [subject, html, text] = mailer.printerJobNotification(enrichForEmail(order), dashboardUrl);
      await mailer.send(c.env, notifyTo, subject, html, text);
    }
  }
  return out;
}

const BRAND = { name: "TRUEF Studios" };
const BRAND_EMAIL = "hello@youdesignstudios.co.za";

// Ported from app.py's `_line_price_cents`: a print costs full price; a blank
// garment (no art chosen) is cheaper by PRINT_FEE_CENTS.
const PRINT_FEE_CENTS = 7000; // R70
function linePriceCents(slug: string, sizeCode: string, artKey: string | null | undefined): number {
  const base = catalog.unitPriceCents(slug, sizeCode);
  return artKey ? base : Math.max(0, base - PRINT_FEE_CENTS);
}

interface GuardedItem {
  design_id: number;
  provider: string;
  gelato_uid: string | null;
  slug: string;
  quantity: number;
  unit_price: number;
  upsize_fee: number;
  printfile_front_url: string | null;
  printfile_back_url: string | null;
}

// Ported 1:1 from app.py's `_guard_items`: re-validate a cart server-side
// before it can reach a factory. For each line: (1) the design exists, (2) the
// variant exists in our verified catalogue, (3) providers.verify confirms the
// UID's grammar matches its declared provider AND resolves live with a matching
// category (anti-mix-up), (4) rights confirmed + not IP-blocked. A 'review'
// design is allowed but its token is returned in `pending` so the order is HELD
// from fulfilment.
async function guardItems(
  c: { env: Bindings },
  rawItems: CartItemInput[] | undefined
): Promise<{ items: GuardedItem[] | null; pending: string[] | null; error: string | null }> {
  const items: GuardedItem[] = [];
  const pending: string[] = [];
  for (const it of rawItems ?? []) {
    const design = await db.getDesign(c.env.DB, it.design_token ?? "");
    if (!design) return { items: null, pending: null, error: `Design not found: ${it.design_token ?? ""}` };
    const provider = design.provider || catalog.providerOf(design.product_slug);
    const [ok, expectedGca] = catalog.verifyItem(design.product_slug, design.color_code ?? "", design.size_code ?? "");
    if (!ok) return { items: null, pending: null, error: `Rejected: ${expectedGca}` };
    const sides = catalog.sidesFor(Boolean(design.printfile_front_url), Boolean(design.printfile_back_url));
    const verifiedUid = catalog.buildUid(design.product_slug, design.color_code ?? "", design.size_code ?? "", sides);
    const [ok2, msg] = await providers.verify(c.env, provider, verifiedUid ?? "", expectedGca);
    if (!ok2) return { items: null, pending: null, error: `Rejected (${provider}): ${msg}` };
    if (!design.rights_confirmed) {
      return { items: null, pending: null, error: "Please confirm you own or have the rights to this artwork." };
    }
    if (design.moderation_status === "blocked") {
      return {
        items: null,
        pending: null,
        error: design.moderation_reason || "This design can't be printed for copyright/usage reasons.",
      };
    }
    if (design.moderation_status !== "approved") pending.push(design.token);
    const unit = linePriceCents(design.product_slug, design.size_code ?? "", design.art_key);
    const upsize = catalog.upsizeFeeCents(design.product_slug, design.color_code ?? "", design.placement);
    items.push({
      design_id: design.id,
      provider,
      gelato_uid: verifiedUid,
      slug: design.product_slug,
      quantity: Math.max(1, Number(it.quantity ?? 1)),
      unit_price: unit,
      upsize_fee: upsize,
      printfile_front_url: design.printfile_front_url,
      printfile_back_url: design.printfile_back_url,
    });
  }
  if (!items.length) return { items: null, pending: null, error: "No items to order" };
  return { items, pending, error: null };
}

// Ported 1:1 from app.py's `_settle_payment`: idempotently settle a paid order —
// capture payment details, confirm the customer, then auto-release to the
// printer. No manual admin step required. Idempotent across the callback +
// webhook both firing for the same order.
async function settlePayment(c: { env: Bindings; req: { url: string } }, order: db.Order, txn?: any): Promise<string> {
  if (!["created", "payment_initiated"].includes(order.status)) return order.status; // already settled
  const ref = order.reference;
  if (txn) {
    const auth_ = txn.authorization ?? {};
    await db.setPaymentMeta(c.env.DB, ref, {
      paidAt: Math.floor(Date.now() / 1000),
      channel: txn.channel,
      last4: auth_.last4,
      feesCents: txn.fees,
      gatewayResponse: txn.gateway_response,
    });
  }
  await db.setOrderStatus(c.env.DB, ref, "paid", { notes: "Paid — auto-releasing to printer." });
  const fresh = await db.getOrder(c.env.DB, ref);
  if (fresh?.email) {
    const statusUrl = absUrl(c, c.env, `/order/${fresh.reference}`);
    const [subject, html, text] = mailer.orderConfirmation(enrichForEmail(fresh), "R", statusUrl);
    await mailer.send(c.env, fresh.email, subject, html, text);
  }
  await releaseToProviders(c, fresh ?? order);
  await db.setOrderStatus(c.env.DB, ref, "submitted", { notes: "Auto-released to printer on payment." });
  return "submitted";
}

const app = new Hono<{ Bindings: Bindings }>();

// Flask's `app.send_static_file("v2/index.html")` served at both `/` and `/v2` —
// mirrored here by fetching the single static asset via the ASSETS binding
// rather than duplicating the file, so there's one source of truth.
async function serveV2Index(c: { env: Bindings; req: { url: string } }) {
  const url = new URL(c.req.url);
  const assetUrl = new URL("/static/v2/index.html", url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl));
}

app.get("/", (c) => serveV2Index(c));
app.get("/v2", (c) => serveV2Index(c));

// The design studio. Products come from the OTC-shaped catalogue payload —
// includes colour hex/codes, sizes, print areas and reference photos.
app.get("/studio", (c) => {
  const products = catalog.studioProducts((path) => `/static/${path}`);
  return c.html(<StudioPage brandName={BRAND.name} products={products} />);
});

// Matches Flask: static/favicon.svg doesn't exist on disk, so the current
// live behavior is an empty 204 (not a 404) — preserved exactly.
app.get("/favicon.ico", (c) => c.body(null, 204));

app.get("/healthz", (c) => c.json({ ok: true, brand: BRAND.name }));

interface CartItemInput {
  design_token?: string;
  quantity?: number;
}

// Preview the cart's subtotal + shipping WITHOUT creating an order, so the
// checkout screen can show an honest total before the customer pays.
app.post("/api/shipping-quote", async (c) => {
  const body = await c.req.json<{ items?: CartItemInput[] }>().catch(() => ({}) as { items?: CartItemInput[] });
  const lines: { slug: string; quantity: number }[] = [];
  let subtotal = 0;
  let upsizeTotal = 0;
  for (const it of body.items ?? []) {
    const design = await db.getDesign(c.env.DB, it.design_token ?? "");
    if (!design) continue;
    const qty = Math.max(1, it.quantity ?? 1);
    const unit = linePriceCents(design.product_slug, design.size_code ?? "", design.art_key);
    const upsize = catalog.upsizeFeeCents(design.product_slug, design.color_code ?? "", design.placement);
    subtotal += (unit + upsize) * qty;
    upsizeTotal += upsize * qty;
    lines.push({ slug: design.product_slug, quantity: qty });
  }
  if (!lines.length) return c.json({ ok: false, error: "Your cart is empty." }, 400);
  const q = shipping.quote(c.env, lines, subtotal, "ZA");
  return c.json({
    ok: true,
    subtotal,
    shipping: q,
    upsize_total: upsizeTotal,
    total: subtotal + q.amount_cents,
    currency: "ZAR",
  });
});

// Cart math incl. multi-buy discount: subtotal -> bundle discount -> shipping
// -> total + the best upsell nudge. Informational (mirrors /api/shipping-quote).
app.post("/api/bundle-quote", async (c) => {
  const body = await c.req.json<{ items?: CartItemInput[] }>().catch(() => ({}) as { items?: CartItemInput[] });
  const lines: { slug: string; quantity: number; unit_price: number }[] = [];
  for (const it of body.items ?? []) {
    const design = await db.getDesign(c.env.DB, it.design_token ?? "");
    if (!design) continue;
    lines.push({
      slug: design.product_slug,
      quantity: Math.max(1, it.quantity ?? 1),
      unit_price: catalog.unitPriceCents(design.product_slug, design.size_code ?? ""),
    });
  }
  if (!lines.length) return c.json({ ok: false, error: "Your cart is empty." }, 400);
  const shipLines = lines.map((l) => ({ slug: l.slug, quantity: l.quantity }));
  const subtotal = lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);
  const freeOver = shipping.quote(c.env, shipLines, subtotal, "ZA").free_over_cents;
  const b = bundles.quote(c.env, lines, freeOver);
  // shipping is computed on the discounted subtotal (what they actually pay)
  const ship = shipping.quote(c.env, shipLines, b.discounted_subtotal_cents, "ZA");
  return c.json({
    ok: true,
    bundle: b,
    shipping: ship,
    subtotal: b.original_subtotal_cents,
    discount: b.discount_cents,
    total: b.discounted_subtotal_cents + ship.amount_cents,
    currency: "ZAR",
  });
});

// --------------------------------------------------------------------------- //
// Image validation + the ready-made design library. `/api/validate-image`'s
// grading (format/size/DPI/transparency) delegates to the image microservice's
// /grade-image (same Pillow decode used by render-printfile/mockup, so there's
// one source of truth rather than a second JS-only image-header parser).
// Ported 1:1 from app.py's validate_image/list_designs/use_design.
// --------------------------------------------------------------------------- //
interface DesignManifestEntry {
  id: string;
  title: string;
  url: string;
}
const DESIGNS: DesignManifestEntry[] = designsManifest as DesignManifestEntry[];

app.post("/api/validate-image", async (c) => {
  const body = await c.req.parseBody().catch(() => null);
  const file = body?.design;
  if (!file || !(file instanceof File) || !file.name) {
    return c.json({ ok: false, error: "No file received" }, 400);
  }
  const raw = await file.arrayBuffer();
  if (!raw.byteLength) return c.json({ ok: false, error: "Empty file" }, 400);
  const printWCm = Number(body?.print_w_cm) || catalog.PRINT_AREA.front.w_cm;
  const printHCm = Number(body?.print_h_cm) || catalog.PRINT_AREA.front.h_cm;

  let verdict: imageService.GradeVerdict;
  try {
    verdict = await imageService.gradeImage(c.env, raw, printWCm, printHCm);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 400);
  }
  const ext = verdict.format === "JPEG" ? "jpg" : verdict.format.toLowerCase();
  let artKey: string;
  try {
    artKey = storage.newKey("art", ext);
    await storage.put(c.env, raw, artKey);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  // IP / content pre-screen (advisory here; re-checked authoritatively on save + order)
  const mod = await moderation.check(file.name, raw, "upload");
  return c.json({ ok: true, ...verdict, art_key: artKey, moderation: mod });
});

app.get("/api/designs", (c) => c.json({ ok: true, designs: DESIGNS }));

app.post("/api/use-design", async (c) => {
  const d = await c.req.json<{ design?: string }>().catch(() => ({}) as Record<string, never>);
  const name = (d.design ?? "").split("/").pop() ?? "";
  const entry = DESIGNS.find((x) => x.id === name);
  if (!name || !entry) return c.json({ ok: false, error: "Design not found" }, 404);

  const assetUrl = new URL(entry.url, new URL(c.req.url).origin);
  const assetRes = await c.env.ASSETS.fetch(new Request(assetUrl));
  if (!assetRes.ok) return c.json({ ok: false, error: "Design not found" }, 404);
  const raw = await assetRes.arrayBuffer();

  let verdict: imageService.GradeVerdict;
  try {
    verdict = await imageService.gradeImage(c.env, raw, catalog.PRINT_AREA.front.w_cm, catalog.PRINT_AREA.front.h_cm);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 400);
  }
  const ext = verdict.format === "JPEG" ? "jpg" : verdict.format.toLowerCase();
  let artKey: string;
  try {
    artKey = storage.newKey("art", ext);
    await storage.put(c.env, raw, artKey);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  const mod = await moderation.check(name, null, "library"); // curated → approved
  return c.json({ ok: true, ...verdict, art_key: artKey, url: entry.url, moderation: mod, library_design: name });
});

// Ported 1:1 from app.py's `_area`: resolve a print side to its area spec,
// falling back to front for anything unrecognised.
function printArea(side: string): catalog.PrintAreaSide {
  return side === "back" ? catalog.PRINT_AREA.back : catalog.PRINT_AREA.front;
}

// Ported 1:1 from mockup.py's own `family_for` — NOT the same function as
// shipping.familyFor (that one exists in shipping.ts already but its fallback
// is "other", not "tee"; the two Python modules define separate functions
// that only coincidentally share most of their logic).
function mockupFamilyFor(slug: string): string {
  const s = (slug ?? "").toLowerCase();
  if (s.includes("hood")) return "hoodie";
  if (s.includes("sweat") || s.includes("crew")) return "sweatshirt";
  return "tee";
}

// --------------------------------------------------------------------------- //
// Image processing — calls out to the standalone Railway microservice
// (image-service/) for the two operations that don't fit in a Worker: print-
// file rendering (printfile.py) and studio-card mockups (mockup.py). Requires
// BOTH IMAGE_SERVICE_URL (Railway deploy) and the R2 FILES binding (blocked
// until Luke enables R2 on the account) — ported 1:1 from app.py's
// render_printfile/api_mockup, which is why both still fail cleanly with a
// clear error until those two external pieces land.
// --------------------------------------------------------------------------- //
app.post("/api/render-printfile", async (c) => {
  const d = await c.req.json<{ side?: string; art_key?: string; placement?: Record<string, unknown> }>().catch(() => ({}) as Record<string, never>);
  const side = d.side ?? "front";
  if (!d.art_key) return c.json({ ok: false, error: "Artwork not found — please upload again" }, 400);
  let art: ArrayBuffer | null;
  try {
    art = await storage.openBytes(c.env, d.art_key);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  if (!art) return c.json({ ok: false, error: "Artwork not found — please upload again" }, 400);
  const area = printArea(side);
  let rendered;
  try {
    rendered = await imageService.renderPrintfile(c.env, art, area, d.placement ?? {});
  } catch (exc) {
    return c.json({ ok: false, error: `Could not render print file: ${(exc as Error).message}` }, 400);
  }
  let url: string;
  try {
    url = await storage.put(c.env, rendered.printPng, storage.newKey("print", "png"));
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  return c.json({ ok: true, url, side, width: area.w_px, height: area.h_px, dpi: area.dpi });
});

app.post("/api/mockup", async (c) => {
  const d = await c.req
    .json<{ design_token?: string; art_key?: string; slug?: string; hex?: string }>()
    .catch(() => ({}) as Record<string, never>);
  let artKey = d.art_key;
  let slug = d.slug;
  let hexColor = d.hex;
  if (d.design_token) {
    const design = await db.getDesign(c.env.DB, d.design_token);
    if (!design) return c.json({ ok: false, error: "Design not found" }, 404);
    artKey = design.art_key ?? undefined;
    slug = design.product_slug;
    hexColor = catalog.colorHex(slug, design.color_code ?? "") ?? hexColor;
  }
  if (!artKey) return c.json({ ok: false, error: "No artwork to render" }, 400);
  let art: ArrayBuffer | null;
  try {
    art = await storage.openBytes(c.env, artKey);
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  if (!art) return c.json({ ok: false, error: "Artwork file missing" }, 404);
  let jpeg: ArrayBuffer;
  try {
    jpeg = await imageService.studioCard(c.env, art, mockupFamilyFor(slug ?? ""), hexColor ?? "#ffffff", { wordmark: BRAND.name });
  } catch (exc) {
    return c.json({ ok: false, error: `Could not render mockup: ${(exc as Error).message}` }, 400);
  }
  let url: string;
  try {
    url = await storage.put(c.env, jpeg, storage.newKey("mockup", "jpg"));
  } catch (exc) {
    return c.json({ ok: false, error: (exc as Error).message }, 500);
  }
  return c.json({ ok: true, url });
});

interface SaveDesignBody {
  slug?: string;
  user_email?: string;
  user_name?: string;
  art_key?: string;
  art_key_back?: string;
  placement?: Record<string, unknown>;
  placement_back?: Record<string, unknown>;
  color?: string;
  color_code?: string;
  size?: string;
  size_code?: string;
  library_design?: string;
  art_filename?: string;
  rights_confirmed?: boolean;
  name?: string;
}

// Renders the print file(s), persists the design, returns its token. Ported
// 1:1 from app.py's `save_design`.
app.post("/api/save-design", async (c) => {
  const d = await c.req.json<SaveDesignBody>().catch(() => ({}) as SaveDesignBody);
  const slug = d.slug ?? "";
  const product = catalog.PRODUCTS.find((p) => p.slug === slug);
  if (!product) return c.json({ ok: false, error: "Unknown product" }, 400);

  const userId = await db.upsertUser(c.env.DB, d.user_email ?? null, d.user_name ?? null);
  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  let previewUrl: string | null = null;
  let artFront: ArrayBuffer | null = null;
  let artBack: ArrayBuffer | null = null;

  try {
    if (d.art_key) {
      artFront = await storage.openBytes(c.env, d.art_key);
      if (artFront) {
        const rendered = await imageService.renderPrintfile(c.env, artFront, printArea("front"), d.placement ?? {});
        frontUrl = await storage.put(c.env, rendered.printPng, storage.newKey("print", "png"));
        previewUrl = await storage.put(c.env, rendered.previewPng, storage.newKey("preview", "png"));
      }
    }
    if (d.art_key_back) {
      artBack = await storage.openBytes(c.env, d.art_key_back);
      if (artBack) {
        const renderedBack = await imageService.renderPrintfile(c.env, artBack, printArea("back"), d.placement_back ?? {});
        backUrl = await storage.put(c.env, renderedBack.printPng, storage.newKey("print", "png"));
      }
    }
  } catch (exc) {
    return c.json({ ok: false, error: `Could not render print file: ${(exc as Error).message}` }, 400);
  }

  const [ok, expected] = catalog.verifyItem(slug, d.color_code ?? "", d.size_code ?? "");
  if (!ok) return c.json({ ok: false, error: expected }, 400);
  const sides = catalog.sidesFor(Boolean(artFront), Boolean(artBack));
  const provider = catalog.providerOf(slug);
  const gelatoUid = catalog.buildUid(slug, d.color_code ?? "", d.size_code ?? "", sides);

  // Authoritative IP / content verdict, re-derived server-side (never trust the
  // client). A curated-library pick is only honoured as 'library' if that file
  // genuinely exists in the design manifest — otherwise it's treated as an upload.
  const lib = (d.library_design ?? "").split("/").pop() ?? "";
  const src = lib && DESIGNS.some((x) => x.id === lib) ? "library" : "upload";
  const mod = await moderation.check(d.art_filename ?? "", artFront, src);

  const design = await db.createDesign(c.env.DB, {
    user_id: userId,
    product_slug: slug,
    provider,
    gelato_uid: gelatoUid,
    color: d.color ?? null,
    color_code: d.color_code ?? null,
    size: d.size ?? null,
    size_code: d.size_code ?? null,
    art_key: d.art_key ?? null,
    placement: { front: d.placement ?? null, back: d.placement_back ?? null },
    printfile_front_url: frontUrl,
    printfile_back_url: backUrl,
    preview_url: previewUrl,
    moderation_status: mod.status,
    moderation_reason: mod.reason || null,
    rights_confirmed: Boolean(d.rights_confirmed),
  });

  if (userId) await db.saveDesignForUser(c.env.DB, userId, design.id, d.name ?? null);

  return c.json({
    ok: true,
    design_token: design.token,
    gelato_uid: gelatoUid,
    printfile_front_url: frontUrl,
    printfile_back_url: backUrl,
    preview_url: previewUrl,
    moderation: mod,
    unit_price_cents: linePriceCents(slug, d.size_code ?? "", d.art_key),
  });
});

// --------------------------------------------------------------------------- //
// Checkout + payment (Paystack) + escrow. Paystack charges immediately, so our
// "escrow" is the order STATE: paid -> in_review (held) -> released or refunded.
// Works with NO keys in dev: a "simulate payment" path drives the same flow so
// the whole pipeline is testable end-to-end before real keys land. Ported 1:1
// from app.py's checkout/checkout_callback/paystack_webhook.
// --------------------------------------------------------------------------- //
interface CheckoutBody {
  email?: string;
  name?: string;
  items?: CartItemInput[];
  shipping?: unknown;
}

app.post("/api/checkout", async (c) => {
  const d = await c.req.json<CheckoutBody>().catch(() => ({}) as CheckoutBody);
  const email = (d.email ?? "").trim();
  if (!email || !email.includes("@")) {
    return c.json({ ok: false, error: "A valid email is required for checkout." }, 400);
  }

  const { items, pending, error } = await guardItems(c, d.items);
  if (error) return c.json({ ok: false, error }, 400);

  const subtotal = items!.reduce((s, i) => s + (i.unit_price + i.upsize_fee) * i.quantity, 0);
  const ship = shipping.quote(
    c.env,
    items!.map((i) => ({ slug: i.slug, quantity: i.quantity })),
    subtotal,
    "ZA"
  );
  const userId = await db.upsertUser(c.env.DB, email, d.name ?? null);
  const order = await db.createOrder(c.env.DB, userId, items!, "ZAR", ship.amount_cents, d.shipping);
  if (!order) return c.json({ ok: false, error: "Could not create order." }, 500);
  const ref = order.reference;

  if (paystack.hasKeys(c.env)) {
    let init: any;
    try {
      init = await paystack.initializeTransaction(c.env, email, order.total, ref, "ZAR", absUrl(c, c.env, `/checkout/callback?reference=${ref}`), {
        reference: ref,
        items: items!.length,
      });
    } catch (exc) {
      return c.json({ ok: false, error: `Payment init failed: ${(exc as Error).message}` }, 502);
    }
    await db.addOrderEvent(c.env.DB, ref, "payment_initiated", "Paystack checkout opened", order.total);
    return c.json({
      ok: true,
      mode: "paystack",
      reference: ref,
      total: order.total,
      currency: "ZAR",
      shipping: ship,
      authorization_url: init.authorization_url,
      public_key: paystack.publicKey(c.env),
      held: Boolean(pending?.length),
    });
  }

  // Dev mode: no Paystack key. Hand back a link that simulates a successful
  // charge so the escrow/email/admin/resume flow can be exercised locally.
  return c.json({
    ok: true,
    mode: "dev",
    reference: ref,
    total: order.total,
    currency: "ZAR",
    shipping: ship,
    held: Boolean(pending?.length),
    pay_url: absUrl(c, c.env, `/checkout/callback?reference=${ref}&dev=1`),
    note: "No Paystack key set — use pay_url to simulate payment.",
  });
});

app.get("/checkout/callback", async (c) => {
  const ref = c.req.query("reference") ?? "";
  let order = await db.getOrder(c.env.DB, ref);
  if (!order) {
    return c.html(<CheckoutResultPage brandName={BRAND.name} order={null} status="unknown" message="We couldn't find that order." />, 404);
  }

  let paidOk = false;
  let txn: any = null;
  if (paystack.hasKeys(c.env)) {
    try {
      txn = await paystack.verifyTransaction(c.env, ref);
      paidOk = txn?.status === "success";
      if (!paidOk && txn?.status === "failed" && ["created", "payment_initiated"].includes(order.status)) {
        await db.setOrderStatus(c.env.DB, ref, "declined", { notes: `Payment declined: ${txn?.gateway_response || "failed"}` });
      }
    } catch {
      paidOk = false;
    }
  } else if (c.req.query("dev") === "1") {
    paidOk = true; // dev simulate
  }

  if (paidOk) {
    await settlePayment(c, order, txn);
    order = await db.getOrder(c.env.DB, ref);
  }

  const paidStatuses = ["paid", "submitted", "in_production", "shipped", "delivered", "in_review"];
  const session = await getSession(c);
  const showSignup = Boolean(paidOk && order && paidStatuses.includes(order.status) && !session);
  return c.html(<CheckoutResultPage brandName={BRAND.name} order={order} status={order!.status} showSignup={showSignup} />);
});

app.post("/api/webhooks/paystack", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("x-paystack-signature") ?? "";
  if (!(await paystack.verifyWebhook(c.env, raw, sig))) return c.body(null, 401);
  const event = JSON.parse(raw || "{}");
  const kind = event.event;
  const data = event.data ?? {};
  const ref = data.reference ?? "";
  if (kind === "charge.success" && ref) {
    const order = await db.getOrder(c.env.DB, ref);
    if (order) await settlePayment(c, order, data);
  } else if (kind === "charge.failed" && ref) {
    const order = await db.getOrder(c.env.DB, ref);
    if (order && ["created", "payment_initiated"].includes(order.status)) {
      await db.setOrderStatus(c.env.DB, ref, "declined", { notes: `Payment declined: ${data.gateway_response || "failed"}` });
    }
  }
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------- //
// Auth routes — register, login, logout, forgot/reset password
// Ported 1:1 from app.py's auth_register/auth_login/auth_logout/auth_forgot/auth_reset
// --------------------------------------------------------------------------- //
app.get("/auth/register", async (c) => {
  const session = await getSession(c);
  if (session) return c.redirect("/account");
  return c.html(<AuthRegisterPage brandName={BRAND.name} error={null} next={c.req.query("next")} />);
});
app.post("/auth/register", async (c) => {
  const session = await getSession(c);
  if (session) return c.redirect("/account");
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim();
  const name = String(form.name ?? "").trim();
  const password = String(form.password ?? "");
  const confirm = String(form.confirm ?? "");
  let error: string | null = null;
  if (password !== confirm) {
    error = "Passwords don't match.";
  } else {
    const [userId, regError] = await auth.register(c.env.DB, email, name, password);
    error = regError;
    if (userId) {
      const sessionData = await auth.loginSessionData(c.env.DB, userId);
      const signed = await auth.signSession(c.env.SECRET_KEY ?? SECRET_KEY_FALLBACK, sessionData!);
      c.header("Set-Cookie", auth.sessionCookieHeader(signed));
      const nextUrl = c.req.query("next") || "/account";
      return c.redirect(nextUrl);
    }
  }
  return c.html(<AuthRegisterPage brandName={BRAND.name} error={error} next={c.req.query("next")} />);
});

app.get("/auth/login", async (c) => {
  const session = await getSession(c);
  if (session) return c.redirect("/account");
  return c.html(<AuthLoginPage brandName={BRAND.name} error={null} next={c.req.query("next")} />);
});
app.post("/auth/login", async (c) => {
  const session = await getSession(c);
  if (session) return c.redirect("/account");
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim();
  const password = String(form.password ?? "");
  const userId = await auth.authenticate(c.env.DB, email, password);
  if (userId) {
    const sessionData = await auth.loginSessionData(c.env.DB, userId);
    const signed = await auth.signSession(c.env.SECRET_KEY ?? SECRET_KEY_FALLBACK, sessionData!);
    c.header("Set-Cookie", auth.sessionCookieHeader(signed));
    const nextUrl = c.req.query("next") || "/account";
    return c.redirect(nextUrl);
  }
  return c.html(<AuthLoginPage brandName={BRAND.name} error="Incorrect email or password." next={c.req.query("next")} />);
});

app.post("/auth/logout", (c) => {
  c.header("Set-Cookie", auth.clearSessionCookieHeader());
  return c.redirect("/");
});

app.get("/auth/forgot-password", (c) => c.html(<AuthForgotPasswordPage brandName={BRAND.name} sent={false} error={null} />));
app.post("/auth/forgot-password", async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email ?? "").trim();
  const [user, token] = await auth.createResetToken(c.env.DB, email);
  if (user && token) {
    const resetUrl = absUrl(c, c.env, `/auth/reset-password/${token}`);
    const [subject, html, text] = mailer.passwordReset(user.name ?? "", resetUrl);
    if (user.email) await mailer.send(c.env, user.email, subject, html, text);
  }
  // Always show "sent" — don't reveal whether the email exists
  return c.html(<AuthForgotPasswordPage brandName={BRAND.name} sent={true} error={null} />);
});

app.get("/auth/reset-password/:token", async (c) => {
  const token = c.req.param("token");
  const user = await db.getByResetToken(c.env.DB, token);
  if (!user) return c.html(<AuthResetPasswordPage brandName={BRAND.name} invalid={true} error={null} />);
  return c.html(<AuthResetPasswordPage brandName={BRAND.name} invalid={false} error={null} />);
});
app.post("/auth/reset-password/:token", async (c) => {
  const token = c.req.param("token");
  const existing = await db.getByResetToken(c.env.DB, token);
  if (!existing) return c.html(<AuthResetPasswordPage brandName={BRAND.name} invalid={true} error={null} />);
  const form = await c.req.parseBody();
  const password = String(form.password ?? "");
  const confirm = String(form.confirm ?? "");
  let error: string | null = null;
  if (password !== confirm) {
    error = "Passwords don't match.";
  } else {
    const [userId, redeemError] = await auth.redeemResetToken(c.env.DB, token, password);
    error = redeemError;
    if (userId) {
      const sessionData = await auth.loginSessionData(c.env.DB, userId);
      const signed = await auth.signSession(c.env.SECRET_KEY ?? SECRET_KEY_FALLBACK, sessionData!);
      c.header("Set-Cookie", auth.sessionCookieHeader(signed));
      return c.redirect("/account");
    }
  }
  return c.html(<AuthResetPasswordPage brandName={BRAND.name} invalid={false} error={error} />);
});

// --------------------------------------------------------------------------- //
// Public order tracking + magic "fix your design" resume link
// Ported 1:1 from app.py's order_status / resume
// --------------------------------------------------------------------------- //
const ORDER_STEP_MAP: Record<string, number> = {
  created: 0,
  paid: 1,
  in_review: 1,
  awaiting_redo: 1,
  submitted: 2,
  in_production: 3,
  shipped: 4,
  delivered: 5,
};
const TERMINAL_STATUSES = ["cancelled", "refunded", "rejected", "failed"];

app.get("/order/:reference", async (c) => {
  const reference = c.req.param("reference");
  const order = await db.getOrder(c.env.DB, reference);
  if (!order) {
    return c.html(<OrderStatusPage brandName={BRAND.name} order={null} reference={reference} step={0} />, 404);
  }
  for (const it of order.items ?? []) it.product_name = catalog.productName(it.product_slug);
  const step = ORDER_STEP_MAP[order.status] ?? 0;
  const terminal = TERMINAL_STATUSES.includes(order.status);
  return c.html(<OrderStatusPage brandName={BRAND.name} order={order} reference={reference} step={step} terminal={terminal} />);
});

app.get("/resume/:token", async (c) => {
  const token = c.req.param("token");
  const order = await db.getOrderByResumeToken(c.env.DB, token);
  if (!order) {
    return c.html(<ResumePage brandName={BRAND.name} order={null} token={token} held={[]} />, 404);
  }
  for (const it of order.items ?? []) it.product_name = catalog.productName(it.product_slug);
  const held = heldDesigns(order.items ?? []);
  return c.html(<ResumePage brandName={BRAND.name} order={order} token={token} held={held} />);
});

// --------------------------------------------------------------------------- //
// Account dashboard — ported 1:1 from app.py's account/account_save_address/
// account_delete_address/account_change_password/account_create_from_order
// --------------------------------------------------------------------------- //
app.get("/account", async (c) => {
  const session = await getSession(c);
  if (!session) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`);
  const user = await auth.currentUser(c.env.DB, session);
  if (!user) return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.path)}`);
  const orders = await db.getUserOrders(c.env.DB, user.id);
  for (const o of orders) for (const it of o.items ?? []) it.product_name = catalog.productName(it.product_slug);
  const saved = await db.listSavedDesigns(c.env.DB, user.id);
  const addresses = await db.listAddresses(c.env.DB, user.id);
  return c.html(<AccountPage brandName={BRAND.name} user={user} orders={orders} saved={saved} addresses={addresses} />);
});

app.post("/api/account/address", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ ok: false, error: "Login required" }, 401);
  const d = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const addrId = await db.saveAddress(
    c.env.DB,
    session.user_id,
    String(d.name ?? ""),
    String(d.line1 ?? ""),
    String(d.line2 ?? ""),
    String(d.city ?? ""),
    String(d.province ?? ""),
    String(d.postal_code ?? ""),
    String(d.country ?? "ZA"),
    Boolean(d.is_default)
  );
  return c.json({ ok: true, id: addrId });
});

app.delete("/api/account/address/:id", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ ok: false, error: "Login required" }, 401);
  const addrId = Number(c.req.param("id"));
  const ok = await db.deleteAddress(c.env.DB, addrId, session.user_id);
  return c.json({ ok });
});

app.post("/api/account/password", async (c) => {
  const session = await getSession(c);
  if (!session) return c.json({ ok: false, error: "Login required" }, 401);
  const user = await auth.currentUser(c.env.DB, session);
  if (!user) return c.json({ ok: false, error: "Login required" }, 401);
  const d = await c.req.json<{ current_password?: string; new_password?: string; confirm_password?: string }>().catch(
    () => ({}) as Record<string, never>
  );
  const currentPw = d.current_password ?? "";
  const newPw = d.new_password ?? "";
  const confirm = d.confirm_password ?? "";
  const authedId = user.email ? await auth.authenticate(c.env.DB, user.email, currentPw) : null;
  if (!authedId) return c.json({ ok: false, error: "Current password is incorrect." }, 400);
  if (newPw.length < 8) return c.json({ ok: false, error: "New password must be at least 8 characters." }, 400);
  if (newPw !== confirm) return c.json({ ok: false, error: "Passwords don't match." }, 400);
  await db.setPassword(c.env.DB, user.id, auth.generatePasswordHash(newPw));
  return c.json({ ok: true });
});

// Post-payment account creation nudge (called client-side on checkout result)
app.post("/api/account/create-from-order", async (c) => {
  const d = await c.req.json<{ reference?: string; password?: string }>().catch(() => ({}) as Record<string, never>);
  const reference = d.reference ?? "";
  const password = d.password ?? "";
  const order = await db.getOrder(c.env.DB, reference);
  if (!order || !order.email) return c.json({ ok: false, error: "Order not found." }, 404);
  if (password.length < 8) return c.json({ ok: false, error: "Password must be at least 8 characters." }, 400);
  const email = order.email;
  const existing = await db.getUserByEmail(c.env.DB, email);
  if (existing?.password_hash) {
    return c.json({ ok: false, error: "An account already exists for this email. Please log in." }, 409);
  }
  const userId = await db.upsertUser(c.env.DB, email, order.name ?? null);
  if (!userId) return c.json({ ok: false, error: "Could not create account." }, 500);
  await db.setPassword(c.env.DB, userId, auth.generatePasswordHash(password));
  const sessionData = await auth.loginSessionData(c.env.DB, userId);
  const signed = await auth.signSession(c.env.SECRET_KEY ?? SECRET_KEY_FALLBACK, sessionData!);
  c.header("Set-Cookie", auth.sessionCookieHeader(signed));
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------- //
// Admin — moderation queue + order escrow actions (release/reject/refund).
// Ported 1:1 from app.py's admin_moderation/admin_moderate/admin_orders/
// admin_order_action. Guarded by ADMIN_KEY in production (open on local dev).
// --------------------------------------------------------------------------- //
app.get("/admin/moderation", async (c) => {
  if (!keyOk(c, c.env.ADMIN_KEY, "X-Admin-Key")) return c.text("Unauthorized — append ?key=YOUR_ADMIN_KEY", 401);
  const pending = await db.listModeration(c.env.DB, "review");
  const blocked = await db.listModeration(c.env.DB, "blocked", 50);
  return c.html(<AdminModerationPage brandName={BRAND.name} pending={pending} blocked={blocked} adminKey={c.req.query("key") ?? ""} />);
});

app.post("/api/admin/moderate", async (c) => {
  if (!keyOk(c, c.env.ADMIN_KEY, "X-Admin-Key")) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const d = await c.req.json<{ token?: string; action?: string; reason?: string }>().catch(() => ({}) as Record<string, never>);
  const token = d.token ?? "";
  const status = { approve: "approved", block: "blocked" }[d.action ?? ""];
  if (!token || !status) return c.json({ ok: false, error: "token and action (approve|block) required" }, 400);
  const reason = d.reason || (status === "approved" ? "Approved by reviewer" : "Rejected by reviewer");
  const ok = await db.setModeration(c.env.DB, token, status, reason);
  return c.json({ ok, token, status });
});

function enrichStats(stats: db.DashboardStats): EnrichedStats {
  const enriched = stats as EnrichedStats;
  for (const b of enriched.best_sellers) {
    b.name = catalog.productName(b.slug) || b.slug || "—";
  }
  return enriched;
}

app.get("/admin/orders", async (c) => {
  if (!keyOk(c, c.env.ADMIN_KEY, "X-Admin-Key")) return c.text("Unauthorized — append ?key=YOUR_ADMIN_KEY", 401);
  const active = await db.listOrders(c.env.DB, ["paid", "in_review", "awaiting_redo"], 100);
  const recent = await db.listOrders(c.env.DB, undefined, 30);
  for (const o of [...active, ...recent]) for (const it of o.items ?? []) it.product_name = catalog.productName(it.product_slug);
  const stats = enrichStats(await db.dashboardStats(c.env.DB));
  return c.html(
    <AdminOrdersPage
      brandName={BRAND.name}
      active={active}
      recent={recent}
      adminKey={c.req.query("key") ?? ""}
      paystackLive={paystack.hasKeys(c.env)}
      mailLive={mailer.hasProvider(c.env)}
    />
  );
});

app.get("/admin/analytics", async (c) => {
  if (!keyOk(c, c.env.ADMIN_KEY, "X-Admin-Key")) return c.text("Unauthorized — append ?key=YOUR_ADMIN_KEY", 401);
  const stats = enrichStats(await db.dashboardStats(c.env.DB, 14));
  return c.html(<AdminAnalyticsPage brandName={BRAND.name} stats={stats} adminKey={c.req.query("key") ?? ""} />);
});

app.post("/api/admin/order", async (c) => {
  if (!keyOk(c, c.env.ADMIN_KEY, "X-Admin-Key")) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const d = await c.req.json<{ reference?: string; action?: string; reason?: string }>().catch(() => ({}) as Record<string, never>);
  const ref = d.reference ?? "";
  const action = d.action ?? "";
  const order = await db.getOrder(c.env.DB, ref);
  if (!order) return c.json({ ok: false, error: "Order not found" }, 404);

  if (action === "release") {
    const held = heldDesigns(order.items ?? []);
    if (held.length) {
      return c.json({ ok: false, error: `${held.length} design(s) still need moderation approval. Approve them in the moderation queue first.` }, 400);
    }
    if (!["paid", "in_review"].includes(order.status)) {
      return c.json({ ok: false, error: `Can't release an order in '${order.status}'.` }, 400);
    }
    const results = await releaseToProviders(c, order);
    await db.setOrderStatus(c.env.DB, ref, "submitted", { notes: "Released to fulfilment: " + results.join("; ") });
    const fresh = await db.getOrder(c.env.DB, ref);
    let sent = {};
    if (fresh?.email) {
      const [subject, html, text] = mailer.orderReleased(enrichForEmail(fresh));
      sent = await mailer.send(c.env, fresh.email, subject, html, text);
    }
    return c.json({ ok: true, reference: ref, status: "submitted", fulfilment: results, email: sent });
  }

  if (action === "reject") {
    const reason = d.reason || "A design needs to be updated before we can print it.";
    await db.setOrderStatus(c.env.DB, ref, "awaiting_redo", { notes: `Rejected: ${reason}` });
    const resumeUrl = absUrl(c, c.env, `/resume/${order.resume_token}`);
    let sent = {};
    if (order.email) {
      const [subject, html, text] = mailer.designRedo(enrichForEmail(order), resumeUrl, reason);
      sent = await mailer.send(c.env, order.email, subject, html, text);
    }
    return c.json({ ok: true, reference: ref, status: "awaiting_redo", resume_url: resumeUrl, email: sent });
  }

  if (action === "refund") {
    const amount = order.total;
    let refundRes: any = { mode: "dev", note: "No Paystack key — refund simulated." };
    if (paystack.hasKeys(c.env)) {
      try {
        refundRes = await paystack.refund(c.env, ref, amount);
      } catch (exc) {
        return c.json({ ok: false, error: `Refund failed: ${(exc as Error).message}` }, 502);
      }
    }
    await db.setOrderStatus(c.env.DB, ref, "refunded", { notes: `Refunded ${amount} cents.` });
    let sent = {};
    if (order.email) {
      const [subject, html, text] = mailer.refundNotice(enrichForEmail(order), amount);
      sent = await mailer.send(c.env, order.email, subject, html, text);
    }
    return c.json({ ok: true, reference: ref, status: "refunded", refund: refundRes, email: sent });
  }

  return c.json({ ok: false, error: "Unknown action (release|reject|refund)." }, 400);
});

// --------------------------------------------------------------------------- //
// SA printer dashboard — ported 1:1 from app.py's printer_dashboard/
// printer_job_action/printer_job_csv. Guarded by PRINTER_KEY in production.
// --------------------------------------------------------------------------- //
app.get("/printer", async (c) => {
  if (!keyOk(c, c.env.PRINTER_KEY, "X-Printer-Key")) return c.text("Unauthorized — append ?key=YOUR_PRINTER_KEY", 401);
  const submittedOrders = await db.listOrders(c.env.DB, ["submitted", "in_production"], 100);
  const shippedOrders = await db.listOrders(c.env.DB, ["shipped", "delivered"], 20);
  const queue = submittedOrders.map(printerView).filter((v): v is PrinterJobView => v !== null);
  const done = shippedOrders.map(printerView).filter((v): v is PrinterJobView => v !== null);
  return c.html(<PrinterDashboardPage brandName={BRAND.name} queue={queue} done={done} printerKey={c.req.query("key") ?? ""} />);
});

app.post("/api/printer/job", async (c) => {
  if (!keyOk(c, c.env.PRINTER_KEY, "X-Printer-Key")) return c.json({ ok: false, error: "Unauthorized" }, 401);
  const d = await c.req.json<{ reference?: string; action?: string; tracking?: string }>().catch(() => ({}) as Record<string, never>);
  const ref = d.reference ?? "";
  const action = d.action ?? "";
  const order = await db.getOrder(c.env.DB, ref);
  if (!order) return c.json({ ok: false, error: "Order not found" }, 404);

  if (action === "accept") {
    if (order.status !== "submitted") {
      return c.json({ ok: false, error: `Can only accept a 'submitted' job (this is '${order.status}').` }, 400);
    }
    await db.setOrderStatus(c.env.DB, ref, "in_production", { notes: "Accepted by SA print shop." });
    return c.json({ ok: true, reference: ref, status: "in_production" });
  }

  if (action === "ship") {
    if (!["in_production", "submitted"].includes(order.status)) {
      return c.json({ ok: false, error: `Can't ship a job in '${order.status}'.` }, 400);
    }
    const tracking = (d.tracking ?? "").trim() || undefined;
    const note = "Shipped by SA print shop." + (tracking ? ` Tracking: ${tracking}` : "");
    await db.setOrderStatus(c.env.DB, ref, "shipped", { trackingUrl: tracking, notes: note });
    if (order.email) {
      const fullOrder = await db.getOrder(c.env.DB, ref);
      if (fullOrder) {
        const [subject, html, text] = mailer.orderShipped(fullOrder, tracking ?? "");
        await mailer.send(c.env, order.email, subject, html, text);
      }
    }
    return c.json({ ok: true, reference: ref, status: "shipped" });
  }

  return c.json({ ok: false, error: "Unknown action (accept|ship)." }, 400);
});

app.get("/printer/job/:filename", async (c) => {
  if (!keyOk(c, c.env.PRINTER_KEY, "X-Printer-Key")) return c.text("Unauthorized", 401);
  const filename = c.req.param("filename");
  if (!filename.endsWith(".csv")) return c.notFound();
  const reference = filename.slice(0, -".csv".length);
  const order = await db.getOrder(c.env.DB, reference);
  if (!order) return c.text("Order not found", 404);
  const v = printerView(order);
  if (!v) return c.text("No local-SA items in this order", 404);
  const addr = v.address;
  const addrStr = [addr.line1, addr.line2, addr.city, addr.province, addr.postal_code].filter(Boolean).join(", ");
  const csvEscape = (s: string) => (s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    ["Reference", "Customer", "Address", "Product", "Colour", "Size", "Qty", "Front print file", "Back print file"],
    ...v.items.map((it) => [reference, v.name, addrStr, it.product, it.colour, it.size, String(it.qty), it.front ?? "", it.back ?? ""]),
  ];
  const csv = rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(",")).join("\r\n");
  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="job-${reference}.csv"`);
  return c.body(csv);
});

app.get("/api/track/:reference", async (c) => {
  const reference = c.req.param("reference");
  const order = await db.getOrder(c.env.DB, reference);
  if (!order) return c.json({ ok: false, error: "Order not found" }, 404);
  return c.json({ ok: true, reference, status: order.status, tracking_url: order.tracking_url, gelato_order_id: order.gelato_order_id });
});

// Mirrors app.py's mimetype-by-extension via send_from_directory.
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
};

// Serve dev email previews (only when no real mail provider is configured).
// Ported 1:1 from app.py's `outbox`.
app.get("/outbox/:fn", async (c) => {
  if (mailer.hasProvider(c.env)) return c.notFound();
  const fn = c.req.param("fn");
  let data: ArrayBuffer | null;
  try {
    data = await storage.openBytes(c.env, `outbox/${fn}`);
  } catch {
    return c.notFound();
  }
  if (!data) return c.notFound();
  c.header("Content-Type", "text/html");
  return c.body(data);
});

// Serve stored art / print files (Gelato fetches print files from here).
// Uses Hono's plain wildcard (`*`), NOT a regex-constrained param (`:x{...}`)
// — the latter previously crashed Hono's ENTIRE router, not just this route
// (see Phase 5d's printer-job-CSV fix). `key` can contain slashes (art/xyz.png).
app.get("/files/*", async (c) => {
  const key = c.req.path.replace(/^\/files\//, "");
  let data: ArrayBuffer | null;
  try {
    data = await storage.openBytes(c.env, key);
  } catch {
    return c.notFound();
  }
  if (!data) return c.notFound();
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  c.header("Content-Type", MIME_BY_EXT[ext] ?? "application/octet-stream");
  return c.body(data);
});

export default app;
