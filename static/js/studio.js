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

  const state = { product: null, color: null, colorCode: null, colorHex: null, size: null,
                  sizeCode: null, side: "front", qty: 1, design: null, is3D: false,
                  verdict: null, uid: null, artKey: null, designToken: null,
                  moderation: null, artFilename: null, libraryDesign: null,
                  art: { front: { key: null }, back: { key: null } } };

  // normalised placement of the art within the print area, PER SIDE. This IS the
  // object printfile.render_print_file() consumes → on-screen preview == 300-DPI print.
  const PLACEMENT = {
    front: { scale: 0.62, cx: 0.5, cy: 0.46, rotation: 0 },
    back:  { scale: 0.62, cx: 0.5, cy: 0.46, rotation: 0 },
  };
  const use3D = !!(window.Garment3D && window.Garment3D.supported);
  let engineOk = false;                                  // 3D engine actually initialised
  // A product is 3D only when it has its OWN model mapped — NO generic fallback, so an
  // un-modelled garment (e.g. the Bella tee for now) stays a clean 2D reference photo.
  const modelFor = (p) => (window.MODELS && window.MODELS[p.slug]) || null;

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
    xfField: $("#xfField"), xfSide: $("#xfSide"), xfW: $("#xfW"), xfH: $("#xfH"),
    xfR: $("#xfR"), xfReset: $("#xfReset"),
    designToggle: $("#designToggle"), designGrid: $("#designGrid"),
    modNote: $("#modNote"), rights: $("#rightsCheck"),
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

  // True for white / near-white garments that would vanish against the white stage.
  function isLightColor(hex) {
    const h = (hex || "").replace("#", "");
    if (h.length < 6) return false;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.78;   // perceived luminance
  }

  // Show the live 3D garment for modelled products; fall back to a clean 2D photo for
  // the rest. Drives canvas/placeholder visibility so switching products is seamless.
  function applyStageMode(p) {
    state.is3D = engineOk && !!modelFor(p);
    const canvas = document.getElementById("garment3d");
    const ph = document.querySelector(".stage__placeholder");
    const soon = document.getElementById("comingSoon");
    if (state.is3D) {
      if (canvas) canvas.style.display = "";
      if (ph) ph.style.display = "none";
      if (soon) soon.hidden = true;
      if (els.overlay) els.overlay.style.display = "none";
      window.Garment3D.load(modelFor(p))
        .then(() => { if (state.colorHex) window.Garment3D.setColor(state.colorHex); })
        .catch((e) => console.warn("[studio] model load failed", e));
    } else {
      // No 3D model for this product yet → clean "coming soon" state. NEVER show the hero
      // mockups (the olive "YOUR DESIGN HERE" hoodie etc. are landing-page art only).
      if (canvas) canvas.style.display = "none";
      if (ph) ph.style.display = "none";
      if (soon) { soon.hidden = false; const n = soon.querySelector(".soon-name"); if (n) n.textContent = p.name; }
    }
  }

  // ---- product ---------------------------------------------------------- //
  function selectProduct(p) {
    state.product = p;
    els.name.textContent = p.name;
    els.price.innerHTML = "R" + p.price;
    els.blurb.textContent = p.blurb + (p.fabric ? `  ·  ${p.fabric}${p.gsm ? ", " + p.gsm + "gsm" : ""}` : "");
    if (els.ref && p.ref_image) els.ref.src = p.ref_image;
    applyStageMode(p);
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
    state.color = c.name; state.colorCode = c.gelato_code; state.colorHex = c.hex;
    els.colorVal.textContent = c.name;
    const dv = $("#dockColorVal"); if (dv) dv.textContent = c.name;   // mobile dock caption
    if (node) { $$("#swatches .swatch").forEach((s) => s.classList.remove("on")); node.classList.add("on"); }
    const stage = $("#stage");
    if (stage) {
      stage.style.setProperty("--garment", c.hex);
      // pale garments disappear on the white stage → swap to a soft grey backdrop so they read
      stage.classList.toggle("garment-light", isLightColor(c.hex));
    }
    if (state.is3D) window.Garment3D.setColor(c.hex);
    buildUid();
  }
  function selectSize(sz, node) {
    state.size = sz.label; state.sizeCode = sz.gelato_code;
    els.sizeVal.textContent = sz.label;
    if (sz.retail && els.price) els.price.innerHTML = "R" + sz.retail;
    if (node) { $$("#sizes .size").forEach((s) => s.classList.remove("on")); node.classList.add("on"); }
    else { $$("#sizes .size").forEach((s) => s.classList.toggle("on", s.dataset.size === sz.label)); }
    buildUid();
  }

  // ---- side toggle ------------------------------------------------------ //
  $$(".side-toggle button").forEach((b) => b.addEventListener("click", () => {
    state.side = b.dataset.side;
    $$(".side-toggle button").forEach((x) => x.classList.toggle("on", x === b));
    $("#stageNote").textContent = (state.side === "back" ? "Back print" : "Front print") + " · live preview";
    if (state.is3D) window.Garment3D.setSide(state.side);
    refreshTransform();
  }));

  // ---- quantity --------------------------------------------------------- //
  $("#qtyMinus").addEventListener("click", () => { state.qty = Math.max(1, state.qty - 1); els.qtyVal.textContent = state.qty; });
  $("#qtyPlus").addEventListener("click", () => { state.qty = Math.min(99, state.qty + 1); els.qtyVal.textContent = state.qty; });

  // ---- upload + validation (REAL) --------------------------------------- //
  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast("Please upload an image file."); return; }
    state.artFilename = file.name || "";   // used by the server-side IP screen
    state.libraryDesign = null;            // this is a user upload, not a library pick

    const localURL = URL.createObjectURL(file);
    if (state.is3D) { window.Garment3D.setArt(state.side, localURL); }
    else { els.overlay.src = localURL; els.overlay.style.display = "block"; }
    state.design = file;
    state.art[state.side].has = true;
    const _img = new Image();
    _img.onload = () => {
      state.art[state.side].aspect = (_img.naturalWidth / _img.naturalHeight) || 1;
      initTransform(state.side, state.art[state.side].aspect);
    };
    _img.src = localURL;

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
        state.artKey = d.art_key;        // server-side key for print-file generation
        state.art[state.side].key = d.art_key;
        state.moderation = d.moderation || null;
        showValidation(d.verdict, d.message, d);
        showModeration(state.moderation);
        if (state.verdict !== "fail") remindOriginality();
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
    updateGate();
  }
  function verdictLabel(v) {
    return v === "pass" ? "Looks great" : v === "warn" ? "Usable — heads up" : "Too low-res";
  }

  // ---- content / IP moderation ------------------------------------------ //
  function showModeration(mod) {
    const el = els.modNote;
    if (!el) { updateGate(); return; }
    // We no longer show the customer a "pending review" state — the originality
    // pop-up covers consent and the backend review happens invisibly in escrow.
    // Only an explicit hard block (a real detector) surfaces here.
    if (!mod || mod.status !== "blocked") { el.hidden = true; updateGate(); return; }
    el.hidden = false;
    el.className = "modnote blocked";
    el.innerHTML = `<span class="ico">⨯</span><span><b>Can’t print this design.</b> ${mod.reason || ""}</span>`;
    updateGate();
  }

  // Add-to-cart needs the art to pass DPI (and not be hard-blocked by a detector).
  // Rights consent is handled by the originality pop-up at add time, NOT a gate —
  // so the customer never has to hunt for a checkbox or wait for approval.
  function updateGate() {
    let ok = true;
    if (state.artKey) {
      ok = state.verdict !== "fail"
        && (!state.moderation || state.moderation.status !== "blocked");
    }
    els.addBtn.disabled = !ok;
  }

  els.drop.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", (e) => handleFile(e.target.files[0]));
  ["dragover", "dragenter"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("drag"); }));
  els.drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  // ---- originality reminder pop-up (replaces the inline rights checkbox) - //
  // Shown once when art lands; acknowledging it IS the rights confirmation, so
  // the customer proceeds straight to pay. The real check happens in escrow.
  const ipModal = $("#ipModal");
  let _ipAgreeCb = null;
  function rightsConfirmed() {
    return !!state.rightsAck || !!(els.rights && els.rights.checked);
  }
  function showIpModal(onAgree) { _ipAgreeCb = onAgree || null; if (ipModal) ipModal.hidden = false; }
  function hideIpModal() { if (ipModal) ipModal.hidden = true; _ipAgreeCb = null; }
  function remindOriginality() { if (!state.rightsAck) showIpModal(null); }
  const _ipAgree = $("#ipAgree"), _ipCancel = $("#ipCancel");
  if (_ipAgree) _ipAgree.addEventListener("click", () => {
    state.rightsAck = true;
    if (els.rights) els.rights.checked = true;     // keep the backend payload happy
    const cb = _ipAgreeCb; hideIpModal(); updateGate();
    if (cb) cb();
  });
  if (_ipCancel) _ipCancel.addEventListener("click", hideIpModal);
  if (ipModal) ipModal.addEventListener("click", (e) => { if (e.target === ipModal) hideIpModal(); });
  if (els.rights) els.rights.addEventListener("change", updateGate);

  // ---- actions (wired to swap-in API contract) -------------------------- //
  // Persist the current configuration as a design; returns the API response so
  // both "Save design" and "Add to cart" share one code path.
  function saveDesign() {
    return fetch("/api/save-design", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: state.product?.slug, color: state.color, color_code: state.colorCode,
        size: state.size, size_code: state.sizeCode, side: state.side,
        art_key: state.art.front.key, art_key_back: state.art.back.key,
        placement: PLACEMENT.front, placement_back: PLACEMENT.back,
        rights_confirmed: rightsConfirmed(),
        art_filename: state.artFilename, library_design: state.libraryDesign,
      }),
    }).then((r) => r.json()).then((d) => {
      if (d.ok) {
        state.designToken = d.design_token;
        if (d.moderation) { state.moderation = d.moderation; showModeration(d.moderation); }
      }
      return d;
    });
  }

  els.saveBtn.addEventListener("click", () => {
    toast("Saving design…");
    saveDesign().then((d) => {
      toast(d.ok ? (d.printfile_front_url ? "Design saved — print file ready." : "Design saved.")
                 : (d.error || "Save failed."));
    }).catch(() => toast("Save failed — please try again."));
  });

  function doAddToCart() {
    els.addBtn.disabled = true;
    toast("Adding to cart…");
    saveDesign().then((d) => {
      els.addBtn.disabled = false;
      if (!d.ok) { toast(d.error || "Couldn't add to cart."); return; }
      Cart.add({
        token: d.design_token, slug: state.product.slug, name: state.product.name,
        color: state.color, size: state.size, qty: state.qty,
        unit_price: d.unit_price_cents || 0,
        preview: d.preview_url || (state.art.front.key ? "/files/" + state.art.front.key : null),
      });
      toast(`Added: ${state.product.name} · ${state.color} · ${state.size} ×${state.qty}`);
    }).catch(() => { els.addBtn.disabled = false; toast("Couldn't add to cart."); });
  }

  els.addBtn.addEventListener("click", () => {
    if (els.addBtn.disabled) return;
    // First add with art on the garment → show the originality reminder, then add.
    if (state.artKey && !rightsConfirmed()) { showIpModal(doAddToCart); return; }
    doAddToCart();
  });

  // ---- free transform (width / height / rotate) ------------------------- //
  const AREA_RATIO = (window.Garment3D && window.Garment3D.areaRatio) || (0.26 / 0.345);
  function aspectFitScaleY(s, aspect) {
    return Math.min(1, Math.max(0.08, (PLACEMENT[s].scale || 0.62) * AREA_RATIO / (aspect || 1)));
  }
  function initTransform(s) {
    // Land the art filling the shirt's full print WIDTH, aspect preserved, centred.
    // No manual scale — the person just drags it on the garment to position it.
    const p = PLACEMENT[s];
    p.scale = 1.0; p.scale_y = null; p.cx = 0.5; p.cy = 0.46; p.rotation = 0;
    if (state.is3D) window.Garment3D.setPlacement(s, p);
    refreshTransform();
  }
  function refreshTransform() {
    // The manual width/height/rotate panel is gone — art auto-fills the width and
    // is positioned by dragging it directly on the garment. Keep the panel hidden.
    if (els.xfField) els.xfField.style.display = "none";
  }
  function applyTransform() {
    const p = PLACEMENT[state.side];
    p.scale = (+els.xfW.value) / 100;
    p.scale_y = (+els.xfH.value) / 100;
    p.rotation = +els.xfR.value;
    if (state.is3D) window.Garment3D.setPlacement(state.side, p);
  }
  [els.xfW, els.xfH, els.xfR].forEach((el) => el && el.addEventListener("input", applyTransform));
  if (els.xfReset) els.xfReset.addEventListener("click", () => {
    const a = (state.art[state.side] || {}).aspect || 1, p = PLACEMENT[state.side];
    p.scale = 0.62; p.cx = 0.5; p.cy = 0.46; p.rotation = 0;
    p.scale_y = aspectFitScaleY(state.side, a);
    if (state.is3D) window.Garment3D.setPlacement(state.side, p);
    refreshTransform();
  });

  // ---- ready-made design library ---------------------------------------- //
  function applyArtSuccess(side, url, d) {
    if (state.is3D) window.Garment3D.setArt(side, url);
    else { els.overlay.src = url; els.overlay.style.display = "block"; }
    state.verdict = d.verdict; state.artKey = d.art_key;
    state.art[side].key = d.art_key; state.art[side].has = true;
    state.moderation = d.moderation || null;       // curated library → approved
    state.libraryDesign = d.library_design || null;
    state.artFilename = null;
    showValidation(d.verdict, d.message, d);
    showModeration(state.moderation);
    // Curated library art is ours — rights are fine, so no originality reminder.
    state.rightsAck = true;
    if (els.rights) els.rights.checked = true;
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { state.art[side].aspect = (img.naturalWidth / img.naturalHeight) || 1; initTransform(side, state.art[side].aspect); };
    img.src = url;
  }
  function pickDesign(id) {
    toast("Loading design…");
    fetch("/api/use-design", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design: id, side: state.side }) })
      .then((r) => r.json()).then((d) => {
        if (!d.ok) { toast(d.error || "Couldn't load that design."); return; }
        applyArtSuccess(state.side, d.url, d);
      }).catch(() => toast("Couldn't load design — please try again."));
  }
  let _designsLoaded = false;
  function loadDesigns() {
    fetch("/api/designs").then((r) => r.json()).then((d) => {
      const grid = els.designGrid; if (!grid) return;
      if (!d.ok || !(d.designs && d.designs.length)) {
        grid.innerHTML = '<p class="muted">No designs yet — the templates you add to data/designs/ will show up here.</p>';
        return;
      }
      grid.innerHTML = "";
      d.designs.forEach((g) => {
        const b = document.createElement("button");
        b.className = "design-thumb"; b.title = g.title;
        b.style.backgroundImage = `url("${g.url}")`;
        b.addEventListener("click", () => pickDesign(g.id));
        grid.appendChild(b);
      });
    }).catch(() => {});
  }
  if (els.designToggle) els.designToggle.addEventListener("click", () => {
    const grid = els.designGrid; if (!grid) return;
    grid.hidden = !grid.hidden;
    if (!grid.hidden && !_designsLoaded) { _designsLoaded = true; loadDesigns(); }
  });

  // ---- boot ------------------------------------------------------------- //
  if (use3D) {
    engineOk = window.Garment3D.init(document.getElementById("garment3d"),
      { onPlacement: (s, p) => { PLACEMENT[s] = p; if (s === state.side) refreshTransform(); } });
    // Stage visibility (3D canvas vs 2D photo) is set per-product by applyStageMode.
  }
  if (PRODUCTS.length) selectProduct(PRODUCTS[0]);
  $$("#productTabs button").forEach((b) =>
    b.addEventListener("click", () => selectProduct(PRODUCTS.find((p) => p.slug === b.dataset.slug))));

  // ---- mobile colour dock ----------------------------------------------- //
  // On phones, move the colour swatches onto the bottom of the garment stage so
  // the palette is visible WITH the garment (tap a colour → see it change). The
  // SAME #swatches node moves, so selection/sync logic is untouched. Desktop
  // keeps the swatches in the panel.
  (() => {
    const dock = $("#stageDock");
    const colourField = els.swatches && els.swatches.closest(".field");
    if (!dock || !els.swatches || !colourField) return;
    const mq = window.matchMedia("(max-width: 900px)");
    function place() {
      if (mq.matches) {
        if (els.swatches.parentNode !== dock) dock.appendChild(els.swatches);
        dock.hidden = false;
        colourField.style.display = "none";
      } else {
        if (els.swatches.parentNode !== colourField) colourField.appendChild(els.swatches);
        dock.hidden = true;
        colourField.style.display = "";
      }
    }
    mq.addEventListener ? mq.addEventListener("change", place) : mq.addListener(place);
    place();
  })();

  // ---- mobile: product picker + specs ABOVE the garment ----------------- //
  // On phones, lift the type tabs + name/price/blurb above the shirt so you pick
  // the garment first, then see it. Mirrors the colour-dock relocation; the SAME
  // nodes move (IDs/handlers intact). Desktop keeps them at the top of the panel.
  (() => {
    const studio = document.querySelector(".studio");
    const stage = document.getElementById("stage");
    const panel = document.querySelector(".panel");
    const tabsEl = document.getElementById("productTabs");
    const infoEl = document.getElementById("pName");
    const tabsField = tabsEl ? tabsEl.closest(".field") : null;
    const infoBlock = infoEl ? infoEl.parentNode : null;
    if (!studio || !stage || !panel || !tabsField || !infoBlock) return;
    let slot = null;
    const mq = window.matchMedia("(max-width: 900px)");
    function place() {
      if (mq.matches) {
        if (!slot) { slot = document.createElement("div"); slot.className = "prodhead-mobile"; }
        if (slot.parentNode !== studio) studio.insertBefore(slot, stage);
        if (tabsField.parentNode !== slot) slot.appendChild(tabsField);
        if (infoBlock.parentNode !== slot) slot.appendChild(infoBlock);
      } else {
        if (infoBlock.parentNode !== panel) panel.insertBefore(infoBlock, panel.firstChild);
        if (tabsField.parentNode !== panel) panel.insertBefore(tabsField, panel.firstChild);
        if (slot && slot.parentNode) slot.parentNode.removeChild(slot);
      }
    }
    mq.addEventListener ? mq.addEventListener("change", place) : mq.addListener(place);
    place();
  })();

  // ===================== CART + CHECKOUT ================================ //
  // localStorage-backed cart -> /api/shipping-quote (preview) -> /api/checkout
  // (Paystack redirect, or a dev "simulate payment" link when no key is set).
  const Cart = (() => {
    const KEY = "yds_cart_v1";
    let items = [];
    try { items = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (_) { items = []; }
    const persist = () => localStorage.setItem(KEY, JSON.stringify(items));
    const fmt = (c) => "R" + (Math.round(c) / 100).toFixed(2);
    const count = () => items.reduce((n, it) => n + it.qty, 0);
    const subtotal = () => items.reduce((s, it) => s + it.unit_price * it.qty, 0);

    const ov = $("#cartOverlay"), cartPane = $("#cartPane"), coPane = $("#checkoutPane");
    const listEl = $("#cartItems"), emptyEl = $("#cartEmpty"), subEl = $("#cartSubtotal");
    const toCheckout = $("#toCheckout"), badge = $("#cartCount");
    const sumSub = $("#coSub"), sumShip = $("#coShip"), sumTot = $("#coTotal"),
          shipNote = $("#coShipNote"), payBtn = $("#payBtn");

    const syncBadge = () => { if (badge) badge.textContent = count(); };

    function add(line) {
      const ex = items.find((i) => i.token === line.token);
      if (ex) ex.qty += line.qty; else items.push({ ...line });
      persist(); syncBadge(); render();
    }
    function remove(token) { items = items.filter((i) => i.token !== token); persist(); syncBadge(); render(); }
    function setQty(token, q) {
      const it = items.find((i) => i.token === token); if (!it) return;
      it.qty = Math.max(1, q); persist(); syncBadge(); render();
    }

    function render() {
      if (!listEl) return;
      listEl.innerHTML = "";
      items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "cart-row";
        row.innerHTML =
          `<div class="cart-th" style="background-image:url('${it.preview || ""}')"></div>
           <div class="cart-meta"><div class="cart-name">${it.name || ""}</div>
             <div class="cart-vary">${it.color || ""} · ${it.size || ""}${it.review ? ' · <i>in review</i>' : ""}</div>
             <div class="cart-q"><button data-d="-1" aria-label="Less">–</button><span>${it.qty}</span>` +
          `<button data-d="1" aria-label="More">+</button><button class="cart-rm" data-rm>Remove</button></div></div>
           <div class="cart-line">${fmt(it.unit_price * it.qty)}</div>`;
        row.querySelector('[data-d="-1"]').onclick = () => setQty(it.token, it.qty - 1);
        row.querySelector('[data-d="1"]').onclick = () => setQty(it.token, it.qty + 1);
        row.querySelector("[data-rm]").onclick = () => remove(it.token);
        listEl.appendChild(row);
      });
      if (emptyEl) emptyEl.style.display = items.length ? "none" : "block";
      if (subEl) subEl.textContent = fmt(subtotal());
      if (toCheckout) toCheckout.disabled = !items.length;
    }

    const showCart = () => { if (cartPane) cartPane.hidden = false; if (coPane) coPane.hidden = true; };
    function open() { if (!ov) return; ov.hidden = false; document.body.style.overflow = "hidden"; showCart(); render(); }
    function close() { if (!ov) return; ov.hidden = true; document.body.style.overflow = ""; }
    function showCheckout() { if (!items.length) return; if (cartPane) cartPane.hidden = true; if (coPane) coPane.hidden = false; quote(); }

    function quote() {
      if (!sumSub) return;
      sumSub.textContent = fmt(subtotal()); sumShip.textContent = "…"; sumTot.textContent = "…";
      if (payBtn) payBtn.disabled = true;
      fetch("/api/shipping-quote", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: items.map((i) => ({ design_token: i.token, quantity: i.qty })) }) })
        .then((r) => r.json()).then((d) => {
          if (!d.ok) { if (shipNote) shipNote.textContent = d.error || "Couldn't price shipping."; return; }
          sumSub.textContent = fmt(d.subtotal);
          sumShip.textContent = d.shipping.amount_cents === 0 ? "FREE" : fmt(d.shipping.amount_cents);
          sumTot.textContent = fmt(d.total);
          if (shipNote) shipNote.textContent = d.shipping.label || "";
          if (payBtn) { payBtn.textContent = "Pay " + fmt(d.total); payBtn.disabled = false; }
        }).catch(() => { if (shipNote) shipNote.textContent = "Couldn't price shipping — try again."; });
    }

    function pay() {
      const v = (id) => { const e = $("#" + id); return e ? e.value.trim() : ""; };
      const email = v("coEmail");
      if (!email || email.indexOf("@") < 1) { toast("Please enter a valid email."); return; }
      const addr = { name: v("coName"), phone: v("coPhone"), address1: v("coAddr"),
        city: v("coCity"), province: v("coProv"), postal_code: v("coPostal"), country: "ZA" };
      if (payBtn) { payBtn.disabled = true; payBtn.textContent = "Starting secure payment…"; }
      fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: v("coName"), shipping: addr,
          items: items.map((i) => ({ design_token: i.token, quantity: i.qty })) }) })
        .then((r) => r.json()).then((d) => {
          if (!d.ok) { toast(d.error || "Checkout failed."); if (payBtn) payBtn.disabled = false; quote(); return; }
          localStorage.removeItem(KEY);   // handed off to payment — clear the cart
          if (d.mode === "paystack" && d.authorization_url) location.href = d.authorization_url;
          else if (d.pay_url) location.href = d.pay_url;   // dev simulate
          else location.href = "/checkout/callback?reference=" + encodeURIComponent(d.reference);
        }).catch(() => { toast("Checkout failed — please try again."); if (payBtn) payBtn.disabled = false; });
    }

    const on = (sel, ev, fn) => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
    on("#cartBtn", "click", open);
    on("#cartClose", "click", close);
    on("#checkoutBack", "click", showCart);
    on("#toCheckout", "click", showCheckout);
    on("#payBtn", "click", pay);
    if (ov) ov.addEventListener("click", (e) => { if (e.target === ov) close(); });

    syncBadge(); render();
    return { add, open };
  })();
})();
