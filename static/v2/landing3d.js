/* =============================================================
 *  Landing (v2) — cycling 3D garment showcase.
 *  Reuses the studio's Garment3D engine. Every ~6s a new garment
 *  glides in: it MATERIALISES (a slow blur+scale+fade reveal, "out of
 *  thin air") after a quick fade-out, so every transition is smooth.
 *  Every garment carries a print (a curated set of cool designs), recoloured
 *  to the colourway and blended into the fabric.
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
  // Garment colourways — wide palette so every cycle looks fresh, every shade
  // contrasts the dark jewel-earth backdrop picked by pickBackdrop().
  const COLOURS = [
    "#f4f3ef", // off-white   (brand opener)
    "#1b1b1b", // charcoal
    "#c87f63", // terracotta
    "#a9b39a", // sage
    "#d9c9a8", // sand
    "#bcc9d8", // dusty-blue
    "#8b3a3a", // deep-red
    "#4a7c59", // mid-green
    "#d4a843", // amber
    "#5c4a8b", // plum
    "#3a6a8a", // teal-blue
    "#6f7d8c", // slate
  ];
  // TAMED colour-show — one disciplined, on-brand palette: deep jewel-earth tones
  // (greens / teal / charcoal / bronze / espresso / petrol-blue). NO rose, azure or
  // violet. Every backdrop is dark enough that the white copy clears WCAG AA (≥7:1)
  // on any cycle, while the white room grid + spotlight + garment still pop. The
  // backdrop is CHOSEN (not index-paired) to be the most DIFFERENT from that shirt.
  const BACKDROPS = ["#2f5d4a", "#1f5663", "#23262c", "#6e5427", "#46372a", "#3a4d40", "#2b4658"];
  //                 pine       petrol-teal charcoal  bronze    espresso  slate-green petrol-blue
  // The cool prints that ride the ONE printed shirt in the rotation (all others blank).
  const COOL_IDS = ["skull-2.jpg", "neon.jpg", "paint-splash.jpg", "dark-surreal.jpg",
                    "the-guardian.webp", "shamaan.jpg", "green-tides.jpg"];
  // Opening shot: a BLACK tee branded with the framed-TF mark on the chest (front)
  // and the TRUeF wordmark on the back.
  const BRAND_MARK = "/static/v2/brand_mark.png";
  const BRAND_MARK_DARK = "/static/v2/brand_mark_dark.png";   // dark mark for the WHITE opening tee
  const BRAND_WORD = "/static/v2/brand_word.png";

  let designs = [], cool = [];
  let i = 0, timer = null, busy = false, curModel = null, userActive = false;
  const PERIOD = 5000;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setBackdrop = (hex) => document.documentElement.style.setProperty("--stage-bg", hex);
  // Pick the backdrop most DIFFERENT from the shirt colour so a garment never blends
  // into the background (rotating among the top-different ones for variety).
  const _rgb = (h) => { const c = h.replace("#", ""); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; };
  const _diff = (a, b) => { const A = _rgb(a), B = _rgb(b); return 2 * (A[0] - B[0]) ** 2 + 4 * (A[1] - B[1]) ** 2 + 3 * (A[2] - B[2]) ** 2; };
  const pickBackdrop = (shirt, n) => {
    const ranked = BACKDROPS.slice().sort((x, y) => _diff(shirt, y) - _diff(shirt, x));
    return ranked.slice(0, 4)[n % 4];
  };

  async function showCombo(n) {
    if (busy) return;
    busy = true;
    const brand = (n === 0);                                    // opening shot: a clean WHITE tee with the TRUEF mark
    const g = brand ? GARMENTS[0] : GARMENTS[n % GARMENTS.length];   // garment shape changes every cycle
    const colour = brand ? "#f4f3ef" : COLOURS[n % COLOURS.length];
    // Every garment carries a print, cycling the curated cool set.
    const pool = cool.length ? cool : designs;
    const design = (!brand && pool.length) ? pool[n % pool.length] : null;
    let chosen = design;
    const needModel = g.model !== curModel;

    const bd = pickBackdrop(colour, n);         // backdrop most DIFFERENT from the shirt (deep colour vs the white opener)
    setBackdrop(bd);                            // CSS fallback (poster phase / no-3D)
    document.documentElement.style.setProperty("--garment-reflect", colour);  // floor colour-bleed picks up the shirt
    if (G.setRoomTint) G.setRoomTint(bd);       // tint the 3D room to match
    stage.classList.add("swapping");           // quick DIP (never empty) while we swap colour/art
    await wait(140);
    try {
      G.setColor(colour);                        // recolour the shared texture first (no colour flash)
      if (needModel) { await G.load(g.model); curModel = g.model; }   // instant once cached
      G.setSide("front");
      if (brand) {
        await G.setArt("front", BRAND_MARK_DARK);   // dark framed-TF on the white tee (reads on white)
        await G.setArt("back", null);               // clean back — a white wordmark would vanish on a white shirt
      } else {
        // GUARANTEE a visible print on EVERY garment: cycle the cool set, and if a
        // design fails to load or leaves nothing on the shirt, fall through to the next.
        let placed = false;
        const start = pool.length ? (n % pool.length) : 0;
        for (let k = 0; k < pool.length; k++) {
          const d = pool[(start + k) % pool.length];
          const img = await G.setArt("front", d.url);            // full print (no knockout = always visible)
          if (img && (!G.debug || G.debug().decalFront)) { chosen = d; placed = true; break; }
        }
        if (!placed && pool.length) { await G.setArt("front", pool[start].url); chosen = pool[start]; }
        await G.setArt("back", null);                              // clear the brand back-print on later shirts
      }
      G.setAutoSpin(true);
    } catch (e) { /* a bad swap shouldn't stop the carousel */ }
    if (capName) capName.textContent = g.name;
    if (capArt) capArt.textContent = brand ? "TRUeF" : (chosen ? chosen.title : "Your design here");
    const cap = document.querySelector(".hero-cap");
    if (cap) { cap.classList.remove("cap-pop"); void cap.offsetWidth; cap.classList.add("cap-pop"); }   // kinetic caption
    requestAnimationFrame(() => stage.classList.remove("swapping"));  // materialise IN (slow reveal)
    busy = false;
  }

  const next = () => { if (userActive || busy) return; i += 1; showCombo(i); };
  const startTimer = () => { if (!timer) timer = setInterval(next, PERIOD); };
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };

  async function boot() {
    G.init(canvas, {});
    G.lockPlacement(true);                            // drags spin; never move the print
    if (G.setRoom) { G.setRoom(false); }   // room off: garment floats on the single --stage-bg colour (no white/peach split)

    // cinematic "lights on" open — the room blooms up + the garment arrives, ONCE, as
    // the page opens (on the instant poster). Removed after it plays so the scroll-
    // parallax can own those transforms. (Must run BEFORE the first 3D frame, else it
    // re-reveals an already-painted garment = a glitchy double-flash.)
    requestAnimationFrame(() => stage.classList.add("intro"));
    setTimeout(() => stage.classList.remove("intro"), 1500);

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
    // Warm the OTHER models AFTER first paint, STAGGERED — so the landing's initial
    // load isn't a ~10MB burst of all 4 GLBs at once. Each is cached well before the
    // carousel needs it (shape changes every other 6s cycle: 2nd shape ≈12s in).
    GARMENTS.slice(1).forEach((g, k) => setTimeout(() => G.preload([g.model]), 1800 + k * 1800));

    // kinetic type: staggered reveal on load + MULTI-PLANE parallax on scroll —
    // room (far) < garment (mid, also recedes a touch) < copy (near) → 3D diorama.
    const copy = document.querySelector(".hero-copy");
    const room = document.querySelector(".hero-room");
    const gWrap = document.querySelector(".hero-garment");
    const nav = document.querySelector(".v2nav");
    if (copy) requestAnimationFrame(() => copy.classList.add("reveal"));
    let stick = false;
    window.addEventListener("scroll", () => {
      if (stick) return; stick = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        if (room)  room.style.transform  = "translateY(" + (y * 0.06).toFixed(1) + "px)";
        if (gWrap) gWrap.style.transform = "translateY(" + (y * 0.13).toFixed(1) + "px) scale(" + Math.max(0.86, 1 - y * 0.0002).toFixed(3) + ")";
        if (copy) { copy.style.transform = "translateY(" + (y * 0.18).toFixed(1) + "px)"; copy.style.opacity = String(Math.max(0, 1 - y / 520)); }
        // Nav adapts: white over the colour hero, ink-on-glass once it crosses into
        // the white gallery (otherwise the white logo/menu vanish on white).
        if (nav) nav.classList.toggle("on-light", y > stage.offsetHeight - 72);
        stick = false;
      });
    }, { passive: true });

    // Carousel vs. interaction: NEVER swap the garment while the visitor is
    // touching it. A swap mid-drag (recolour + front/back tween + the
    // materialise blur on the canvas) was the "glitch when I play with it".
    // Stop the carousel the instant a finger lands; resume only after they've
    // been idle for a beat. pointerup/cancel are on window so a release that
    // ends off-canvas still counts.
    let idle = null;
    const IDLE_RESUME = 4500;
    const armResume = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (!userActive) startTimer(); }, IDLE_RESUME); };
    const onGrab = () => {
      userActive = true; stopTimer();
      if (idle) { clearTimeout(idle); idle = null; }
      stage.classList.remove("swapping");   // snap to full size — never drag a blurred/scaled canvas
    };
    const onRelease = () => { userActive = false; armResume(); };
    canvas.addEventListener("pointerdown", onGrab);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("pointercancel", onRelease);
    canvas.addEventListener("wheel", () => { stopTimer(); armResume(); }, { passive: true });
    // Don't animate/cycle in a background tab.
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopTimer(); else if (!userActive) startTimer(); });

    // ---- 3D-space parallax: nudge the room layers with cursor / device tilt.
    //      DOM transforms only (never the WebGL camera) so it can't fight a drag.
    (function () {
      const room = document.querySelector(".hero-room");
      if (!room) return;
      const wall = room.querySelector(".room-wall"),
            floor = room.querySelector(".room-floor"),
            glow = room.querySelector(".room-glow");
      let px = 0, py = 0, tx = 0, ty = 0, praf = false;
      const apply = () => {
        px += (tx - px) * 0.08; py += (ty - py) * 0.08;
        if (wall)  wall.style.transform  = "translateX(calc(-50% + " + (px * 14).toFixed(2) + "px)) translateY(" + (py * 9).toFixed(2) + "px)";
        if (floor) floor.style.transform = "translateX(calc(-50% + " + (px * 8).toFixed(2) + "px)) rotateX(80deg)";
        if (glow)  glow.style.transform  = "translate(" + (px * 22).toFixed(2) + "px," + (py * 16).toFixed(2) + "px)";
        document.documentElement.style.setProperty("--ground-shift", (px * -7).toFixed(2) + "px");   // #5: ground nudges with the room
        if (Math.abs(tx - px) > 0.0005 || Math.abs(ty - py) > 0.0005) requestAnimationFrame(apply);
        else praf = false;
      };
      const kick = () => { if (!praf) { praf = true; requestAnimationFrame(apply); } };
      window.addEventListener("pointermove", (e) => { tx = (e.clientX / window.innerWidth) * 2 - 1; ty = (e.clientY / window.innerHeight) * 2 - 1; kick(); }, { passive: true });
      window.addEventListener("deviceorientation", (e) => { if (e.gamma == null) return; tx = Math.max(-1, Math.min(1, e.gamma / 30)); ty = Math.max(-1, Math.min(1, ((e.beta || 45) - 45) / 30)); kick(); });
    })();
  }
  boot();
})();
