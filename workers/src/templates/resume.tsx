/** Ported 1:1 from templates/resume.html. */
import type { Order, OrderItem } from "../lib/db";

export function ResumePage(props: {
  brandName: string;
  order: Order | null;
  token: string;
  held?: OrderItem[];
}) {
  const { brandName, order, token, held } = props;
  const targets = order ? (held?.length ? held : order.items ?? []) : [];
  const t = targets[0];

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Update your design · {brandName}</title>
        <style>{`
    :root { --ink:#111; --dim:#666; --line:#e8e8e6; --accent:#e8472b; --ok:#1c8c4c; --bad:#c0392b; }
    * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    body { margin:0; background:#f4f4f2; color:var(--ink);
           font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;
           padding:max(16px,env(safe-area-inset-top)) 14px max(24px,env(safe-area-inset-bottom)); }
    .card { max-width:460px; margin:18px auto; background:#fff; border-radius:18px;
            box-shadow:0 2px 22px rgba(0,0,0,.06); overflow:hidden; }
    .hd { background:#111; color:#fff; padding:15px 20px; font-weight:700; }
    .body { padding:20px; }
    h1 { font-size:20px; margin:0 0 6px; } p { margin:0 0 12px; color:#333; }
    .dim { color:var(--dim); font-size:14px; }
    .held { display:flex; gap:12px; align-items:center; background:#faf7f5; border:1px solid var(--line);
            border-radius:12px; padding:12px; margin:12px 0; }
    .held .th { width:52px; height:52px; border-radius:9px; background:#fff center/contain no-repeat; flex:none; border:1px solid var(--line); }
    .held .nm { font-weight:600; text-transform:capitalize; }
    .reason { color:var(--accent); font-size:13px; margin-top:2px; }
    .tabs { display:flex; gap:8px; margin:16px 0 10px; }
    .tab { flex:1; padding:10px; border:1px solid var(--line); border-radius:10px; background:#fff;
           font-weight:600; font-size:14px; cursor:pointer; text-align:center; }
    .tab.on { background:#111; color:#fff; border-color:#111; }
    .drop { border:2px dashed #d6d6d2; border-radius:14px; padding:26px 16px; text-align:center;
            color:var(--dim); cursor:pointer; } .drop.drag { border-color:var(--accent); background:#fff7f5; }
    .lib { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; max-height:240px; overflow:auto; }
    .lib img { width:100%; aspect-ratio:1; object-fit:contain; background:#faf7f5; border:1px solid var(--line);
               border-radius:10px; padding:5px; cursor:pointer; }
    .lib img.sel { outline:2px solid var(--accent); }
    .preview { display:none; text-align:center; margin:12px 0; }
    .preview img { max-height:180px; max-width:100%; border:1px solid var(--line); border-radius:10px; background:#faf7f5; }
    .note { font-size:13px; padding:10px 12px; border-radius:10px; margin:10px 0; display:none; }
    .note.ok { background:rgba(28,140,76,.1); color:var(--ok); display:block; }
    .note.bad { background:rgba(192,57,43,.1); color:var(--bad); display:block; }
    .rights { display:flex; gap:9px; align-items:flex-start; font-size:13.5px; color:#333; margin:14px 0; }
    .rights input { margin-top:3px; width:18px; height:18px; flex:none; }
    .btn { display:block; width:100%; text-align:center; background:#111; color:#fff; border:0;
           font:600 16px/1 inherit; padding:16px; border-radius:12px; cursor:pointer; }
    .btn:disabled { opacity:.4; cursor:not-allowed; }
    .done { text-align:center; padding:10px 0; } .done .big { font-size:42px; }
        `}</style>
      </head>
      <body>
        <div class="card">
          <div class="hd">{brandName}</div>
          <div class="body">
            {!order ? (
              <>
                <h1>This link has expired</h1>
                <p class="dim">We couldn't find an order for this link. If you think this is a mistake, just reply to our email.</p>
              </>
            ) : (
              <>
                <div id="form">
                  <h1>Update your design</h1>
                  <p class="dim">
                    Order <b>{order.reference}</b> — your payment is safe and held. Swap in a new design below and
                    we'll print it right away.
                  </p>

                  <div class="held">
                    <div
                      class="th"
                      style={`background-image:url('${t?.art_key && !t?.preview_url ? `/files/${t.art_key}` : t?.preview_url ?? ""}')`}
                    ></div>
                    <div>
                      <div class="nm">
                        {t?.product_name} · {t?.color ?? ""} {t?.size ?? ""}
                      </div>
                      <div class="reason">{t?.moderation_reason || order.notes || "Needs a printable design."}</div>
                    </div>
                  </div>

                  <div class="tabs">
                    <div class="tab on" id="tab-up" onclick="setTab('up')">
                      Upload yours
                    </div>
                    <div class="tab" id="tab-lib" onclick="setTab('lib')">
                      Browse designs
                    </div>
                  </div>

                  <div id="pane-up">
                    <div class="drop" id="drop">
                      Tap to upload, or drop an image here
                      <br />
                      <span class="dim">PNG, JPG or WEBP</span>
                    </div>
                    <input type="file" id="file" accept="image/png,image/jpeg,image/webp" hidden />
                  </div>
                  <div id="pane-lib" style="display:none">
                    <div class="lib" id="lib"></div>
                  </div>

                  <div class="preview" id="preview">
                    <img id="previewImg" alt="" />
                  </div>
                  <div class="note" id="note"></div>

                  <label class="rights">
                    <input type="checkbox" id="rights" />
                    <span>
                      I own this artwork or have the rights to print it. I understand we can't print copyrighted,
                      trademarked or celebrity content.
                    </span>
                  </label>

                  <button class="btn" id="submit" disabled onclick="submitDesign()">
                    Submit new design
                  </button>
                </div>

                <div id="thanks" style="display:none">
                  <div class="done">
                    <div class="big">✓</div>
                    <h1>Got it — thank you!</h1>
                    <p class="dim">
                      Your new design is in. We'll give it a quick check and get order <b>{order.reference}</b>{" "}
                      printing. Watch your inbox.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {order ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `
const TOKEN = ${JSON.stringify(token)};
const ITEM_ID = ${JSON.stringify(t?.id ?? null)};
const LINE = { slug: ${JSON.stringify(t?.product_slug ?? "")}, color: ${JSON.stringify(t?.color ?? "")},
               color_code: ${JSON.stringify(t?.color_code ?? "")}, size: ${JSON.stringify(t?.size ?? "")},
               size_code: ${JSON.stringify(t?.size_code ?? "")} };
const PLACEMENT = { scale:0.62, cx:0.5, cy:0.46, scale_y:0.5, rotation:0 };
const state = { artKey:null, ok:false, filename:null, library:null };
const $ = (id) => document.getElementById(id);

function setTab(which) {
  $("tab-up").classList.toggle("on", which==="up");
  $("tab-lib").classList.toggle("on", which==="lib");
  $("pane-up").style.display = which==="up" ? "" : "none";
  $("pane-lib").style.display = which==="lib" ? "" : "none";
  if (which==="lib") loadLib();
}

function note(kind, msg) { const n=$("note"); n.className="note "+kind; n.textContent=msg; }
function gate() {
  $("submit").disabled = !(state.artKey && state.ok && $("rights").checked);
}
$("rights").addEventListener("change", gate);

function showPreview(url) { $("previewImg").src = url; $("preview").style.display="block"; }
function applyVerdict(d, url) {
  state.artKey = d.art_key; state.filename = d.filename || null;
  const mod = d.moderation || {};
  if (d.verdict === "fail") { state.ok=false; note("bad", d.message || "That image is too low-resolution to print."); }
  else if (mod.status === "blocked") { state.ok=false; note("bad", mod.reason || "We can't print this design."); }
  else { state.ok=true; note("ok", "Looks great — ready to go."); }
  if (url) showPreview(url);
  gate();
}

$("drop").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (e) => handleFile(e.target.files[0]));
["dragover","dragenter"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.add("drag"); }));
["dragleave","drop"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.remove("drag"); }));
$("drop").addEventListener("drop", e => handleFile(e.dataTransfer.files[0]));
function handleFile(file) {
  if (!file) return;
  state.library = null;
  const fd = new FormData(); fd.append("design", file);
  note("ok", "Checking your image…");
  fetch("/api/validate-image", { method:"POST", body:fd })
    .then(r => r.json()).then(d => {
      if (!d.ok) { note("bad", d.error || "Couldn't read that file."); return; }
      d.filename = file.name;
      applyVerdict(d, URL.createObjectURL(file));
    }).catch(() => note("bad", "Upload failed — please try again."));
}

let libLoaded = false;
function loadLib() {
  if (libLoaded) return; libLoaded = true;
  fetch("/api/designs").then(r=>r.json()).then(d => {
    const box = $("lib");
    (d.designs||[]).forEach(it => {
      const img = document.createElement("img");
      img.src = it.url; img.alt = it.title; img.title = it.title;
      img.onclick = () => pickLib(it, img);
      box.appendChild(img);
    });
    if (!(d.designs||[]).length) box.innerHTML = '<p class="dim">No ready-made designs yet.</p>';
  });
}
function pickLib(it, img) {
  document.querySelectorAll("#lib img").forEach(i => i.classList.remove("sel"));
  img.classList.add("sel");
  state.library = it.id;
  note("ok", "Loading design…");
  fetch("/api/use-design", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ design: it.id }) })
    .then(r=>r.json()).then(d => {
      if (!d.ok) { note("bad", d.error || "Couldn't load that design."); return; }
      applyVerdict(d, d.url || it.url);
    }).catch(() => note("bad", "Couldn't load that design."));
}

function submitDesign() {
  $("submit").disabled = true; note("ok", "Saving your design…");
  fetch("/api/save-design", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      slug: LINE.slug, color: LINE.color, color_code: LINE.color_code,
      size: LINE.size, size_code: LINE.size_code, side:"front",
      art_key: state.artKey, placement: PLACEMENT,
      rights_confirmed: $("rights").checked,
      art_filename: state.filename, library_design: state.library }) })
  .then(r=>r.json()).then(d => {
    if (!d.ok) { note("bad", d.error || "Save failed."); $("submit").disabled=false; return; }
    return fetch("/api/resume/"+encodeURIComponent(TOKEN)+"/swap", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ design_token: d.design_token, item_id: ITEM_ID }) })
      .then(r=>r.json()).then(s => {
        if (!s.ok) { note("bad", s.error || "Couldn't update your order."); $("submit").disabled=false; return; }
        $("form").style.display="none"; $("thanks").style.display="block";
        window.scrollTo(0,0);
      });
  }).catch(() => { note("bad", "Something went wrong — please try again."); $("submit").disabled=false; });
}
              `,
            }}
          />
        ) : null}
      </body>
    </html>
  );
}
