/* =============================================================
 *  Gallery2 — cycling studio garment carousel (5 garments, 5 s).
 *  Opens on a black hoodie with white TRUEF brand mark, then
 *  rotates through 2 hoodies + 3 coloured tees.
 *  Self-contained: never touches the landing's Garment3D singleton.
 * ============================================================= */
(() => {
  "use strict";

  const THREE = window.THREE;
  if (!THREE) return;

  const canvas = document.getElementById("gallery3d");
  if (!canvas) return;

  try {
    const t = document.createElement("canvas");
    if (!(t.getContext("webgl2") || t.getContext("webgl"))) return;
  } catch (e) { return; }

  // ── Renderer ─────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding      = THREE.sRGBEncoding;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.physicallyCorrectLights = true;

  // ── Scene + camera ────────────────────────────────────────────────────────
  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0, 0.02, 1.4);

  // ── Lighting ─────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.85));
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const _key  = new THREE.DirectionalLight(0xffffff, 1.05); _key.position.set(0.6,  1.0,  1.2); scene.add(_key);
  const _fill = new THREE.DirectionalLight(0xffffff, 0.42); _fill.position.set(-1.0, 0.4,  0.6); scene.add(_fill);
  const _rim  = new THREE.DirectionalLight(0xffffff, 0.50); _rim.position.set(0,    0.6, -1.4); scene.add(_rim);

  // ── OrbitControls — drag to spin; auto-spin while idle ───────────────────
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.09;
  controls.enablePan       = false;
  controls.enableZoom      = true;
  controls.autoRotate      = true;
  controls.autoRotateSpeed = 1.1;
  controls.minPolarAngle   = Math.PI / 2 - 0.28;
  controls.maxPolarAngle   = Math.PI / 2 + 0.16;
  controls.minDistance     = 0.6;
  controls.maxDistance     = 2.4;
  // pan-y: vertical swipe scrolls the page; horizontal swipe rotates the shirt
  canvas.style.touchAction = "pan-y";

  let _resumeTimer = null;
  canvas.addEventListener("pointerdown", () => { controls.autoRotate = false; clearTimeout(_resumeTimer); });
  window.addEventListener("pointerup",   () => { clearTimeout(_resumeTimer); _resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 2500); });

  // ── Resize ────────────────────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth  || canvas.offsetWidth  || 300;
    const h = canvas.clientHeight || canvas.offsetHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
  resize();

  // ── Base colour CanvasTexture ─────────────────────────────────────────────
  const TEX = 1024;
  const texCanvas = document.createElement("canvas");
  texCanvas.width = texCanvas.height = TEX;
  const tex = new THREE.CanvasTexture(texCanvas);
  tex.flipY    = false;
  tex.encoding = THREE.sRGBEncoding;

  function paintColor(hex) {
    const ctx = texCanvas.getContext("2d");
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, TEX, TEX);
    tex.needsUpdate = true;
  }

  // ── Print-area calibration ────────────────────────────────────────────────
  const AREA = { cx: 0, cy: 0.06, z: 0.16, w: 0.26, h: 0.345 };
  let DECAL_DEPTH = 0.3;
  function calibrate(size) {
    AREA.cx = 0;
    AREA.cy = size.y * 0.10;
    AREA.z  = (size.z / 2) * 0.72;
    AREA.w  = size.x * 0.34;
    AREA.h  = size.y * 0.32;
    DECAL_DEPTH = size.z * 1.4;
  }

  // ── Art decal ─────────────────────────────────────────────────────────────
  let artTex    = null;
  let decalMesh = null;
  let mainMesh  = null;

  function buildDecal() {
    if (!mainMesh || !artTex || !THREE.DecalGeometry) return;
    if (decalMesh) { scene.remove(decalMesh); decalMesh.geometry.dispose(); decalMesh.material.dispose(); decalMesh = null; }
    const pos = new THREE.Vector3(AREA.cx, AREA.cy, AREA.z);
    const sz  = new THREE.Vector3(AREA.w, AREA.h, DECAL_DEPTH);
    let geo;
    try { geo = new THREE.DecalGeometry(mainMesh, pos, new THREE.Euler(0, 0, 0), sz); } catch (e) { return; }
    const dmat = new THREE.MeshStandardMaterial({
      map: artTex, transparent: true, roughness: 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -8, depthTest: false, depthWrite: false,
    });
    decalMesh = new THREE.Mesh(geo, dmat);
    scene.add(decalMesh);
  }

  function loadArt(url) {
    if (!url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (artTex) artTex.dispose();
      artTex = new THREE.Texture(img);
      artTex.encoding    = THREE.sRGBEncoding;
      artTex.needsUpdate = true;
      artTex.anisotropy  = 4;
      buildDecal();
    };
    img.src = url;
  }

  // ── TRUEF brand-mark (white framed-T) as data-URL ────────────────────────
  function _makeBrandDataUrl() {
    const S = 512;
    const tc = document.createElement("canvas");
    tc.width = tc.height = S;
    const ctx = tc.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    const scale = S / 100;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.fillStyle   = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 7;
    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };
    rr(9, 9, 82, 82, 22); ctx.stroke();
    rr(30, 31, 40, 10.5, 2); ctx.fill();
    rr(44.75, 31, 10.5, 40, 2); ctx.fill();
    rr(55, 46, 15.5, 9.5, 2); ctx.fill();
    ctx.restore();
    return tc.toDataURL("image/png");
  }
  const BRAND_URL = _makeBrandDataUrl();

  // ── Carousel playlist — 2 hoodies + 3 coloured tees ─────────────────────
  const PLAYLIST = [
    { model: "/static/models/meshy_hoodie.glb",      colour: "#111111", artUrl: "/designs/transformer.webp"   }, // black hoodie + Transformer — opener
    { model: "/static/models/meshy_hoodie_zip.glb",  colour: "#1e1535", artUrl: "/designs/transformer.webp"   }, // dark plum zip hoodie + Transformer
    { model: "/static/models/meshy_tee.glb",          colour: "#b04a2c", artUrl: "/designs/spirits.jpeg"        }, // rust tee + Spirits
    { model: "/static/models/meshy_tee_premium.glb", colour: "#1a3a5c", artUrl: "/designs/angel-statue.jpg"    }, // navy premium tee + Angel Statue
    { model: "/static/models/meshy_tee.glb",          colour: "#2e5225", artUrl: "/designs/sun-island.jpeg"    }, // forest green tee + Sun Island
  ];

  // ── Model loader ──────────────────────────────────────────────────────────
  const loader = new THREE.GLTFLoader();
  const draco  = new THREE.DRACOLoader();
  draco.setDecoderPath("/static/js/threejs/draco/");
  loader.setDRACOLoader(draco);

  let currentModel = null;
  let currentPath  = null;
  let slotIdx = 0;

  function applyMaterial(model) {
    const meshes = [];
    model.traverse(c => { if (c.isMesh) meshes.push(c); });
    meshes.forEach(m => {
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(one => {
        if (!one) return;
        one.map          = tex;
        one.color        = new THREE.Color(0xffffff);
        one.roughness    = 0.92;
        one.metalness    = 0;
        one.metalnessMap = null; one.roughnessMap = null; one.normalMap = null;
        one.aoMap        = null; one.bumpMap      = null; one.emissiveMap = null;
        if (one.emissive) one.emissive.setRGB(0, 0, 0);
        one.needsUpdate  = true;
      });
    });
    const vol = o => { const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return s.x * s.y * s.z; };
    mainMesh = meshes.reduce((a, b) => (vol(b) > vol(a) ? b : a));
  }

  function showSlot(idx) {
    const slot = PLAYLIST[idx % PLAYLIST.length];
    paintColor(slot.colour);

    if (slot.model === currentPath && currentModel) {
      // Same model — just swap colour + art
      loadArt(slot.artUrl);
      return;
    }

    loader.load(slot.model, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.sub(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale  = 1.55 / maxDim;
      model.scale.multiplyScalar(scale);
      const scaledSize = size.clone().multiplyScalar(scale);

      applyMaterial(model);
      calibrate(scaledSize);

      const fitDist = (Math.max(scaledSize.x, scaledSize.y) /
                       (2 * Math.tan((camera.fov * Math.PI / 180) / 2))) * 2.0;
      camera.position.set(0, 0.02, fitDist);
      controls.minDistance = fitDist * 0.55;
      controls.maxDistance = fitDist * 1.9;
      controls.update();

      // Clear old decal before swapping model
      if (decalMesh) { scene.remove(decalMesh); decalMesh.geometry.dispose(); decalMesh.material.dispose(); decalMesh = null; }
      if (currentModel) scene.remove(currentModel);
      scene.add(model);
      currentModel = model;
      currentPath  = slot.model;

      loadArt(slot.artUrl);
    });
  }

  // ── Render loop — paused when off-screen ─────────────────────────────────
  let rafId = null;
  function loop() { rafId = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); }

  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { if (!rafId) loop(); }
      else { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    }, { threshold: 0.05 }).observe(canvas);
  } else {
    loop();
  }

  // ── Reveal studio copy when it scrolls into view ──────────────────────────
  const studioCopy = document.querySelector(".studio-copy");
  if (studioCopy && typeof IntersectionObserver !== "undefined") {
    const copyIO = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { studioCopy.classList.add("reveal"); copyIO.disconnect(); }
    }, { threshold: 0.15 });
    copyIO.observe(studioCopy);
  } else if (studioCopy) {
    studioCopy.classList.add("reveal");
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  showSlot(0);

  // Preload remaining model GLBs into browser HTTP cache
  const otherModels = [...new Set(PLAYLIST.map(s => s.model))].filter(m => m !== PLAYLIST[0].model);
  otherModels.forEach((m, k) => setTimeout(() => loader.load(m, () => {}), 2000 + k * 1500));

  // ── Carousel — advance every 5 s ─────────────────────────────────────────
  const studioEl = document.querySelector(".studio-hero");
  if (studioEl) {
    setInterval(() => { slotIdx = (slotIdx + 1) % PLAYLIST.length; showSlot(slotIdx); }, 5000);
  }

  // ── Background colour-cycling (7 s) — tints the studio photo, not replaces it ─
  // rgba values: ~60% opacity so the photo texture always shows through
  const STUDIO_PALETTES = [
    "rgba(0,0,0,.62)",        // near-black — default
    "rgba(15,16,50,.66)",     // deep ink blue
    "rgba(0,14,28,.62)",      // midnight
    "rgba(28,10,40,.64)",     // deep plum
    "rgba(0,22,12,.62)",      // dark forest
    "rgba(35,12,8,.64)",      // deep rust
    "rgba(18,10,22,.62)",     // dark violet
    "rgba(12,25,15,.62)",     // dark emerald
  ];
  let bgIdx = 0;
  if (studioEl) {
    setInterval(() => {
      bgIdx = (bgIdx + 1) % STUDIO_PALETTES.length;
      document.documentElement.style.setProperty("--studio-bg", STUDIO_PALETTES[bgIdx]);
    }, 7000);
  }
})();
