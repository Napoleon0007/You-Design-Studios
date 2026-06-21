/* =============================================================
 *  You Design Studios — real-time 3D garment engine
 *  ------------------------------------------------------------
 *  Three.js scene in #garment3d.
 *    • recolour : a <canvas> baseColor map filled with the chosen
 *      colour (also the future all-over-print surface).
 *    • print    : a DecalGeometry PROJECTED onto the chest / back.
 *      The decal inherits the mesh normals + scene lighting, so the
 *      art folds and curves with the fabric (not a floating image).
 *      (This model's front & back share one UV island, so a UV-painted
 *      print would bleed through — a decal projects onto one side only.)
 *    • drag/scale/rotate edit the normalised placement
 *      {scale,cx,cy,rotation} — the exact object printfile.py uses,
 *      so the preview and the 300-DPI print stay in lockstep.
 *  Vanilla, non-module. Three r128 UMD globals loaded beforehand.
 * ============================================================= */
(() => {
  "use strict";
  const G = {};
  window.Garment3D = G;

  G.supported = (() => {
    try {
      const c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
                (c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  })();

  const TEX = 1024;
  const DEBUG_GRID = false;

  // world-space print rectangle on each side of the (re-centred) garment.
  // These are AUTO-CALIBRATED to each model's real bounding box in G.load (see
  // calibrateArea) — the values below are only a sane fallback before a model
  // loads. (They used to be hard-coded to the small tee.glb, so on the larger
  // Meshy meshes the box sat behind the chest and the print projected onto
  // nothing → invisible art. cy>0 = upper chest.)
  const AREA = {
    front: { cx: 0, cy: 0.06, z: 0.16,  w: 0.26, h: 0.345, back: false },
    back:  { cx: 0, cy: 0.06, z: -0.16, w: 0.26, h: 0.345, back: true },
  };
  let DECAL_DEPTH = 0.3;

  // Fit the print boxes to a freshly-measured garment size (world units, the
  // model is re-centred on the origin so the surfaces are at ±half-extent).
  function calibrateArea(size) {
    const PW  = size.x * 0.34;   // print width  ≈ chest area (bbox x includes sleeves)
    const PH  = size.y * 0.32;   // print height
    const PCY = size.y * 0.10;   // vertical centre: upper chest, just above the middle
    const PZ  = (size.z / 2) * 0.72;  // projection plane just inside the front/back surface
    AREA.front = { cx: 0, cy: PCY, z:  PZ, w: PW, h: PH, back: false };
    AREA.back  = { cx: 0, cy: PCY, z: -PZ, w: PW, h: PH, back: true };
    DECAL_DEPTH = size.z * 0.6;  // deep enough to catch the curved front, shy of the back
    G.areaRatio = AREA.front.w / AREA.front.h;
  }
  G.areaRatio = AREA.front.w / AREA.front.h;   // print-area w:h, for UI height init

  const art = { front: null, back: null };          // THREE.Texture
  const artImg = { front: null, back: null };       // source HTMLImageElement (for aspect)
  const decal = { front: null, back: null };        // THREE.Mesh
  const placement = {
    front: { scale: 1.0, cx: 0.5, cy: 0.46, rotation: 0 },   // art fills the full print width on land
    back:  { scale: 1.0, cx: 0.5, cy: 0.46, rotation: 0 },
  };

  let THREE, renderer, scene, camera, controls, raycaster, pointer;
  let mesh = null, mat = null, texCanvas, tex, fitDist = 1.2;
  let garmentColor = "#d7dade";
  let side = "front";
  let stage, canvasEl, ro, io;
  let running = false, autoSpin = false, dragging = false, rafId = null;
  let resumeTimer = null, onscreen = true;
  let targetAzimuth = 0, haveAzTarget = false;
  let onPlacement = null;
  let _lockPlacement = false;   // landing-showcase mode: drags spin, never move the print

  // ------------------------------------------------------------------ init -- //
  function _init(canvas, opts = {}) {
    if (!G.supported) return false;
    THREE = window.THREE;
    if (!THREE || !THREE.GLTFLoader) { console.warn("[garment3d] THREE not loaded"); return false; }
    canvasEl = canvas; stage = canvas.parentElement || canvas;
    onPlacement = opts.onPlacement || null;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0.02, 1.2);

    // Pure light rig — NO PMREM/RoomEnvironment env map. Generating one cost
    // ~seconds of synchronous GPU work on mobile (the model couldn't even start
    // loading until it finished) for almost no gain on matte fabric. The hemi +
    // ambient + 3 directionals carry the look and init is now near-instant.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.85));
    scene.add(new THREE.AmbientLight(0xffffff, 0.28));
    const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(0.6, 1.0, 1.2); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.42); fill.position.set(-1.0, 0.4, 0.6); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(0, 0.6, -1.4); scene.add(rim);

    texCanvas = document.createElement("canvas");
    texCanvas.width = texCanvas.height = TEX;
    tex = new THREE.CanvasTexture(texCanvas);
    tex.flipY = false; tex.encoding = THREE.sRGBEncoding;

    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.09;
    // No AUTO-spin (the garment doesn't turn on its own), but the user CAN spin it
    // with a finger to inspect it. Dragging ON the printed art moves the art instead
    // of rotating (handled in bindPlacementPointer). Front/back also has the toggle.
    controls.enablePan = false; controls.autoRotate = false; controls.enableRotate = true;
    controls.rotateSpeed = 0.9;

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    bindPlacementPointer();

    ro = new ResizeObserver(() => G.resize());
    ro.observe(stage);
    G.resize();
    // Pause the render loop when the stage scrolls off-screen (mobile battery/perf).
    try {
      io = new IntersectionObserver((es) => { onscreen = es[0].isIntersecting; }, { threshold: 0.01 });
      io.observe(stage);
    } catch (e) { onscreen = true; }
    if (controls) controls.enableZoom = true;   // pinch-to-zoom on touch
    addStageControls();
    redraw();
    running = true;
    return true;
  }
  G.init = function (canvas, opts) { const ok = _init(canvas, opts); if (ok) loop(); return ok; };

  G.resize = function () {
    if (!renderer) return;
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); kick();
  };

  // injected loading overlay — heavy GLBs take a few seconds (esp. on phone), so
  // never leave the stage looking blank/broken while a model streams in.
  function showLoading(on) {
    if (!stage) return;
    let el = stage.querySelector(".g3d-loading");
    if (on) {
      if (!el) {
        el = document.createElement("div");
        el.className = "g3d-loading";
        el.innerHTML = '<span class="g3d-spin"></span><span class="g3d-load-txt">Loading garment…</span>';
        stage.appendChild(el);
      }
      el.style.display = "";
    } else if (el) {
      el.style.display = "none";
    }
  }

  // A reset-view control + a one-time "how to interact" hint, both injected by the
  // engine so we never touch the (concurrently-edited) studio template.
  function addStageControls() {
    if (!stage || stage.querySelector(".g3d-reset")) return;
    const btn = document.createElement("button");
    btn.className = "g3d-reset"; btn.type = "button";
    btn.setAttribute("aria-label", "Reset view"); btn.textContent = "↺";
    btn.addEventListener("click", (e) => { e.stopPropagation(); G.resetView(); });
    stage.appendChild(btn);
    const hint = document.createElement("div");
    hint.className = "g3d-hint"; hint.textContent = "Drag to spin · drag your art to move it · pinch to zoom";
    stage.appendChild(hint);
  }
  G.resetView = function () {
    autoSpin = false;
    if (controls) controls.autoRotate = false;
    setCam(side, fitDist, false);   // re-frame the current side at default zoom (no spin)
    kick();
  };

  // Draco decoder — our GLBs are Draco-compressed for mobile (~1–3MB vs 13–37MB).
  // Needs DRACOLoader.js loaded in the page; decoder is fetched from the CDN once.
  let _draco = null;
  function getDraco() {
    if (!_draco && THREE.DRACOLoader) {
      _draco = new THREE.DRACOLoader();
      _draco.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
    }
    return _draco;
  }

  // ------------------------------------------------------------- load GLB -- //
  // Models are parsed ONCE and cached by URL: a swap to an already-loaded model is
  // instant (no re-download / re-Draco-decode / re-material), so the landing's
  // garment carousel never hitches on a shape change. G.preload warms the cache in
  // the background so even the first swap to each model is instant.
  const _modelCache = Object.create(null);
  const _inflight = Object.create(null);

  // One-time setup of a freshly-parsed scene: matte non-metal fabric whose albedo IS
  // our recolour canvas (drop Meshy's baked metal/emissive/detail maps so no
  // colour-independent "pattern" shows through), centred on the origin + measured.
  function _normalise(gltf) {
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    if (!meshes.length) return null;
    meshes.forEach((m) => {
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((one) => {
        if (!one) return;
        one.map = tex; one.color = new THREE.Color(0xffffff);
        one.roughness = 0.92; one.metalness = 0;
        one.metalnessMap = null; one.roughnessMap = null;
        one.normalMap = null; one.aoMap = null; one.bumpMap = null;
        one.displacementMap = null; one.lightMap = null;
        if (one.emissive) one.emissive.setRGB(0, 0, 0);
        one.emissiveMap = null;
        one.needsUpdate = true;
      });
    });
    const vol = (o) => { const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return s.x * s.y * s.z; };
    const main = meshes.reduce((a, b) => (vol(b) > vol(a) ? b : a));   // largest mesh carries decals/raycast
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    gltf.scene.position.sub(c);
    gltf.scene.updateMatrixWorld(true);
    main.userData._root = gltf.scene;
    return { root: gltf.scene, mesh: main, size: size };
  }

  // Fetch + parse a model into the cache WITHOUT displaying it (de-dupes in-flight).
  function _fetchModel(url) {
    if (_modelCache[url]) return Promise.resolve(_modelCache[url]);
    if (_inflight[url]) return _inflight[url];
    const p = new Promise((resolve, reject) => {
      const loader = new THREE.GLTFLoader();
      const dl = getDraco(); if (dl) loader.setDRACOLoader(dl);
      loader.load(url, (gltf) => {
        const entry = _normalise(gltf);
        if (!entry) { delete _inflight[url]; reject(new Error("no mesh in GLB")); return; }
        _modelCache[url] = entry; delete _inflight[url]; resolve(entry);
      }, undefined, (err) => { delete _inflight[url]; reject(err); });
    });
    _inflight[url] = p;
    return p;
  }

  G.preload = function (urls) {
    if (!G.supported || !THREE || !THREE.GLTFLoader) return;
    (urls || []).forEach((u) => { if (u) _fetchModel(u).catch(function () {}); });
  };

  // Swap a (cached or freshly-loaded) model entry into the scene + reframe it.
  function _showModel(entry) {
    ["front", "back"].forEach(removeDecal);
    if (mesh && mesh.userData._root && mesh.userData._root !== entry.root) {
      scene.remove(mesh.userData._root);
    }
    mesh = entry.mesh;
    mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    calibrateArea(entry.size);                     // fit the print boxes to THIS model
    const maxDim = Math.max(entry.size.x, entry.size.y);
    fitDist = (maxDim / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))) * 1.5;
    controls.minDistance = fitDist * 0.55; controls.maxDistance = fitDist * 1.9;
    setCam(side, fitDist);
    if (entry.root.parent !== scene) scene.add(entry.root);
    ["front", "back"].forEach(buildDecal);         // re-apply any existing art
    redraw(); kick();
  }

  G.load = function (url) {
    if (_modelCache[url]) { _showModel(_modelCache[url]); return Promise.resolve(_modelCache[url]); }
    showLoading(true);
    return _fetchModel(url).then(
      (entry) => { _showModel(entry); showLoading(false); return entry; },
      (err) => { showLoading(false); throw err; });
  };

  // -------------------------------------------------------------- colour -- //
  function redraw() {
    if (!texCanvas) return;
    const ctx = texCanvas.getContext("2d");
    ctx.fillStyle = garmentColor; ctx.fillRect(0, 0, TEX, TEX);
    if (DEBUG_GRID) drawGrid(ctx);
    if (tex) tex.needsUpdate = true;
    kick();
  }
  G.setColor = function (hex) { garmentColor = hex || "#d7dade"; redraw(); };

  function drawGrid(ctx) {
    ctx.save(); ctx.font = "bold 18px monospace"; ctx.textBaseline = "top";
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, px = t * TEX;
      ctx.strokeStyle = (i === 5) ? "#f00" : "rgba(0,0,0,.4)"; ctx.lineWidth = (i === 5) ? 4 : 1;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, TEX); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, px); ctx.lineTo(TEX, px); ctx.stroke();
    }
    ctx.restore();
  }

  // --------------------------------------------------------------- print -- //
  // Drop a flat, uniform background out of a print so only the motif lands on the
  // garment — a white-bg design on a white shirt stops showing a mismatched panel,
  // and the orange moth reads as printed, not pasted on. Edge flood-fill with a
  // border-uniformity guard, so full-bleed artwork is left untouched; images that
  // already carry transparency are returned unchanged. Work at ≤1024px (cheap +
  // plenty for an on-screen chest print).
  function knockoutBg(img) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return img;
    const k = Math.min(1, 1024 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    let data; try { data = ctx.getImageData(0, 0, w, h); } catch (e) { return img; }  // tainted → bail
    const px = data.data;
    const corners = [0, w - 1, (h - 1) * w, (h - 1) * w + (w - 1)];
    if (corners.some((p) => px[p * 4 + 3] < 250)) return img;        // already cut-out (alpha PNG)
    let br = 0, bg = 0, bb = 0;
    corners.forEach((p) => { const i = p * 4; br += px[i]; bg += px[i + 1]; bb += px[i + 2]; });
    br /= 4; bg /= 4; bb /= 4;
    const t2 = 46 * 46;
    const near = (i) => { const a = px[i] - br, b = px[i + 1] - bg, c = px[i + 2] - bb; return a * a + b * b + c * c < t2; };
    let border = 0, match = 0;
    for (let x = 0; x < w; x++) { border += 2; if (near(x * 4)) match++; if (near(((h - 1) * w + x) * 4)) match++; }
    for (let y = 0; y < h; y++) { border += 2; if (near((y * w) * 4)) match++; if (near((y * w + w - 1) * 4)) match++; }
    if (match / border < 0.62) return img;                          // full-bleed art — keep it
    const seen = new Uint8Array(w * h), st = [];
    for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
    while (st.length) {
      const p = st.pop(); if (seen[p]) continue; seen[p] = 1;
      const i = p * 4; if (!near(i)) continue;
      px[i + 3] = 0;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) st.push(p - 1); if (x < w - 1) st.push(p + 1);
      if (y > 0) st.push(p - w); if (y < h - 1) st.push(p + w);
    }
    ctx.putImageData(data, 0, 0);
    return cv;
  }

  G.setArt = function (s, source, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!source) { artImg[s] = null; if (art[s]) art[s].dispose(); art[s] = null; buildDecal(s); resolve(); return; }
      const done = (img) => {
        artImg[s] = img;
        const src = opts.knockout ? knockoutBg(img) : img;   // blend the print into the fabric
        const t = new THREE.Texture(src);
        t.encoding = THREE.sRGBEncoding; t.needsUpdate = true; t.anisotropy = 4;
        if (art[s]) art[s].dispose(); art[s] = t;
        buildDecal(s); resolve(img);
      };
      if (source.naturalWidth || source.width) { done(source); return; }
      const img = new Image(); img.crossOrigin = "anonymous";
      img.onload = () => done(img); img.onerror = () => resolve(null); img.src = source;
    });
  };

  G.setPlacement = function (s, p) { placement[s] = Object.assign({}, placement[s], p || {}); buildDecal(s); };
  G.getPlacement = function (s) { return Object.assign({}, placement[s]); };

  // Landing showcase helpers (no effect on the studio, which never calls them).
  G.setAutoSpin = function (on) {
    autoSpin = !!on;
    if (controls) { controls.autoRotate = !!on; controls.autoRotateSpeed = 1.1; }
    if (on && resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  };
  G.lockPlacement = function (on) { _lockPlacement = !!on; };

  function removeDecal(s) {
    if (decal[s]) { scene.remove(decal[s]); decal[s].geometry.dispose(); decal[s].material.dispose(); decal[s] = null; }
  }

  function buildDecal(s) {
    if (!mesh) return;
    removeDecal(s);
    if (!art[s]) { kick(); return; }
    const a = AREA[s], p = placement[s];
    const img = artImg[s];
    const aspect = (img.naturalWidth || img.width) / (img.naturalHeight || img.height) || 1;
    let w = Math.max(0.02, p.scale) * a.w, h;
    if (p.scale_y) { h = Math.max(0.02, p.scale_y) * a.h; }       // free stretch
    else { h = w / aspect; if (h > a.h) { h = a.h; w = h * aspect; } }
    const wx = a.cx + (p.cx - 0.5) * a.w * (a.back ? -1 : 1);
    const wy = a.cy + (0.5 - p.cy) * a.h;
    const pos = new THREE.Vector3(wx, wy, a.z);
    const roll = (p.rotation || 0) * Math.PI / 180;
    const orient = new THREE.Euler(0, a.back ? Math.PI : 0, (a.back ? -1 : 1) * roll);
    const size = new THREE.Vector3(w, h, DECAL_DEPTH);
    let geo;
    try { geo = new THREE.DecalGeometry(mesh, pos, orient, size); }
    catch (e) { console.warn("[garment3d] decal failed", e); return; }
    const dmat = new THREE.MeshStandardMaterial({
      map: art[s], transparent: true, roughness: 0.9, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, dmat);
    decal[s] = m; scene.add(m); kick();
  }

  // ---------------------------------------------------------- side / cam -- //
  G.setSide = function (s) {
    side = (s === "back") ? "back" : "front";
    autoSpin = false; if (controls) controls.autoRotate = false;
    setCam(side, fitDist, true); kick();
  };
  function setCam(s, dist, tween) {
    const az = (s === "back") ? Math.PI : 0;
    if (tween) { targetAzimuth = az; haveAzTarget = true; }
    else {
      const d = dist || fitDist;
      camera.position.set(Math.sin(az) * d, 0.02, Math.cos(az) * d);
      controls.target.set(0, 0.02, 0); controls.update();
    }
  }

  G.dispose = function () {
    running = false; if (rafId) cancelAnimationFrame(rafId);
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
    if (ro) ro.disconnect(); if (io) io.disconnect(); if (renderer) renderer.dispose();
  };

  // --------------------------------------------------------- diagnostics -- //
  G.debug = function () {
    return { hasMesh: !!mesh, matType: mat && mat.type, mapSet: !!(mat && mat.map),
      isCanvasTex: !!(mat && mat.map && mat.map.isCanvasTexture),
      color: mat && mat.color ? "#" + mat.color.getHexString() : null, garmentColor,
      decalFront: !!decal.front, decalBack: !!decal.back, artFront: !!art.front,
      autoSpin: autoSpin, autoRotate: !!(controls && controls.autoRotate), onscreen: onscreen,
      camPos: camera ? camera.position.toArray().map((n) => +n.toFixed(2)) : null,
      fitDist: +fitDist.toFixed(2),
      modelNDC: (mesh && camera) ? (function () {
        const v = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        v.project(camera); return { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) };
      })() : null,
      uvAttr: !!(mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.uv) };
  };
  G.probeUV = function () {
    if (!mesh) return null;
    const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const bb = { yMin: 1e9, yMax: -1e9, zMin: 1e9, zMax: -1e9, xMax: -1e9 };
    for (let i = 0; i < pos.count; i++) {
      bb.yMin = Math.min(bb.yMin, pos.getY(i)); bb.yMax = Math.max(bb.yMax, pos.getY(i));
      bb.zMin = Math.min(bb.zMin, pos.getZ(i)); bb.zMax = Math.max(bb.zMax, pos.getZ(i));
      bb.xMax = Math.max(bb.xMax, Math.abs(pos.getX(i)));
    }
    return { bbox: bb };
  };

  // ------------------------------------------------------------- pointer -- //
  function bindPlacementPointer() {
    const host = stage;
    const hit = (ev) => {
      const r = canvasEl.getBoundingClientRect();
      pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      return mesh ? raycaster.intersectObject(mesh, false)[0] : null;
    };
    const sideOf = (h) => {
      const n = h.face ? h.face.normal.clone().transformDirection(mesh.matrixWorld) : null;
      return (n && n.z < 0) ? "back" : "front";
    };
    const apply = (h) => {
      const s = sideOf(h);
      if (!art[s]) return;
      const a = AREA[s], wp = h.point;          // world hit point on the surface
      let cx = (wp.x - a.cx) / a.w * (a.back ? -1 : 1) + 0.5;
      let cy = 0.5 - (wp.y - a.cy) / a.h;
      placement[s].cx = Math.min(1, Math.max(0, cx));
      placement[s].cy = Math.min(1, Math.max(0, cy));
      buildDecal(s);
      if (onPlacement) onPlacement(s, G.getPlacement(s));
    };
    const onMove = (ev) => { if (!dragging) return; const h = hit(ev); if (h) apply(h); };
    const onUp = () => { if (!dragging) return; dragging = false; scheduleResume(2000); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    host.addEventListener("pointerdown", (ev) => {
      if (_lockPlacement) return;            // showcase: let OrbitControls spin instead
      const h = hit(ev); if (!h) return;
      const s = sideOf(h); if (!art[s]) return;
      dragging = true; pauseSpin();
      ev.stopPropagation(); ev.preventDefault();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      apply(h);
    }, true);
    host.addEventListener("wheel", (ev) => {
      if (_lockPlacement) return;            // showcase: wheel = zoom (OrbitControls)
      const h = hit(ev); if (!h) return;
      const s = sideOf(h); if (!art[s]) return;
      ev.stopPropagation(); ev.preventDefault();
      const p = placement[s];
      p.scale = Math.min(1, Math.max(0.06, p.scale * (ev.deltaY < 0 ? 1.06 : 0.94)));
      buildDecal(s);
      if (onPlacement) onPlacement(s, G.getPlacement(s));
    }, { capture: true, passive: false });
  }

  // ------------------------------------------------------------ idle spin -- //
  function pauseSpin() {
    autoSpin = false;
    if (controls) controls.autoRotate = false;
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  }
  function scheduleResume(delay) {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      resumeTimer = null; autoSpin = true;
      if (controls) controls.autoRotate = true;
    }, delay || 2000);
  }

  // ---------------------------------------------------------------- loop -- //
  // Render every visible frame: smooth idle spin, smooth drag, smooth inertial
  // damping, and instant recolour (no stale-frame freeze after interaction).
  // Paused when the tab is hidden or the stage is scrolled off-screen.
  function kick() {}   // retained as a no-op; the loop now renders continuously
  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (document.hidden || !onscreen || !renderer) return;
    if (haveAzTarget) {
      const cur = controls.getAzimuthalAngle();
      let diff = targetAzimuth - cur;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) < 0.005) haveAzTarget = false;
      else {
        const d = camera.position.length(), na = cur + diff * 0.18;
        camera.position.set(Math.sin(na) * d, camera.position.y, Math.cos(na) * d);
      }
    }
    controls.update();              // advances autoRotate + damping inertia
    renderer.render(scene, camera);
  }
})();
