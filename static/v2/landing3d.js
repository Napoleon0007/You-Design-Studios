/* =============================================================
 *  Landing (v2) — Lacoste-style cycling 3D garment showcase.
 *  Reuses the studio's Garment3D engine: loads a model, recolours it,
 *  prints a design on the chest, floats + auto-spins it (drag to spin,
 *  pinch to zoom). Every ~5s a new {garment + design + colour + backdrop}
 *  combo fades in and the whole stage shifts colour to match.
 * ============================================================= */
(() => {
  "use strict";
  const G = window.Garment3D;
  const canvas = document.getElementById("garment3d");
  const stage = document.querySelector(".hero-stage");
  const capName = document.getElementById("capGarment");
  const capArt = document.getElementById("capDesign");
  if (!G || !canvas || !stage) return;

  // No WebGL → fall back to the people videos (CSS reveals the fallback poster).
  if (!G.supported) { document.body.classList.add("no3d"); return; }

  // Our real garments (the 4 with 3D models). Crew Sweatshirt has no model yet.
  const GARMENTS = [
    { model: "/static/models/meshy_tee.glb",         name: "Classic Tee" },
    { model: "/static/models/meshy_tee_premium.glb", name: "Premium Tee" },
    { model: "/static/models/meshy_hoodie.glb",      name: "Heavyweight Hoodie" },
    { model: "/static/models/meshy_hoodie_zip.glb",  name: "Zip Hoodie" },
  ];
  // Garment colourways + refined, airy backdrops (the stage shifts to one each cycle).
  // Each index pairs a garment colour with a backdrop it contrasts against, so the
  // garment always reads — and the whole set stays desaturated/premium ("clean").
  const COLOURS = ["#f4f3ef", "#1b1b1b", "#d9c9a8", "#a9b39a", "#bcc9d8", "#c87f63", "#6f7d8c"];
  //                off-white  charcoal   sand       sage       dusty-blue terracotta slate
  const BACKDROPS = ["#dcb6ae", "#aebfa6", "#aebfd2", "#cf9e84", "#d8c6a6", "#aeb2b0", "#c7b6cc"];
  //                 blush      sage       sky        clay       sand       stone      lilac

  let designs = [];          // [{url, title}] from the live library
  let i = 0, timer = null, busy = false, curModel = null;
  const PERIOD = 5200;

  const setBackdrop = (hex) => document.documentElement.style.setProperty("--stage-bg", hex);

  async function showCombo(n) {
    if (busy) return;
    busy = true;
    // The garment SHAPE changes only every other cycle ("maybe a different
    // garment"); the design + colour + backdrop change every cycle. That keeps the
    // garment on screen continuously — only a shape change does a brief fade.
    const g = GARMENTS[Math.floor(n / 2) % GARMENTS.length];
    const colour = COLOURS[n % COLOURS.length];
    const design = designs.length ? designs[n % designs.length] : null;
    setBackdrop(BACKDROPS[n % BACKDROPS.length]);
    const needModel = g.model !== curModel;
    if (needModel) stage.classList.add("swapping");      // fade only when the shape swaps
    try {
      if (needModel) {
        await Promise.all([G.load(g.model), new Promise((r) => setTimeout(r, 320))]);
        curModel = g.model;
      }
      G.setColor(colour);                                 // instant recolour
      G.setSide("front");
      await G.setArt("front", design ? design.url : null, { knockout: true });  // blend into fabric
      G.setAutoSpin(true);
    } catch (e) { /* a bad swap shouldn't stop the carousel */ }
    if (capName) capName.textContent = g.name;
    if (capArt) capArt.textContent = design ? design.title : "Your design here";
    if (needModel) requestAnimationFrame(() => stage.classList.remove("swapping"));
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
      if (d.ok && Array.isArray(d.designs)) designs = d.designs.map((x) => ({ url: x.url, title: x.title }));
    } catch (e) { /* no library → garments still cycle, blank-chested */ }
    await showCombo(0);
    startTimer();

    // Pause the carousel while the visitor is inspecting a garment; resume after idle.
    let idle = null;
    const hold = () => { stopTimer(); if (idle) clearTimeout(idle); idle = setTimeout(startTimer, 6000); };
    canvas.addEventListener("pointerdown", hold);
    canvas.addEventListener("wheel", hold, { passive: true });
    // Don't animate/cycle in a background tab.
    document.addEventListener("visibilitychange", () => (document.hidden ? stopTimer() : startTimer()));
  }
  boot();
})();
