/** Ported 1:1 from templates/admin_moderation.html. */
import type { Design } from "../lib/db";

export function AdminModerationPage(props: {
  brandName: string;
  pending: Design[];
  blocked: Design[];
  adminKey: string;
}) {
  const { brandName, pending, blocked, adminKey } = props;
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Moderation · {brandName}</title>
        <style>{`
    :root { --bg:#0e0f12; --card:#17191e; --line:#2a2d35; --ink:#eceef2; --dim:#9aa0ab;
            --ok:#46c37b; --bad:#e5604d; --warn:#e6b450; }
    * { box-sizing:border-box; }
    body { margin:0; font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
    header { padding:20px 24px; border-bottom:1px solid var(--line); display:flex; align-items:baseline; gap:14px; }
    header h1 { font-size:18px; margin:0; } header .dim { color:var(--dim); font-size:13px; }
    .wrap { padding:24px; max-width:1100px; margin:0 auto; }
    h2 { font-size:14px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); margin:28px 0 12px; }
    .empty { color:var(--dim); padding:18px; border:1px dashed var(--line); border-radius:12px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:16px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
    .card .art { height:200px; background:#fff center/contain no-repeat; }
    .card .body { padding:14px; }
    .card .title { font-weight:600; text-transform:capitalize; }
    .card .meta { color:var(--dim); font-size:13px; margin-top:4px; }
    .card .reason { font-size:12.5px; color:var(--warn); margin-top:8px; }
    .row { display:flex; gap:8px; margin-top:14px; }
    button { flex:1; padding:10px; border-radius:9px; border:0; font-weight:600; cursor:pointer; font-size:13px; }
    .approve { background:var(--ok); color:#06210f; } .block { background:var(--bad); color:#2a0b07; }
    .card.gone { opacity:.4; pointer-events:none; }
    .blocked .art { filter:grayscale(1); }
        `}</style>
      </head>
      <body>
        <header>
          <h1>{brandName} — Moderation</h1>
          <span class="dim">
            {pending.length} pending · {blocked.length} blocked
          </span>
        </header>
        <div class="wrap">
          <h2>Pending review ({pending.length})</h2>
          {!pending.length ? <div class="empty">Nothing waiting. 🎉</div> : null}
          <div class="grid">
            {pending.map((d) => (
              <div class="card" id={`card-${d.token}`}>
                <div class="art" style={`background-image:url('${d.preview_url || `/files/${d.art_key}`}')`}></div>
                <div class="body">
                  <div class="title">{d.product_slug.replace(/-/g, " ")}</div>
                  <div class="meta">
                    {d.color || ""}
                    {d.size ? ` · ${d.size}` : ""}
                  </div>
                  {d.moderation_reason ? <div class="reason">{d.moderation_reason}</div> : null}
                  <div class="row">
                    <button class="approve" onclick={`moderate('${d.token}','approve')`}>
                      Approve
                    </button>
                    <button class="block" onclick={`moderate('${d.token}','block')`}>
                      Block
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {blocked.length ? (
            <>
              <h2>Recently blocked ({blocked.length})</h2>
              <div class="grid">
                {blocked.map((d) => (
                  <div class="card blocked" id={`card-${d.token}`}>
                    <div class="art" style={`background-image:url('${d.preview_url || `/files/${d.art_key}`}')`}></div>
                    <div class="body">
                      <div class="title">{d.product_slug.replace(/-/g, " ")}</div>
                      {d.moderation_reason ? <div class="reason">{d.moderation_reason}</div> : null}
                      <div class="row">
                        <button class="approve" onclick={`moderate('${d.token}','approve')`}>
                          Approve anyway
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <script
          dangerouslySetInnerHTML={{
            __html: `
const ADMIN_KEY = ${JSON.stringify(adminKey)};
function moderate(token, action) {
  fetch("/api/admin/moderate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
    body: JSON.stringify({ token, action })
  }).then(r => r.json()).then(d => {
    const card = document.getElementById("card-" + token);
    if (d.ok && card) { card.classList.add("gone"); }
    else if (!d.ok) { alert(d.error || "Failed"); }
  }).catch(() => alert("Request failed"));
}
            `,
          }}
        />
      </body>
    </html>
  );
}
