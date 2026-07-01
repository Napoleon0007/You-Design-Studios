/**
 * mailer.ts — transactional email, ported 1:1 from mailer.py.
 * Two modes (env-driven, no code change to go live):
 *   RESEND_API_KEY set  -> sends for real via Resend (fetch, not urllib).
 *   not set (dev)       -> writes the rendered email to R2 under outbox/ and
 *                          returns its /outbox URL (mirrors the old data/outbox/
 *                          local-disk preview — needs the FILES R2 binding).
 */
import * as storage from "./storage";
import type { StorageEnv } from "./storage";

export interface MailerEnv extends StorageEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

const BRAND_NAME = "The TRUeF Studios";
const BRAND_COLOR = "#0a0a0a";
const ACCENT = "#ff5a1f";

export function mailFrom(env: MailerEnv): string {
  return (env.MAIL_FROM ?? `${BRAND_NAME} <onboarding@resend.dev>`).trim();
}

export function hasProvider(env: MailerEnv): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export function isLive(env: MailerEnv): boolean {
  return hasProvider(env);
}

export interface SendResult {
  ok: boolean;
  provider?: string;
  id?: string | null;
  to?: string;
  subject?: string;
  preview_url?: string;
  error?: string;
}

async function resendSend(env: MailerEnv, to: string, subject: string, htmlBody: string, text: string): Promise<SendResult> {
  const key = (env.RESEND_API_KEY ?? "").trim();
  const body = JSON.stringify({ from: mailFrom(env), to: [to], subject, html: htmlBody, text });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, provider: "resend", to, error: `Resend ${res.status}: ${detail}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider: "resend", id: data.id ?? null, to };
  } catch (e) {
    return { ok: false, provider: "resend", to, error: `Network error reaching Resend: ${(e as Error).message}` };
  }
}

function slug(s: string): string {
  return (s || "email")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "email";
}

/** Matches Python's html.escape(s, quote=True) exactly, including &#x27; (hex) for apostrophe. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/** Write the email to R2 under outbox/ and return its previewable path. */
async function devPreview(env: MailerEnv, to: string, subject: string, htmlBody: string): Promise<SendResult> {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const fn = `${stamp}_${slug(to)}_${slug(subject)}.html`;
  const banner =
    `<div style="background:#fffbe6;border-bottom:1px solid #f0e0a0;` +
    `padding:8px 12px;font:12px/1.4 -apple-system,sans-serif;color:#7a6a1a">` +
    `DEV PREVIEW — not actually sent. To: <b>${escapeHtml(to)}</b> · ` +
    `Subject: <b>${escapeHtml(subject)}</b>. Set RESEND_API_KEY to send for real.` +
    `</div>`;
  const key = `outbox/${fn}`;
  await storage.put(env, new TextEncoder().encode(banner + htmlBody), key);
  return { ok: true, provider: "dev-preview", to, subject, preview_url: `/outbox/${fn}` };
}

/** Dispatch one email. Real send if RESEND_API_KEY is set, else dev preview.
 * Never throws — returns {ok, provider, ...} so the order flow can't be broken
 * by an email hiccup (matches mailer.py's contract exactly: resendSend/devPreview
 * already catch their own transport errors, but devPreview's R2 write can throw
 * before R2 is enabled on the account — caught here too, so that pre-R2 gap
 * degrades to a clean {ok:false} instead of crashing the caller). */
export async function send(env: MailerEnv, to: string, subject: string, htmlBody: string, text?: string): Promise<SendResult> {
  if (!to) return { ok: false, error: "no recipient" };
  const plainText = text ?? htmlBody.replace(/<[^>]+>/g, "");
  try {
    if (hasProvider(env)) return await resendSend(env, to, subject, htmlBody, plainText);
    return await devPreview(env, to, subject, htmlBody);
  } catch (e) {
    return { ok: false, to, error: (e as Error).message };
  }
}

// --------------------------------------------------------------- rendering --- //
function money(cents: number, currency: string = "R"): string {
  return `${currency}${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shell(title: string, intro: string, opts?: { rowsHtml?: string; cta?: [string, string]; footer?: string }): string {
  let btn = "";
  if (opts?.cta) {
    const [label, url] = opts.cta;
    btn =
      `<tr><td style="padding:8px 0 4px"><a href="${escapeHtml(url)}" ` +
      `style="display:block;background:${ACCENT};color:#fff;text-decoration:none;` +
      `font:600 16px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;` +
      `padding:16px;border-radius:12px">${escapeHtml(label)}</a></td></tr>`;
  }
  const rows = opts?.rowsHtml ? `<tr><td style="padding:4px 0">${opts.rowsHtml}</td></tr>` : "";
  const foot = opts?.footer ?? `You're receiving this because you placed an order at ${BRAND_NAME}.`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f2;padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="background:#f4f4f2;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
 style="max-width:480px;background:#fff;border-radius:16px;overflow:hidden;
 box-shadow:0 2px 18px rgba(0,0,0,.06)">
 <tr><td style="background:${BRAND_COLOR};padding:18px 24px">
   <span style="color:#fff;font:700 18px/1 -apple-system,Segoe UI,Roboto,sans-serif;
   letter-spacing:.3px">${BRAND_NAME}</span></td></tr>
 <tr><td style="padding:24px 24px 8px">
   <h1 style="margin:0 0 8px;font:700 22px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;
   color:${BRAND_COLOR}">${escapeHtml(title)}</h1>
   <p style="margin:0;font:400 15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;
   color:#444">${intro}</p></td></tr>
 <tr><td style="padding:8px 24px 20px">
   <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${btn}</table>
 </td></tr>
 <tr><td style="padding:16px 24px 22px;border-top:1px solid #eee">
   <p style="margin:0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;
   color:#999">${foot}</p></td></tr>
</table></td></tr></table></body></html>`;
}

interface EmailOrderItem {
  product_name?: string | null;
  gelato_uid?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
}
interface EmailOrder {
  reference?: string | null;
  items?: EmailOrderItem[];
  subtotal?: number | null;
  shipping?: number | null;
  total?: number | null;
  name?: string | null;
  shipping_json?: string | null;
}

function itemsTable(order: EmailOrder, currency: string = "R"): string {
  const cells: string[] = [];
  for (const it of order.items ?? []) {
    const name = escapeHtml(String(it.product_name ?? it.gelato_uid ?? "Item"));
    const qty = it.quantity ?? 1;
    const line = (it.unit_price ?? 0) * qty;
    cells.push(
      `<tr><td style="padding:6px 0;font:400 14px/1.4 -apple-system,sans-serif;` +
        `color:#333">${name} <span style="color:#999">×${qty}</span></td>` +
        `<td align="right" style="padding:6px 0;font:600 14px/1.4 -apple-system,sans-serif;` +
        `color:#333;white-space:nowrap">${money(line, currency)}</td></tr>`
    );
  }
  const sub = order.subtotal ?? 0;
  const ship = order.shipping ?? 0;
  const total = order.total ?? sub + ship;
  const foot =
    `<tr><td colspan="2" style="border-top:1px solid #eee;padding-top:8px"></td></tr>` +
    `<tr><td style="padding:2px 0;font:400 13px/1.4 -apple-system,sans-serif;color:#777">Subtotal</td>` +
    `<td align="right" style="font:400 13px/1.4 -apple-system,sans-serif;color:#777">${money(sub, currency)}</td></tr>` +
    `<tr><td style="padding:2px 0;font:400 13px/1.4 -apple-system,sans-serif;color:#777">Shipping</td>` +
    `<td align="right" style="font:400 13px/1.4 -apple-system,sans-serif;color:#777">` +
    `${ship === 0 ? "FREE" : money(ship, currency)}</td></tr>` +
    `<tr><td style="padding:4px 0;font:700 15px/1.4 -apple-system,sans-serif;color:#111">Total</td>` +
    `<td align="right" style="font:700 15px/1.4 -apple-system,sans-serif;color:#111">${money(total, currency)}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells.join("")}${foot}</table>`;
}

export type EmailTemplate = [subject: string, html: string, text: string];

export function orderConfirmation(order: EmailOrder, currency: string = "R", statusUrl: string = ""): EmailTemplate {
  const ref = order.reference ?? "";
  const title = "Thanks — we've got your order";
  const intro = `Payment received. We're preparing your custom order <b>${escapeHtml(ref)}</b>. We'll email you the moment it's sent to print.`;
  const cta: [string, string] | undefined = statusUrl ? ["Track my order", statusUrl] : undefined;
  const html = shell(title, intro, { rowsHtml: itemsTable(order, currency), cta, footer: `Order ${escapeHtml(ref)} · ${BRAND_NAME}` });
  let text = `Payment received for order ${ref}. Total ${money(order.total ?? 0, currency)}.`;
  if (statusUrl) text += ` Track your order: ${statusUrl}`;
  return [`Order confirmed — ${ref}`, html, text];
}

/** Alert the SA print shop that a new job is ready to print. */
export function printerJobNotification(order: EmailOrder & { items?: (EmailOrderItem & { product_slug?: string | null; color?: string | null; size?: string | null; printfile_front_url?: string | null; printfile_back_url?: string | null })[] }, dashboardUrl: string, currency: string = "R"): EmailTemplate {
  const ref = order.reference ?? "";
  const name = order.name || "Customer";
  let addr: { line1?: string; line2?: string; city?: string; province?: string; postal_code?: string } = {};
  try {
    addr = JSON.parse(order.shipping_json || "{}") ?? {};
  } catch {
    addr = {};
  }

  let itemsHtml = "";
  for (const it of order.items ?? []) {
    const product = escapeHtml(String(it.product_name ?? it.product_slug ?? "Item"));
    const colour = escapeHtml(String(it.color ?? "—"));
    const size = escapeHtml(String(it.size ?? "—"));
    const qty = it.quantity ?? 1;
    const front = it.printfile_front_url ?? "";
    const back = it.printfile_back_url ?? "";
    itemsHtml += `<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b>${product}</b><br><span style="color:#666;font-size:13px">${colour} · ${size} · Qty ${qty}</span>`;
    if (front) itemsHtml += `<br><a href="${escapeHtml(front)}" style="color:#0066cc;font-size:13px">⬇ Front print file</a>`;
    if (back) itemsHtml += ` &nbsp;<a href="${escapeHtml(back)}" style="color:#0066cc;font-size:13px">⬇ Back print file</a>`;
    itemsHtml += `</td></tr>`;
  }

  const addrParts = [addr.line1 ?? "", addr.line2 ?? "", addr.city ?? "", addr.province ?? "", addr.postal_code ?? ""];
  const addrStr = addrParts.filter(Boolean).join(", ");

  const rowsHtml =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}` +
    `<tr><td style="padding:10px 0 4px;font:400 14px/1.5 -apple-system,sans-serif">` +
    `<b>Ship to:</b> ${escapeHtml(name)}${addrStr ? " — " + escapeHtml(addrStr) : ""}` +
    `</td></tr></table>`;

  const title = `New print job — ${ref}`;
  const intro = "A new order is ready to print. Accept the job in the dashboard, produce it, then mark it shipped with a tracking number.";
  const html = shell(title, intro, { rowsHtml, cta: ["Open Dashboard → Accept Job", dashboardUrl], footer: `Job ${escapeHtml(ref)} · TRUEF Studios printer portal` });
  const text = `New print job ${ref}.\nOpen the dashboard: ${dashboardUrl}\nShip to: ${name}${addrStr ? ", " + addrStr : ""}`;
  return [`New print job — ${ref}`, html, text];
}

export function designRedo(order: EmailOrder, resumeUrl: string, reason: string = "", currency: string = "R"): EmailTemplate {
  const ref = order.reference ?? "";
  const title = "One quick fix to your design";
  const why = reason ? ` Reason: ${escapeHtml(reason)}` : "";
  const intro = `We couldn't print one of your designs as-is — usually a rights/quality issue.${why} Your payment is safe and your order is held. Tap below to swap in a new design and we'll get it printed right away.`;
  const html = shell(title, intro, { rowsHtml: itemsTable(order, currency), cta: ["Fix my design", resumeUrl], footer: `Order ${escapeHtml(ref)} · this link is private to you.` });
  return [`Action needed: update your design — ${ref}`, html, `Update your design for order ${ref}: ${resumeUrl}`];
}

export function refundNotice(order: EmailOrder, amountCents: number, currency: string = "R"): EmailTemplate {
  const ref = order.reference ?? "";
  const title = "Your refund is on the way";
  const intro = `We've refunded <b>${money(amountCents, currency)}</b> for order <b>${escapeHtml(ref)}</b>. It usually lands back on your card within 5–10 working days, depending on your bank.`;
  const html = shell(title, intro, { footer: `Order ${escapeHtml(ref)} · ${BRAND_NAME}` });
  return [`Refund processed — ${ref}`, html, `Refunded ${money(amountCents, currency)} for order ${ref}.`];
}

export function orderReleased(order: EmailOrder, currency: string = "R"): EmailTemplate {
  const ref = order.reference ?? "";
  const title = "Your order is in production";
  const intro = `Good news — order <b>${escapeHtml(ref)}</b> has been approved and sent to print. We'll send tracking as soon as it ships.`;
  const html = shell(title, intro, { rowsHtml: itemsTable(order, currency), footer: `Order ${escapeHtml(ref)} · ${BRAND_NAME}` });
  return [`In production — ${ref}`, html, `Order ${ref} is in production.`];
}

export function passwordReset(name: string, resetUrl: string): EmailTemplate {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  const title = "Reset your password";
  const intro = `${greeting} we received a request to reset the password on your ${BRAND_NAME} account. Tap the button below — the link expires in 1 hour.`;
  const html = shell(title, intro, { cta: ["Reset my password", resetUrl], footer: "If you didn't request this, you can safely ignore this email." });
  const text = `Reset your ${BRAND_NAME} password: ${resetUrl}\nThis link expires in 1 hour.`;
  return ["Reset your password", html, text];
}

export function orderShipped(order: EmailOrder, trackingUrl: string = "", currency: string = "R"): EmailTemplate {
  const ref = order.reference ?? "";
  const title = "Your order is on its way";
  const intro = trackingUrl
    ? `Order <b>${escapeHtml(ref)}</b> has been shipped and is heading your way. Tap below to track your parcel.`
    : `Order <b>${escapeHtml(ref)}</b> has been shipped and is heading your way. You'll receive it within the next few business days.`;
  const cta: [string, string] | undefined = trackingUrl ? ["Track my parcel", trackingUrl] : undefined;
  const html = shell(title, intro, { rowsHtml: itemsTable(order, currency), cta, footer: `Order ${escapeHtml(ref)} · ${BRAND_NAME}` });
  let text = `Your TRUEF Studios order ${ref} has been shipped!`;
  if (trackingUrl) text += ` Track it here: ${trackingUrl}`;
  return [`Shipped — ${ref}`, html, text];
}
