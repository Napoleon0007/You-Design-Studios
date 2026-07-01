/** Ported 1:1 from templates/printer_dashboard.html. */

export interface PrinterJobItem {
  product: string;
  colour: string;
  size: string;
  qty: number;
  provider: string;
  front: string | null;
  back: string | null;
  preview: string | null;
}
export interface PrinterJobView {
  reference: string;
  status: string;
  created_at: number | null;
  name: string;
  address: Record<string, string | undefined>;
  items: PrinterJobItem[];
  units: number;
  tracking_url: string | null;
}

export function PrinterDashboardPage(props: {
  brandName: string;
  queue: PrinterJobView[];
  done: PrinterJobView[];
  printerKey: string;
}) {
  const { brandName, queue, done, printerKey } = props;
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>SA Printer Dashboard — {brandName}</title>
        <link rel="icon" type="image/svg+xml" href="/static/v2/favicon.svg" />
        <style>{`
    :root{ --ink:#18181a; --muted:#6b6b66; --line:#e9e8e3; --paper:#fff;
      --bg:#f4f3ef; --accent:#18181a; --ok:#1f7a4d; --warn:#b4791f; --ship:#2563c9; }
    *{ margin:0; padding:0; box-sizing:border-box; }
    body{ font-family:"Archivo",system-ui,-apple-system,sans-serif; color:var(--ink);
      background:var(--bg); -webkit-font-smoothing:antialiased; line-height:1.45; }
    a{ color:inherit; }
    .wrap{ max-width:1080px; margin:0 auto; padding:18px clamp(14px,4vw,28px) 80px; }
    header.top{ display:flex; align-items:center; gap:14px; flex-wrap:wrap;
      padding:14px 0 18px; border-bottom:1px solid var(--line); margin-bottom:22px; }
    .brand{ font-weight:800; letter-spacing:.06em; text-transform:uppercase; font-size:18px; display:flex; gap:9px; align-items:center; }
    .brand .mark{ width:22px; height:22px; }
    .brand small{ font-weight:600; letter-spacing:.14em; color:var(--muted); font-size:11px; }
    .count{ margin-left:auto; font-size:13px; color:var(--muted); }
    .count b{ color:var(--ink); font-size:22px; font-weight:800; }
    h2{ font-size:13px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted);
      margin:26px 0 12px; font-weight:700; }
    .empty{ background:var(--paper); border:1px dashed var(--line); border-radius:14px;
      padding:34px 20px; text-align:center; color:var(--muted); font-size:14px; }
    .job{ background:var(--paper); border:1px solid var(--line); border-radius:16px;
      padding:16px 16px 14px; margin-bottom:14px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
    .job__head{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
    .ref{ font-weight:800; letter-spacing:.02em; }
    .date{ color:var(--muted); font-size:12.5px; }
    .badge{ font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
      padding:4px 9px; border-radius:100px; }
    .badge.submitted{ background:#fff3df; color:var(--warn); }
    .badge.in_production{ background:#e8f1ff; color:var(--ship); }
    .badge.shipped,.badge.delivered{ background:#e5f4ec; color:var(--ok); }
    .units{ margin-left:auto; font-size:12.5px; color:var(--muted); }
    .job__grid{ display:grid; grid-template-columns:1fr; gap:14px; }
    @media(min-width:720px){ .job__grid{ grid-template-columns:1.4fr 1fr; } }
    .ship-to{ font-size:13.5px; }
    .ship-to .lbl{ font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
    .ship-to .name{ font-weight:700; }
    .ship-to .addr{ color:#444; white-space:pre-line; }
    table.lines{ width:100%; border-collapse:collapse; font-size:13.5px; }
    table.lines th{ text-align:left; font-size:10.5px; letter-spacing:.1em; text-transform:uppercase;
      color:var(--muted); font-weight:700; padding:0 8px 6px 0; border-bottom:1px solid var(--line); }
    table.lines td{ padding:8px 8px 8px 0; border-bottom:1px solid var(--line); vertical-align:top; }
    .prov{ font-size:10px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); }
    .prov.local-sa{ color:var(--ok); font-weight:700; }
    .files{ display:flex; gap:6px; flex-wrap:wrap; }
    .file{ display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700;
      padding:5px 9px; border-radius:8px; border:1px solid var(--line); background:#fafaf8; }
    .file:hover{ border-color:#c9c8c2; }
    .file.none{ color:#bbb; border-style:dashed; pointer-events:none; }
    .job__actions{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:14px;
      padding-top:13px; border-top:1px solid var(--line); }
    .btn{ font:inherit; font-weight:700; font-size:13px; letter-spacing:.02em; border:0; cursor:pointer;
      padding:11px 16px; border-radius:10px; min-height:44px; }
    .btn.primary{ background:var(--accent); color:#fff; }
    .btn.ghost{ background:#fff; border:1px solid var(--line); color:var(--ink); }
    .btn:disabled{ opacity:.5; cursor:default; }
    .track{ font:inherit; font-size:13px; padding:10px 12px; border:1px solid var(--line);
      border-radius:10px; min-height:44px; flex:1 1 160px; min-width:140px; }
    .msg{ font-size:12.5px; margin-left:auto; }
    .msg.err{ color:#c0392b; } .msg.ok{ color:var(--ok); }
    .job__tools{ display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
    .tool-link{ display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:700;
      letter-spacing:.04em; padding:7px 11px; border-radius:8px; border:1px solid var(--line);
      background:#fafaf8; color:var(--ink); text-decoration:none; cursor:pointer; min-height:36px; }
    .tool-link:hover{ border-color:#b0afa9; background:#fff; }
    .tool-link.copied{ color:var(--ok); border-color:var(--ok); }
    .done .job{ opacity:.72; }
    footer{ margin-top:40px; color:var(--muted); font-size:12px; text-align:center; }
        `}</style>
      </head>
      <body>
        <div class="wrap">
          <header class="top">
            <span class="brand">
              <svg class="mark" viewBox="0 0 100 100" fill="none" aria-hidden="true">
                <rect x="9" y="9" width="82" height="82" rx="22" stroke="currentColor" stroke-width="7" />
                <rect x="30" y="31" width="40" height="10.5" rx="2" fill="currentColor" />
                <rect x="44.75" y="31" width="10.5" height="40" rx="2" fill="currentColor" />
                <rect x="55" y="46" width="15.5" height="9.5" rx="2" fill="currentColor" />
              </svg>
              {brandName} <small>SA PRINTER DASHBOARD</small>
            </span>
            <span class="count">
              <b>{queue.length}</b> job{queue.length === 1 ? "" : "s"} to print
            </span>
          </header>

          <h2>To print &amp; ship</h2>
          {!queue.length ? (
            <div class="empty">No jobs waiting. Released orders routed for local SA fulfilment appear here.</div>
          ) : null}
          {queue.map((o) => {
            const a = o.address ?? {};
            const addrLine1 = a.line1 || a.address || a.street || "";
            return (
              <div class="job" data-ref={o.reference}>
                <div class="job__head">
                  <span class="ref">{o.reference}</span>
                  <span class="date">{o.created_at}</span>
                  <span class={`badge ${o.status}`}>{o.status.replace(/_/g, " ")}</span>
                  <span class="units">
                    {o.units} item{o.units === 1 ? "" : "s"}
                  </span>
                </div>
                <div class="job__grid">
                  <div>
                    <table class="lines">
                      <thead>
                        <tr>
                          <th>Garment</th>
                          <th>Colour</th>
                          <th>Size</th>
                          <th>Qty</th>
                          <th>Print files</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.items.map((it) => (
                          <tr>
                            <td>
                              {it.product}
                              <br />
                              <span class={`prov ${it.provider}`}>{it.provider}</span>
                            </td>
                            <td>{it.colour}</td>
                            <td>{it.size}</td>
                            <td>{it.qty}</td>
                            <td>
                              <div class="files">
                                {it.front ? (
                                  <a class="file" href={it.front} target="_blank" rel="noopener">
                                    ⬇ Front
                                  </a>
                                ) : (
                                  <span class="file none">No front</span>
                                )}
                                {it.back ? (
                                  <a class="file" href={it.back} target="_blank" rel="noopener">
                                    ⬇ Back
                                  </a>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div class="ship-to">
                    <div class="lbl">Ship to</div>
                    <div class="name">{o.name}</div>
                    <div class="addr">
                      {addrLine1}
                      {"\n"}
                      {a.line2 || ""}
                      {"\n"}
                      {a.city || ""}
                      {a.postal_code || a.postcode || a.zip
                        ? `, ${a.postal_code || a.postcode || a.zip}`
                        : ""}
                      {"\n"}
                      {a.province || a.state || ""}
                      {"\n"}
                      {a.country || "South Africa"}
                      {a.phone ? `\n☎ ${a.phone}` : ""}
                    </div>
                  </div>
                </div>
                <div class="job__tools">
                  <a
                    class="tool-link"
                    href={`/printer/job/${o.reference}.csv${printerKey ? `?key=${printerKey}` : ""}`}
                    download
                  >
                    ↓ CSV
                  </a>
                  <button
                    class="tool-link wa-copy"
                    data-ref={o.reference}
                    data-name={o.name}
                    data-addr={[a.line1, a.city, a.postal_code, a.province].filter(Boolean).join(", ")}
                    data-items={o.items.map((it) => `${it.qty}× ${it.product} (${it.colour}, ${it.size})`).join(" | ")}
                    data-front={o.items.map((it) => it.front || "").join("")}
                  >
                    WhatsApp
                  </button>
                </div>
                <div class="job__actions">
                  {o.status === "submitted" ? (
                    <button class="btn primary" data-act="accept">
                      Accept job
                    </button>
                  ) : (
                    <>
                      <input class="track" type="text" placeholder="Tracking number (optional)" />
                      <button class="btn primary" data-act="ship">
                        Mark shipped
                      </button>
                    </>
                  )}
                  <span class="msg"></span>
                </div>
              </div>
            );
          })}

          {done.length ? (
            <>
              <h2>Recently shipped</h2>
              <div class="done">
                {done.map((o) => (
                  <div class="job">
                    <div class="job__head">
                      <span class="ref">{o.reference}</span>
                      <span class={`badge ${o.status}`}>{o.status}</span>
                      <span class="units">
                        {o.units} item{o.units === 1 ? "" : "s"} · {o.name}
                      </span>
                      {o.tracking_url ? <span class="date">tracking: {o.tracking_url}</span> : null}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <footer>{brandName} · local-SA fulfilment portal · print files are 300&nbsp;DPI, transparent PNG</footer>
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `
var KEY = ${JSON.stringify(printerKey)};

document.querySelectorAll(".job__actions").forEach(function (bar) {
  var card = bar.closest(".job"), ref = card.getAttribute("data-ref");
  var msg = bar.querySelector(".msg");
  bar.querySelectorAll("button[data-act]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var act = btn.getAttribute("data-act");
      var trackEl = bar.querySelector(".track");
      btn.disabled = true; msg.className = "msg"; msg.textContent = "…";
      var url = "/api/printer/job" + (KEY ? "?key=" + encodeURIComponent(KEY) : "");
      fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Printer-Key": KEY || "" },
        body: JSON.stringify({ reference: ref, action: act, tracking: trackEl ? trackEl.value : "" })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok) { msg.className = "msg ok"; msg.textContent = "✓ " + d.status.replace("_", " ");
          setTimeout(function () { location.reload(); }, 700); }
        else { msg.className = "msg err"; msg.textContent = d.error || "Failed"; btn.disabled = false; }
      }).catch(function () { msg.className = "msg err"; msg.textContent = "Network error"; btn.disabled = false; });
    });
  });
});

document.querySelectorAll(".wa-copy").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var ref = btn.dataset.ref, name = btn.dataset.name,
        addr = btn.dataset.addr, items = btn.dataset.items,
        front = btn.dataset.front;
    var msg = "Hi, new print job from TRUEF Studios.\\n\\n"
      + "Ref: " + ref + "\\n"
      + "Customer: " + name + "\\n"
      + (addr ? "Ship to: " + addr + "\\n" : "")
      + "\\nItems:\\n" + items.split("|").map(function(s){ return "  " + s.trim(); }).join("\\n")
      + (front ? "\\n\\nPrint file(s):\\n" + front : "")
      + "\\n\\nPlease confirm receipt.";
    navigator.clipboard.writeText(msg).then(function () {
      btn.textContent = "Copied!"; btn.classList.add("copied");
      setTimeout(function () { btn.textContent = "WhatsApp"; btn.classList.remove("copied"); }, 2000);
    });
  });
});
            `,
          }}
        />
      </body>
    </html>
  );
}
