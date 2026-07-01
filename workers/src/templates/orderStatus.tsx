/** Ported 1:1 from templates/order_status.html. */
import type { Order } from "../lib/db";

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function OrderStatusPage(props: {
  brandName: string;
  order: Order | null;
  reference: string;
  step: number;
  terminal?: boolean;
}) {
  const { brandName, order, reference, step, terminal } = props;
  const labels = ["Received", "Approved", "Printing", "Shipped", "Delivered"];
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Order Status · {brandName}</title>
        <style>{`
    :root { --ink:#111; --dim:#666; --line:#e8e8e6; --accent:#b78a2e; --ok:#1c8c4c; --warn:#b8860b; }
    * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    body { margin:0; background:#f4f4f2; color:var(--ink);
           font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;
           padding:max(20px,env(safe-area-inset-top)) 16px max(32px,env(safe-area-inset-bottom)); }
    .card { max-width:440px; margin:24px auto; background:#fff; border-radius:18px;
            box-shadow:0 2px 22px rgba(0,0,0,.06); overflow:hidden; }
    .hd { background:#111; color:#fff; padding:16px 22px; font-weight:700; letter-spacing:.3px; }
    .body { padding:24px 22px; }
    h1 { font-size:20px; margin:0 0 4px; }
    .ref { font-family:ui-monospace,Menlo,monospace; font-size:13px;
           background:#f4f4f2; padding:2px 8px; border-radius:6px; color:var(--dim); }
    .track { display:flex; align-items:flex-start; margin:24px 0 20px; gap:0; }
    .step  { flex:1; text-align:center; position:relative; }
    .step:not(:last-child)::after {
      content:""; position:absolute; top:12px; left:50%; width:100%;
      height:2px; background:var(--line); z-index:0; }
    .step.done:not(:last-child)::after  { background:var(--accent); }
    .dot { width:24px; height:24px; border-radius:50%; border:2px solid var(--line);
           background:#fff; margin:0 auto 6px; position:relative; z-index:1;
           display:flex; align-items:center; justify-content:center; font-size:11px; }
    .step.done .dot  { background:var(--accent); border-color:var(--accent); color:#fff; }
    .step.active .dot { border-color:var(--accent); box-shadow:0 0 0 3px rgba(183,138,46,.18); }
    .step-label { font-size:10px; color:var(--dim); line-height:1.3; }
    .step.done .step-label, .step.active .step-label { color:var(--ink); font-weight:600; }
    .items { border-top:1px solid var(--line); margin-top:4px; padding-top:14px; }
    .item  { display:flex; gap:10px; padding:8px 0; border-bottom:1px solid var(--line); font-size:14px; }
    .item:last-child { border-bottom:none; }
    .item-meta { color:var(--dim); font-size:13px; }
    .track-btn { display:block; text-align:center; text-decoration:none;
                 background:var(--accent); color:#fff; font-weight:600;
                 padding:14px; border-radius:12px; margin-top:20px; font-size:15px; }
    .btn-ghost { display:block; text-align:center; text-decoration:none;
                 border:1.5px solid var(--line); color:var(--ink); font-weight:500;
                 padding:13px; border-radius:12px; margin-top:10px; font-size:15px; }
    .terminal { text-align:center; padding:12px 0 4px; }
    .terminal .badge { display:inline-block; background:#fdecea; color:#c0392b;
                       border-radius:8px; padding:6px 14px; font-size:14px; font-weight:600; }
        `}</style>
      </head>
      <body>
        <div class="card">
          <div class="hd">{brandName}</div>
          <div class="body">
            {!order ? (
              <>
                <h1>Order not found</h1>
                <p style="color:var(--dim)">
                  We couldn't find order <span class="ref">{reference}</span>. Check the link in your confirmation
                  email.
                </p>
                <a class="btn-ghost" href="/">
                  Back to the store
                </a>
              </>
            ) : terminal ? (
              <>
                <h1>Order {capitalize(order.status)}</h1>
                <p style="color:var(--dim)">
                  Reference: <span class="ref">{order.reference}</span>
                </p>
                <div class="terminal">
                  <span class="badge">{order.status.toUpperCase()}</span>
                </div>
                {order.notes ? <p style="font-size:14px;color:var(--dim);margin-top:12px">{order.notes}</p> : null}
                <a class="btn-ghost" href="/">
                  Back to the store
                </a>
              </>
            ) : (
              <>
                <h1>Order status</h1>
                <p style="margin:2px 0 0;color:var(--dim);font-size:14px">
                  <span class="ref">{order.reference}</span>
                </p>

                <div class="track">
                  {labels.map((label, i) => (
                    <div class={`step ${step > i ? "done" : step === i ? "active" : ""}`}>
                      <div class="dot">{step > i ? "✓" : ""}</div>
                      <div class="step-label">{label}</div>
                    </div>
                  ))}
                </div>

                {order.items?.length ? (
                  <div class="items">
                    {order.items.map((it) => (
                      <div class="item">
                        <div>
                          <div>{it.product_name || "Item"}</div>
                          <div class="item-meta">
                            {it.color || "—"} · {it.size || "—"} · Qty {it.quantity || 1}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {order.tracking_url ? (
                  <a class="track-btn" href={order.tracking_url} target="_blank" rel="noopener">
                    Track my delivery →
                  </a>
                ) : step >= 4 ? (
                  <p style="margin-top:16px;font-size:14px;color:var(--dim)">
                    Your order has shipped — tracking will appear here shortly.
                  </p>
                ) : null}

                <a class="btn-ghost" href="/studio">
                  Design another
                </a>
              </>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
