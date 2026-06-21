/* =============================================================
 *  Landing (v2) — cycling 3D garment showcase.
 *  Reuses the studio's Garment3D engine. Every ~6s a new garment
 *  glides in: it MATERIALISES (a slow blur+scale+fade reveal, "out of
 *  thin air") after a quick fade-out, so every transition is smooth.
 *  Most garments are clean BLANKS (colour + shape only); only one shirt
 *  in the rotation carries a print, using a curated set of cool designs.
 *  Models are preloaded + cached by the engine so shape swaps are instant.
 * ============================================================= */
(() => {
  "use strict";
  const G = window.Garment3D;
  const canvas = document.getElementById("garment3d");
  const stage = document.querySelector(".hero-stage");
  const capName = document.getElementById("capGarment");
  const capArt = document.getElementById("capDesign");
  if (!G || !canvas || !stage) return;

  // No WebGL → keep the instant poster tee on screen (it never fades out).
  if (!G.supported) { document.body.classList.add("no3d"); return; }

  // Our real garments (the 4 with 3D models). Crew Sweatshirt has no model yet.
  const GARMENTS = [
    { model: "/static/models/meshy_tee.glb",         name: "Classic Tee" },
    { model: "/static/models/meshy_tee_premium.glb", name: "Premium Tee" },
    { model: "/static/models/meshy_hoodie.glb",      name: "Heavyweight Hoodie" },
    { model: "/static/models/meshy_hoodie_zip.glb",  name: "Zip Hoodie" },
  ];
  // Garment colourways + refined, airy backdrops (the stage shifts to one each cycle).
  const COLOURS = ["#f4f3ef", "#1b1b1b", "#d9c9a8", "#a9b39a", "#bcc9d8", "#c87f63", "#6f7d8c"];
  //                off-white  charcoal   sand       sage       dusty-blue terracotta slate
  const BACKDROPS = ["#dcb6ae", "#aebfa6", "#aebfd2", "#cf9e84", "#d8c6a6", "#aeb2b0", "#c7b6cc"];
  //                 blush      sage       sky        clay       sand       stone      lilac
  // The cool prints that ride the ONE printed shirt in the rotation (all others blank).
  const COOL_IDS = ["skull-2.jpg", "neon.jpg", "paint-splash.jpg", "dark-surreal.jpg",
                    "the-guardian.webp", "shamaan.jpg", "green-tides.jpg"];

  let designs = [], cool = [];
  let i = 0, timer = null, busy = false, curModel = null;
  const PERIOD = 6000;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setBackdrop = (hex) => document.documentElement.style.setProperty("--stage-bg", hex);

  async function showCombo(n) {
    if (busy) return;
    busy = true;
    const g = GARMENTS[Math.floor(n / 2) % GARMENTS.length];   // shape changes every other cycle
    const colour = COLOURS[n % COLOURS.length];
    // Only one shirt in the rotation is printed; the rest are clean blanks.
    const printed = (n % 4 === 2) && cool.length > 0;
    const design = printed ? cool[Math.floor(n / 4) % cool.length] : null;
    const needModel = g.model !== curModel;

    setBackdrop(BACKDROPS[n % BACKDROPS.length]);
    stage.classList.add("swapping");           // fade the current garment out (quick)
    await wait(360);
    try {
      G.setColor(colour);                        // recolour the shared texture first (no colour flash)
      if (needModel) { await G.load(g.model); curModel = g.model; }   // instant once cached
      G.setSide("front");
      await G.setArt("front", design ? design.url : null, { knockout: true });
      G.setAutoSpin(true);
    } catch (e) { /* a bad swap shouldn't stop the carousel */ }
    if (capName) capName.textContent = g.name;
    if (capArt) capArt.textContent = design ? design.title : "Blank canvas";
    requestAnimationFrame(() => stage.classList.remove("swapping"));  // materialise IN (slow reveal)
    busy = false;
  }

  const next = () => { i += 1; showCombo(i); };
  const startTimer = () => { if (!timer) timer = setInterval(next, PERIOD); };
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };

  async function boot() {
    G.init(canvas, {});
    G.lockPlacement(true);                            // drags spin; never move the print
    try {
      const r = await fetch("/api/designs");
      const d = await r.json();
      if (d.ok && Array.isArray(d.designs)) {
        designs = d.designs.map((x) => ({ url: x.url, title: x.title, id: x.id }));
        cool = designs.filter((x) => COOL_IDS.indexOf(x.id) !== -1);
        if (!cool.length) cool = designs.slice(0, 6);   // fallback: first few designs
      }
    } catch (e) { /* no library → garments still cycle, all blank */ }

    await showCombo(0);
    // first garment frame is up → cross-fade the instant poster out (2 rAFs = painted)
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("hero-ready")));
    startTimer();
    // Warm the cache with the other models so their first swap is instant + smooth.
    G.preload(GARMENTS.map((x) => x.model));

    // Pause the carousel while the visitor is inspecting a garment; resume after idle.
    let idle = null;
    const hold = () => { stopTimer(); if (idle) clearTimeout(idle); idle = setTimeout(startTimer, 6500); };
    canvas.addEventListener("pointerdown", hold);
    canvas.addEventListener("wheel", hold, { passive: true });
    // Don't animate/cycle in a background tab.
    document.addEventListener("visibilitychange", () => (document.hidden ? stopTimer() : startTimer()));
  }
  boot();
})();
