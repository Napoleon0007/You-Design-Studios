/* =============================================================
 *  Landing (v2) — fixed-sequence 3D garment showcase.
 *  Each slot defines exactly: garment, colour, design, caption.
 *  Backdrop is auto-picked to contrast the shirt colour.
 *  Touch-glitch fix: carousel stops the instant a finger lands,
 *  resumes 4.5s after they let go — never swaps mid-drag.
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

  const waitFrame = () => new Promise(r => requestAnimationFrame(r));

  // ── Curated showcase sequence ────────────────────────────────────────────
  // artUrl: "brand" = show the TRUEF mark; a path = that design; null = clean
  const PLAYLIST = [
    { model: "/static/models/meshy_hoodie.glb",      colour: "#5c4a8b", artUrl: "/designs/indian-warrior.jpeg",    name: "Heavyweight Hoodie", label: "Indian Warrior" },
    { model: "/static/models/meshy_hoodie.glb",      colour: "#1b1b1b", artUrl: "/designs/wolf-art.jpeg",           name: "Heavyweight Hoodie", label: "Wolf Art" },
    { model: "/static/models/meshy_tee.glb",          colour: "#c87f63", artUrl: "/designs/rider.jpeg",              name: "Classic Tee",        label: "Rider" },
    { model: "/static/models/meshy_hoodie.glb",      colour: "#f4f3ef", artUrl: "/designs/skull-shaman.jpeg",       name: "Heavyweight Hoodie", label: "Skull Shaman" },
    { model: "/static/models/meshy_tee_premium.glb", colour: "#bcc9d8", artUrl: "/designs/eagle-spirit.jpeg",       name: "Premium Tee",        label: "Eagle Spirit" },
    { model: "/static/models/meshy_hoodie.glb",      colour: "#2b2136", artUrl: "/designs/skully.png",              name: "Heavyweight Hoodie", label: "Skully" },
    { model: "/static/models/meshy_tee.glb",          colour: "#d4a843", artUrl: "/designs/pirate.jpg",              name: "Classic Tee",        label: "Pirate" },
    { model: "/static/models/meshy_hoodie_zip.glb",  colour: "#3a3a3a", artUrl: "/designs/transformer.webp",        name: "Zip Hoodie",         label: "Transformer" },
    { model: "/static/models/meshy_tee.glb",          colour: "#6e7e8c", artUrl: "/designs/einstein.jpeg",           name: "Classic Tee",        label: "Einstein" },
    { model: "/static/models/meshy_tee.glb",          colour: "#e8e0d4", artUrl: "/designs/crest-imperial-eagle.jpg", name: "Classic Tee",      label: "Crest Imperial Eagle" },
    { model: "/static/models/meshy_hoodie_zip.glb",  colour: "#4a7c59", artUrl: "/designs/neon-animal.jpeg",        name: "Zip Hoodie",         label: "Neon Animal" },
    { model: "/static/models/meshy_tee.glb",          colour: "#7c3a4a", artUrl: "/designs/my-my.jpeg",              name: "Classic Tee",        label: "My My" },
    { model: "/static/models/meshy_tee_premium.glb", colour: "#1a3a5c", artUrl: "/designs/angel-statue.jpg",        name: "Premium Tee",        label: "Angel Statue" },
    { model: "/static/models/meshy_tee.glb",          colour: "#d9c8a8", artUrl: "/designs/art-lines.jpeg",          name: "Classic Tee",        label: "Art Lines" },
    { model: "/static/models/meshy_hoodie.glb",      colour: "#1e1e1e", artUrl: "/designs/uncle.jpeg",              name: "Heavyweight Hoodie", label: "Uncle" },
    { model: "/static/models/meshy_tee.glb",          colour: "#c4855a", artUrl: "/designs/spirits.jpeg",            name: "Classic Tee",        label: "Spirits" },
    { model: "/static/models/meshy_hoodie_zip.glb",  colour: "#1e1535", artUrl: "/designs/spirits.jpeg",            name: "Zip Hoodie",         label: "Spirits" },
    { model: "/static/models/meshy_tee.glb",          colour: "#3d6e5a", artUrl: "/designs/sun-island.jpeg",         name: "Classic Tee",        label: "Sun Island" },
  ];
  // ────────────────────────────────────────────────────────────────────────

  // Backdrop pools — dark jewel-earths for light shirts, warm neutrals for dark shirts.
  const DARK_BACKDROPS  = ["#2f5d4a", "#1f5663", "#23262c", "#6e5427", "#46372a", "#3a4d40", "#2b4658"];
  const LIGHT_BACKDROPS = ["#f0ece4", "#e8edf0", "#ede8df", "#eaeee8", "#f2ede6"];

  let i = 0, timer = null, busy = false, curModel = null, userActive = false;
  const SPIN_SPEED = 8;          // autoRotateSpeed — one full revolution ≈ 7.5 s
  const PERIOD = 7500;           // advance every one full rotation at SPIN_SPEED
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const setBackdrop = (hex) => document.documentElement.style.setProperty("--stage-bg", hex);

  const _rgb  = (h) => { const c = h.replace("#", ""); return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)]; };
  const _luma = (h) => { const [r,g,b] = _rgb(h); return 0.299*r + 0.587*g + 0.114*b; };
  const _diff = (a, b) => { const A=_rgb(a),B=_rgb(b); return 2*(A[0]-B[0])**2+4*(A[1]-B[1])**2+3*(A[2]-B[2])**2; };
  const pickBackdrop = (shirt, n) => {
    const dark = _luma(shirt) < 110;
    const pool = dark ? LIGHT_BACKDROPS : DARK_BACKDROPS;
    if (dark) return pool[n % pool.length];
    return pool.slice().sort((x,y) => _diff(shirt,y) - _diff(shirt,x)).slice(0,4)[n % 4];
  };

  async function showCombo(n) {
    if (busy) return;
    busy = true;
    const slot = PLAYLIST[n % PLAYLIST.length];
    const needModel = slot.model !== curModel;
    const bd = pickBackdrop(slot.colour, n);
    const lightStage = _luma(bd) > 140;
    setBackdrop(bd);
    stage.classList.toggle("light-stage", lightStage);
    document.documentElement.style.setProperty("--garment-reflect", slot.colour);
    if (G.setRoomTint) G.setRoomTint(bd);
    if (n !== 0) {
      stage.classList.add("swapping");
      await wait(80);
    }
    try {
      G.setColor(slot.colour);
      if (needModel) { await G.load(slot.model); curModel = slot.model; }
      G.setSide("front");
      if (slot.artUrl) {
        await G.setArt("front", slot.artUrl);
        await G.setArt("back", null);
      } else {
        await G.setArt("front", null);
        await G.setArt("back", null);
      }
      G.setAutoSpin(true, SPIN_SPEED);
      // Wait two frames: first lets the render loop paint the decal onto the canvas,
      // second guarantees it's visible before we remove .swapping and start the reveal.
      await waitFrame(); await waitFrame();
    } catch (e) { /* a bad swap shouldn't stop the carousel */ }
    if (capName) capName.textContent = slot.name;
    if (capArt)  capArt.textContent  = slot.label;
    const cap = document.querySelector(".hero-cap");
    if (cap) { cap.classList.remove("cap-pop"); void cap.offsetWidth; cap.classList.add("cap-pop"); }
    stage.classList.remove("swapping");
    busy = false;
  }

  const next = () => { if (userActive || busy) return; i += 1; showCombo(i); };
  const startTimer = () => { if (!timer) timer = setInterval(next, PERIOD); };
  const stopTimer  = () => { if (timer) { clearInterval(timer); timer = null; } };

  async function boot() {
    G.init(canvas, {});
    G.lockPlacement(true);
    if (G.setRoom) G.setRoom(false);

    // Preload all design images into browser cache so setArt is instant — no lag
    // between the shirt appearing and the design appearing on it.
    PLAYLIST.forEach(slot => {
      if (slot.artUrl) { const img = new Image(); img.src = slot.artUrl; }
    });

    // Render the opening shot immediately.
    await showCombo(0);
    requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add("hero-ready")));
    startTimer();

    // Preload remaining models staggered so there's no burst on initial load.
    const uniqueModels = [...new Set(PLAYLIST.map(s => s.model))].filter(m => m !== PLAYLIST[0].model);
    uniqueModels.forEach((m, k) => setTimeout(() => G.preload([m]), 1800 + k * 1800));

    // Kinetic copy reveal + multi-plane scroll parallax.
    const copy  = document.querySelector(".hero-copy");
    const room  = document.querySelector(".hero-room");
    const gWrap = document.querySelector(".hero-garment");
    const nav   = document.querySelector(".v2nav");
    if (copy) requestAnimationFrame(() => copy.classList.add("reveal"));
    let stick = false;
    window.addEventListener("scroll", () => {
      if (stick) return; stick = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || 0;
        if (room)  room.style.transform  = "translateY(" + (y * 0.06).toFixed(1) + "px)";
        if (gWrap) gWrap.style.transform = "translateY(" + (y * 0.13).toFixed(1) + "px) scale(" + Math.max(0.86, 1 - y * 0.0002).toFixed(3) + ")";
        if (copy)  { copy.style.transform = "translateY(" + (y * 0.18).toFixed(1) + "px)"; copy.style.opacity = String(Math.max(0, 1 - y / 520)); }
        if (nav) nav.classList.toggle("on-light", y > stage.offsetHeight - 72);
        stick = false;
      });
    }, { passive: true });

    // ── Touch-glitch fix ────────────────────────────────────────────────────
    // Stop the carousel the instant a finger lands; resume only after 4.5s idle.
    // This prevents a swap (recolour + materialise blur) firing mid-drag.
    let idle = null;
    const IDLE_RESUME = 4500;
    const armResume = () => { if (idle) clearTimeout(idle); idle = setTimeout(() => { if (!userActive) startTimer(); }, IDLE_RESUME); };
    const onGrab    = () => { userActive = true; stopTimer(); if (idle) { clearTimeout(idle); idle = null; } stage.classList.remove("swapping"); };
    const onRelease = () => { userActive = false; armResume(); };
    canvas.addEventListener("pointerdown", onGrab);
    window.addEventListener("pointerup",     onRelease);
    window.addEventListener("pointercancel", onRelease);
    canvas.addEventListener("wheel", () => { stopTimer(); armResume(); }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopTimer(); else if (!userActive) startTimer(); });

    // ── Cursor / gyro parallax on the room layers ───────────────────────────
    (function () {
      const room = document.querySelector(".hero-room");
      if (!room) return;
      const wall  = room.querySelector(".room-wall");
      const floor = room.querySelector(".room-floor");
      const glow  = room.querySelector(".room-glow");
      let px=0, py=0, tx=0, ty=0, praf=false;
      const apply = () => {
        px += (tx-px)*0.08; py += (ty-py)*0.08;
        if (wall)  wall.style.transform  = "translateX(calc(-50% + " + (px*14).toFixed(2) + "px)) translateY(" + (py*9).toFixed(2) + "px)";
        if (floor) floor.style.transform = "translateX(calc(-50% + " + (px*8).toFixed(2)  + "px)) rotateX(80deg)";
        if (glow)  glow.style.transform  = "translate(" + (px*22).toFixed(2) + "px," + (py*16).toFixed(2) + "px)";
        document.documentElement.style.setProperty("--ground-shift", (px*-7).toFixed(2) + "px");
        if (Math.abs(tx-px)>0.0005 || Math.abs(ty-py)>0.0005) requestAnimationFrame(apply);
        else praf = false;
      };
      const kick = () => { if (!praf) { praf=true; requestAnimationFrame(apply); } };
      window.addEventListener("pointermove", (e) => { tx=(e.clientX/window.innerWidth)*2-1; ty=(e.clientY/window.innerHeight)*2-1; kick(); }, { passive: true });
      window.addEventListener("deviceorientation", (e) => { if (e.gamma==null) return; tx=Math.max(-1,Math.min(1,e.gamma/30)); ty=Math.max(-1,Math.min(1,((e.beta||45)-45)/30)); kick(); });
    })();
  }
  boot();
})();
