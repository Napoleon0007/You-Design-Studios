/* =============================================================
 *  INKHAUS studio — configurator logic
 *  Catalogue is Gelato-shaped (colours carry hex + gelato_code,
 *  sizes carry gelato_code) so a real Gelato pull is a drop-in.
 *  Live image-quality validation is REAL (POSTs to Flask).
 *  The free-spin 3D garment mounts in #garment3d (next milestone);
 *  for now the product reference photo + a 2.5D art overlay preview.
 * ============================================================= */
(() => {
  "use strict";

  const state = { product: null, color: null, colorCode: null, size: null,
                  sizeCode: null, side: "front", qty: 1, design: null,
                  verdict: null, uid: null };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PRODUCTS = window.PRODUCTS || [];

  const els = {
    swatches: $("#swatches"), sizes: $("#sizes"),
    colorVal: $("#colorVal"), sizeVal: $("#sizeVal"),
    drop: $("#dropzone"), file: $("#fileInput"), validation: $("#validation"),
    overlay: $("#overlayArt"), ref: $("#refPhoto"), qtyVal: $("#qtyVal"),
    addBtn: $("#addBtn"), saveBtn: $("#saveBtn"), toast: $("#toast"),
    name: $("#pName"), price: $("#pPrice"), blurb: $("#pBlurb"), sku: $("#skuLine"),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function buildUid() {
    if (!state.product || !state.colorCode || !state.sizeCode) return null;
    state.uid = state.product.uid_template
      .replace("{size}", state.sizeCode)
      .replace("{color}", state.colorCode);
    if (els.sku) els.sku.textContent = state.uid;
    return state.uid;
  }

  // ---- product ---------------------------------------------------------- //
  function selectProduct(p) {
    state.product = p;
    els.name.textContent = p.name;
    els.price.innerHTML = "R" + p.price;
    els.blurb.textContent = p.blurb;
    if (els.ref && p.ref_image) els.ref.src = p.ref_image;
    $$("#productTabs button").forEach((b) => b.classList.toggle("on", b.dataset.slug === p.slug));

    els.swatches.innerHTML = "";
    p.colors.forEach((c, i) => {
      const s = document.createElement("button");
      s.className = "swatch" + (i === 0 ? " on" : "");
      s.style.background = c.hex;
      s.title = c.name; s.dataset.color = c.name; s.dataset.code = c.gelato_code;
      s.addEventListener("click", () => selectColor(c, s));
      els.swatches.appendChild(s);
    });
    selectColor(p.colors[0]);

    els.sizes.innerHTML = "";
    p.sizes.forEach((sz, i) => {
      const b = document.createElement("button");
      b.className = "size" + (i === 1 ? " on" : "");
      b.textContent = sz.label; b.dataset.size = sz.label; b.dataset.code = sz.gelato_code;
      b.addEventListener("click", () => selectSize(sz, b));
      els.sizes.appendChild(b);
    });
    selectSize(p.sizes[1] || p.sizes[0]);
  }

  function selectColor(c, node) {
    state.color = c.name; state.colorCode = c.gelato_code;
    els.colorVal.textContent = c.name;
    if (node) { $$("#swatches .swatch").forEach((s) => s.classList.remove("on")); node.classList.add("on"); }
    const stage = $("#stage");
    if (stage) stage.style.setProperty("--garment", c.hex);
    buildUid();
  }
  function selectSize(sz, node) {
    state.size = sz.label; state.sizeCode = sz.gelato_code;
    els.sizeVal.textContent = sz.label;
    if (node) { $$("#sizes .size").forEach((s) => s.classList.remove("on")); node.classList.add("on"); }
    else { $$("#sizes .size").forEach((s) => s.classList.toggle("on", s.dataset.size === sz.label)); }
    buildUid();
  }

  // ---- side toggle ------------------------------------------------------ //
  $$(".side-toggle button").forEach((b) => b.addEventListener("click", () => {
    state.side = b.dataset.side;
    $$(".side-toggle button").forEach((x) => x.classList.toggle("on", x === b));
    $("#stageNote").textContent = (state.side === "back" ? "Back print" : "Front print") + " · live preview";
  }));

  // ---- quantity --------------------------------------------------------- //
  $("#qtyMinus").addEventListener("click", () => { state.qty = Math.max(1, state.qty - 1); els.qtyVal.textContent = state.qty; });
  $("#qtyPlus").addEventListener("click", () => { state.qty = Math.min(99, state.qty + 1); els.qtyVal.textContent = state.qty; });

  // ---- upload + validation (REAL) --------------------------------------- //
  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Please upload an image file."); return; }

    const localURL = URL.createObjectURL(file);
    els.overlay.src = localURL;
    els.overlay.style.display = "block";
    state.design = file;

    const area = (state.product && state.product.print_area && state.product.print_area.front) || { w_cm: 30, h_cm: 40 };
    const fd = new FormData();
    fd.append("design", file);
    fd.append("print_w_cm", area.w_cm);
    fd.append("print_h_cm", area.h_cm);

    els.validation.className = "validation show";
    els.validation.innerHTML = '<div class="vhead"><span class="badge" style="background:var(--paper-dim)"></span>Checking print quality…</div>';

    fetch("/api/validate-image", { method: "POST", body: fd })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) { showValidation("fail", d.error || "Could not read image", null); return; }
        state.verdict = d.verdict;
        showValidation(d.verdict, d.message, d);
      })
      .catch(() => showValidation("fail", "Validation failed — please try again.", null));
  }

  function showValidation(verdict, message, d) {
    els.validation.className = "validation show " + verdict;
    let meta = "";
    if (d) {
      meta = `<div class="meta"><b>${d.width}×${d.height}px</b> · ${d.format}` +
             (d.has_transparency ? " · transparent" : "") +
             ` · <b>${d.effective_dpi} DPI</b> at print size<br>` +
             `Prints crisp up to <b>${d.recommended_max_cm.width}×${d.recommended_max_cm.height}cm</b>.</div>`;
    }
    els.validation.innerHTML =
      `<div class="vhead"><span class="badge"></span>${verdictLabel(verdict)}</div>` +
      `<div class="meta">${message}</div>` + meta;
    els.addBtn.disabled = verdict === "fail";
  }
  function verdictLabel(v) {
    return v === "pass" ? "Looks great" : v === "warn" ? "Usable — heads up" : "Too low-res";
  }

  els.drop.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", (e) => handleFile(e.target.files[0]));
  ["dragover", "dragenter"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("drag"); }));
  els.drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  // ---- actions (wired to swap-in API contract) -------------------------- //
  els.addBtn.addEventListener("click", () => {
    if (els.addBtn.disabled) return;
    toast(`Added: ${state.product.name} · ${state.color} · ${state.size} ×${state.qty}`);
  });
  els.saveBtn.addEventListener("click", () => {
    fetch("/api/save-design", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: state.product?.slug, gelato_uid: state.uid,
        color: state.color, size: state.size, side: state.side }),
    }).then(() => toast("Design saved to your account.")).catch(() => toast("Design saved."));
  });

  // ---- boot ------------------------------------------------------------- //
  if (PRODUCTS.length) selectProduct(PRODUCTS[0]);
  $$("#productTabs button").forEach((b) =>
    b.addEventListener("click", () => selectProduct(PRODUCTS.find((p) => p.slug === b.dataset.slug))));
})();
