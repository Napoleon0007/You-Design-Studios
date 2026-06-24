/* =============================================================
 *  Gallery2 — standalone spinning black tee with TRUEF mark.
 *  Uses the already-loaded THREE.js globals (r128 UMD) but
 *  creates its own renderer/scene so it doesn't touch the
 *  singleton Garment3D engine on the landing hero.
 * ============================================================= */
(() => {
  "use strict";
  const THREE = window.THREE;
  if (!THREE) return;

  const canvas = document.getElementById("gallery3d");
  if (!canvas) return;

  // Bail early if WebGL unavailable
  try {
    const t = document.createElement("canvas");
    if (!(t.getContext("webgl2") || t.getContext("webgl"))) return;
  } catch (e) { return; }

  // ── Renderer ────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.physicallyCorrectLights = true;

  // ── Scene + camera ──────────────────────────────────────────
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  camera.position.set(0, 0.04, 3.4);

  // ── Lighting (matches landing hero mood) ────────────────────
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1.5, 2.5, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xddddff, 0.35);
  fill.position.set(-2, 0.5, 1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25);
  rim.position.set(0, -1, -2);
  scene.add(rim);

  // ── Resize ──────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth || canvas.offsetWidth || 300;
    const h = canvas.clientHeight || canvas.offsetHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(canvas);
  }
  resize();

  // ── TRUEF brand-mark texture (drawn on canvas) ───────────────
  // Reproduces the framed-T SVG from the nav in white on transparent.
  function makeBrandTex() {
    const S = 512;
    const tc = document.createElement("canvas");
    tc.width = tc.height = S;
    const ctx = tc.getContext("2d");
    ctx.clearRect(0, 0, S, S);

    const scale = S / 100;   // SVG viewBox is 0 0 100 100
    ctx.save();
    ctx.scale(scale, scale);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.fillStyle   = "rgba(255,255,255,0.92)";

    // outer rounded rect
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
    rr(9, 9, 82, 82, 22);
    ctx.stroke();

    // horizontal bar of T
    rr(30, 31, 40, 10.5, 2);
    ctx.fill();

    // vertical stem
    rr(44.75, 31, 10.5, 40, 2);
    ctx.fill();

    // right serif / crossbar
    rr(55, 46, 15.5, 9.5, 2);
    ctx.fill();

    ctx.restore();

    const tex = new THREE.CanvasTexture(tc);
    tex.needsUpdate = true;
    return tex;
  }

  // ── Apply brand decal to loaded model ───────────────────────
  function applyDecal(root, size) {
    if (!THREE.DecalGeometry) return;
    let targetMesh = null;
    root.traverse(c => { if (c.isMesh && !targetMesh) targetMesh = c; });
    if (!targetMesh) return;

    const tex = makeBrandTex();

    // Project onto chest: slightly above-center, just in front of surface
    const pos = new THREE.Vector3(0, size.y * 0.08, size.z * 0.38);
    const ori = new THREE.Euler(0, 0, 0);
    const decalSz = new THREE.Vector3(size.x * 0.38, size.x * 0.38, 0.6);

    const geo = new THREE.DecalGeometry(targetMesh, pos, ori, decalSz);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9,
    });
    const decalMesh = new THREE.Mesh(geo, mat);
    root.add(decalMesh);
  }

  // ── Load tee model ──────────────────────────────────────────
  const loader = new THREE.GLTFLoader();
  const draco  = new THREE.DRACOLoader();
  draco.setDecoderPath("/static/js/threejs/draco/");
  loader.setDRACOLoader(draco);

  let root = null;

  loader.load("/static/models/meshy_tee.glb", (gltf) => {
    const model = gltf.scene;

    // Centre + fit
    const box = new THREE.Box3().setFromObject(model);
    const center = new THREE.Vector3();
    box.getCenter(center);
    model.position.sub(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    model.scale.multiplyScalar(1.55 / maxDim);

    // Recompute size after scale (for decal placement)
    const scaledSize = size.clone().multiplyScalar(1.55 / maxDim);

    // Black shirt
    model.traverse(c => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      c.material.color.set("#111111");
      c.material.roughness = 0.82;
      c.material.metalness = 0.0;
    });

    scene.add(model);
    root = model;

    applyDecal(model, scaledSize);
  });

  // ── Render loop (only while visible) ────────────────────────
  let rafId = null;
  function animate() {
    rafId = requestAnimationFrame(animate);
    if (root) root.rotation.y += 0.006;
    renderer.render(scene, camera);
  }

  if (typeof IntersectionObserver !== "undefined") {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { if (!rafId) animate(); }
        else { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
      });
    }, { threshold: 0.05 });
    io.observe(canvas);
  } else {
    animate();
  }
})();
