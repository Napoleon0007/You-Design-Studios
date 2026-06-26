// collection-mobius.js — TRUEF Studios design collection on a Möbius strip.
// Identical look + feel to the Keyside hero strip: real parametric Möbius
// geometry, design images tiled on the band, drag-to-spin with inertia,
// tactile hover bulge + orange glow, neon edge tube, sparkle bead.
// Vanilla IIFE — expects THREE global (three.min.js loaded before this).

(function () {
  'use strict';

  var canvas  = document.getElementById('collectionCanvas');
  var labels  = document.getElementById('collectionLabels');
  var section = document.getElementById('collection');
  if (!canvas || !section) return;

  // WebGL gate — bail silently, CSS layout remains intact.
  try {
    var probe = document.createElement('canvas').getContext('webgl');
    if (!probe) return;
  } catch (e) { return; }

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Geometry constants ───────────────────────────────────────────────────
  var R     = 65;    // compact enough that the full Möbius twist reads clearly
  var WIDTH = 18;    // narrower ribbon — twist is more legible
  var SEG_U = 220;   // segments around the loop
  var SEG_V = 14;    // segments across the ribbon width

  var PANELS = [];

  var renderer, scene, camera, root, spinner, band, edge, raycaster, ndc, edgeCurve, bead;
  var inited = false, running = false, raf = 0;
  var lastHoverU = -1, hoverActive = false, edgeS = 0;

  // ── Fetch design list from the API, then boot ─────────────────────────────
  function fetchDesigns(cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/designs');
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.ok && data.designs && data.designs.length) {
            PANELS = data.designs.map(function (d) {
              return {
                img:   d.url,
                label: d.title,
                href:  '/studio?design=' + encodeURIComponent(d.id),
              };
            });
          }
        } catch (e) {}
      }
      cb();
    };
    xhr.onerror = cb;
    xhr.send();
  }

  // ── Three.js init ─────────────────────────────────────────────────────────
  function init() {
    inited = true;

    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: true, alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (e) { return; }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth <= 768 ? 1.5 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearAlpha(0);   // transparent canvas → CSS white bg shows through

    scene  = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 4000);
    camera.position.set(0, 0, 385);

    root = new THREE.Group();
    root.rotation.x = -1.05;   // tilted forward — band surface reads clearly, twist is obvious
    root.position.y = 22;
    scene.add(root);

    spinner = new THREE.Group();   // this group revolves on drag / idle
    root.add(spinner);

    // neutral white lights so design thumbnails stay true-colour
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    var key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(120, 160, 220);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-160, -80, -120);
    scene.add(rim);

    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();

    buildBand();
    buildEdge();
    bindControls();
    resize();
    window.addEventListener('resize', resize);
    start();
  }

  // ── Möbius surface ────────────────────────────────────────────────────────
  // x = (R + w·v·cos(u/2))·cos(u),  y = (…)·sin(u),  z = w·v·sin(u/2)
  // One half-twist over u: 0→2π means the band closes onto its own back.
  function buildBand() {
    var pos = [], uv = [], idx = [];
    var i, j;
    for (i = 0; i <= SEG_U; i++) {
      var u = (i / SEG_U) * Math.PI * 2;
      var t = u / 2;
      var cu = Math.cos(u), su = Math.sin(u), ct = Math.cos(t), st = Math.sin(t);
      for (j = 0; j <= SEG_V; j++) {
        var v = (j / SEG_V - 0.5) * 2;
        var rad = R + WIDTH * v * ct;
        pos.push(rad * cu, rad * su, WIDTH * v * st);
        uv.push(i / SEG_U, j / SEG_V);
      }
    }
    for (i = 0; i < SEG_U; i++) {
      for (j = 0; j < SEG_V; j++) {
        var a = i * (SEG_V + 1) + j, b = a + SEG_V + 1, c = a + 1, d = b + 1;
        idx.push(a, b, c, c, b, d);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    var tex = buildTexture();
    var mat = new THREE.MeshPhysicalMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1.15,
      side: THREE.DoubleSide, metalness: 0.0, roughness: 0.85,
      clearcoat: 0.0, envMapIntensity: 0.0,
    });

    // Tactile hover: bulge the touched spot outward + orange glow.
    // Injected into the physical shader — GPU-cheap, same as Keyside.
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uHoverU   = { value: -1 };
      shader.uniforms.uHoverAmt = { value: 0 };
      shader.uniforms.uLift     = { value: 16 };
      shader.vertexShader =
        'uniform float uHoverU, uHoverAmt, uLift;\n' +
        'varying float vHover;\nvarying float vViewZ;\n' +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'float du = uv.x - uHoverU; du = du - floor(du + 0.5);\n' +
        'float g = exp(-du * du / 0.0022) * uHoverAmt;\n' +
        'vHover = g;\n' +
        'transformed += normalize(objectNormal) * g * uLift;'
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n         vViewZ = -mvPosition.z;'
      );
      shader.fragmentShader =
        'varying float vHover;\nvarying float vViewZ;\n' +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'totalEmissiveRadiance += vec3(1.0, 0.55, 0.18) * vHover * 1.8;'
      );
      // Depth fade: far side darkens so it recedes into the dark bg image.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n' +
        'float df = smoothstep(380.0, 120.0, vViewZ);\n' +
        'gl_FragColor.rgb *= mix(0.55, 1.0, df);'
      );
      mat.userData.shader = shader;
    };

    band = new THREE.Mesh(geo, mat);
    spinner.add(band);
  }

  // ── Möbius edge: single closed neon tube (loops twice before closing) ─────
  function buildEdge() {
    var pts = [];
    var STEPS = SEG_U * 2;
    for (var i = 0; i < STEPS; i++) {
      var u = (i / SEG_U) * Math.PI * 2;
      var t = u / 2;
      var rad = R + WIDTH * Math.cos(t);
      pts.push(new THREE.Vector3(rad * Math.cos(u), rad * Math.sin(u), WIDTH * Math.sin(t)));
    }
    edgeCurve = new THREE.CatmullRomCurve3(pts, true);
    var geo2 = new THREE.TubeGeometry(edgeCurve, STEPS, 1.4, 8, true);
    edge = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial({ color: 0xff5500 }));
    spinner.add(edge);

    // bright sparkle that rides the single Möbius edge round and round
    bead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: beadSprite(), color: 0xffd9a0, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    bead.scale.set(11, 11, 1);
    spinner.add(bead);
  }

  function beadSprite() {
    var s = 64, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    var g = cv.getContext('2d');
    var rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0,   'rgba(255,255,255,1)');
    rg.addColorStop(0.3, 'rgba(255,210,150,0.9)');
    rg.addColorStop(1,   'rgba(255,140,40,0)');
    g.fillStyle = rg; g.fillRect(0, 0, s, s);
    var t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }

  // ── Strip texture: each design image cover-fit into its cell ─────────────
  function buildTexture() {
    var N = PANELS.length || 1;
    var CELL = Math.min(320, Math.floor(4080 / N)), H = 320, W = CELL * N;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g  = cv.getContext('2d');
    var tex = new THREE.CanvasTexture(cv);
    tex.encoding  = THREE.sRGBEncoding;
    tex.wrapS     = THREE.RepeatWrapping;
    tex.anisotropy = 8;

    PANELS.forEach(function (p, i) {
      paintCell(g, tex, i, null, p, CELL, H);
      if (p.img) {
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload  = function () { paintCell(g, tex, i, im, p, CELL, H); };
        im.onerror = function () {};
        im.src = p.img;
      }
    });
    return tex;
  }

  function paintCell(g, tex, i, img, p, CELL, H) {
    var x0 = i * CELL;
    g.save();
    g.beginPath(); g.rect(x0, 0, CELL, H); g.clip();
    if (img) {
      // full-colour thumbnail, cover-fit, no tint — let the design pop.
      g.fillStyle = '#08040a'; g.fillRect(x0, 0, CELL, H);
      var sc = Math.max(CELL / img.width, H / img.height);
      var w = img.width * sc, h = img.height * sc;
      g.drawImage(img, x0 + (CELL - w) / 2, (H - h) / 2, w, h);
    } else {
      var grad = g.createLinearGradient(x0, 0, x0 + CELL, H);
      grad.addColorStop(0,    '#1a0a02');
      grad.addColorStop(0.55, '#3a1402');
      grad.addColorStop(1,    '#ff5500');
      g.fillStyle = grad; g.fillRect(x0, 0, CELL, H);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = '12px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.label || '', x0 + CELL / 2, H / 2);
    }
    // thin neon divider between cells
    g.fillStyle = 'rgba(255,85,0,.55)'; g.fillRect(x0, 0, 2, H);
    g.restore();
    tex.needsUpdate = true;
  }

  // ── Controls: drag-spin + inertia + idle auto-revolve ─────────────────────
  var dragging = false, lastX = 0, downX = 0, downY = 0, moved = false, vel = 0;
  var dirLocked = false;
  var idleTimer = null, idleActive = true;

  function bindControls() {
    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; moved = false; vel = 0; dirLocked = false;
      lastX = downX = e.clientX; downY = e.clientY;
      canvas.classList.add('is-grabbing');
      // Capture immediately for mouse — no scroll conflict; delay for touch
      if (e.pointerType !== 'touch') {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      }
      wake();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (dragging) {
        if (!dirLocked) {
          var adx = Math.abs(e.clientX - downX);
          var ady = Math.abs(e.clientY - downY);
          if (adx + ady < 8) return; // wait for clear intent
          if (ady > adx * 1.2) {
            // Primarily vertical swipe — release drag, let page scroll
            dragging = false;
            canvas.classList.remove('is-grabbing');
            return;
          }
          // Primarily horizontal — capture and spin
          dirLocked = true;
          if (e.pointerType === 'touch') {
            try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
          }
        }
        var dx = e.clientX - lastX; lastX = e.clientX;
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true;
        vel = dx * 0.006;
        spinner.rotation.z += vel;
      } else {
        hoverAt(e);
      }
    });
    var release = function (e) {
      if (!dragging) return;
      dragging = false; dirLocked = false;
      canvas.classList.remove('is-grabbing');
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!moved) clickAt(e);
      wake();
    };
    canvas.addEventListener('pointerup',     release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave',  function () { dragging = false; dirLocked = false; clearHover(); });
  }

  function wake() {
    idleActive = false;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { idleActive = true; }, 2600);
  }

  function setNDC(e) {
    var r = canvas.getBoundingClientRect();
    ndc.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    ndc.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }
  function pick(e) {
    setNDC(e);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(band, false)[0];
  }
  function cellOf(hit) {
    var off = (band && band.material.map) ? band.material.map.offset.x : 0;
    var f = (hit.uv.x + off) % 1; if (f < 0) f += 1;
    var N = PANELS.length || 1;
    return Math.min(N - 1, Math.floor(f * N));
  }

  var hoverCell = -1;
  function hoverAt(e) {
    var hit = pick(e);
    if (!hit) { clearHover(); return; }
    var i = cellOf(hit);
    canvas.style.cursor = 'pointer';
    lastHoverU = hit.uv.x;
    hoverActive = true;
    if (i !== hoverCell) { hoverCell = i; showLabel(i); }
    moveLabel(e);
  }
  function clearHover() {
    hoverCell = -1; hoverActive = false; canvas.style.cursor = 'grab';
    var el = labels && labels.firstChild; if (el) el.classList.remove('show');
  }
  function showLabel(i) {
    var p = PANELS[i]; if (!p || !labels) return;
    labels.innerHTML =
      '<div class="mobius-label show">' +
        '<span class="mobius-kicker">TRUEF STUDIOS</span>' +
        esc(p.label) +
        '<span class="mobius-enter">Design ▸</span>' +
      '</div>';
  }
  function moveLabel(e) {
    var el = labels && labels.firstChild; if (!el) return;
    var r = canvas.getBoundingClientRect();
    el.style.left = (e.clientX - r.left) + 'px';
    el.style.top  = (e.clientY - r.top)  + 'px';
  }
  function clickAt(e) {
    var hit = pick(e); if (!hit) return;
    var p = PANELS[cellOf(hit)];
    if (p && p.href) window.location.href = p.href;
  }

  // ── Render loop ───────────────────────────────────────────────────────────
  function start() { if (!running) { running = true; raf = requestAnimationFrame(tick); } }
  function stop()  { running = false; cancelAnimationFrame(raf); }

  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    if (!dragging) {
      // Always apply velocity while it decays — never dead-stop between drag end
      // and idle resuming (the old 0.0002 threshold caused a visible freeze).
      if (Math.abs(vel) > 0.00005) {
        spinner.rotation.z += vel;
        vel *= 0.94;
      } else {
        vel = 0;
        if (!reduced) spinner.rotation.z += 0.0016;
      }
    }
    if (band && !reduced) {
      var m = band.material.map;
      m.offset.x = (m.offset.x + 0.0007) % 1;
    }
    var sh = band && band.material.userData.shader;
    if (sh) {
      var tgt = hoverActive ? 1 : 0;
      sh.uniforms.uHoverAmt.value += (tgt - sh.uniforms.uHoverAmt.value) * 0.15;
      if (hoverActive) sh.uniforms.uHoverU.value = lastHoverU;
    }
    if (bead && edgeCurve) {
      edgeS = (edgeS + (reduced ? 0 : 0.0011)) % 1;
      bead.position.copy(edgeCurve.getPointAt(edgeS));
      var tw = 0.8 + 0.35 * Math.sin(edgeS * 44.0);
      bead.scale.set(11 * tw, 11 * tw, 1);
    }
    renderer.render(scene, camera);
  }

  function resize() {
    var wrap = canvas.parentElement;
    var isMobile = window.innerWidth < 700;
    var w = (wrap ? wrap.clientWidth  : 0) || section.clientWidth  || window.innerWidth;
    var h = (wrap ? wrap.clientHeight : 0) || section.clientHeight || window.innerHeight || (isMobile ? 667 : 900);
    if (w < 10 || h < 10) return;   // layout not ready yet — skip
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = isMobile ? 232 : 182;   // mobile pulled back a touch (smaller ring); desktop bigger
    // Centre the ring in the full-screen canvas with a slight upward offset
    // so the heading text peeks above without being covered by the ring.
    root.position.y = isMobile ? 12 : 18;
    // Ring stays centred (symmetrical) on every device.
    root.position.x = 0;
    camera.updateProjectionMatrix();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Boot on page load; run loop continuously — no IntersectionObserver stop/start,
  // which was the source of the strip freezing mid-spin on mobile.
  // Only pause when the browser tab goes to background.
  fetchDesigns(function () {
    if (!PANELS.length) return;
    init();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (inited) start();
    });
  });
})();
