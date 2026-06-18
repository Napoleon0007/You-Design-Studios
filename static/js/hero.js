/* =============================================================
 *  INKHAUS hero — frame-sequence scroll-scrub (Apple-style)
 *  The turning man is rendered to a <canvas>; scroll progress
 *  drives the frame index, so he literally rotates as you scroll
 *  and stays pinned (sticky) with us through the runway.
 * ============================================================= */
(() => {
  "use strict";

  const cfg = window.HERO || {};
  const N = cfg.frames || 121;
  const PAD = cfg.pad || 3;
  const BASE = cfg.base || "/static/media/hero_seq/";
  const PREFIX = cfg.prefix || "f_";
  const EXT = cfg.ext || ".jpg";

  const canvas = document.getElementById("heroCanvas");
  const loader = document.getElementById("heroLoader");
  const ctx = canvas ? canvas.getContext("2d", { alpha: false }) : null;

  const images = new Array(N);
  let loaded = 0;
  let ready = false;
  let firstReady = false;
  let curFrame = -1;
  let lastDrawn = -1;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- preload frame sequence ------------------------------------------- //
  function url(i) {
    return BASE + PREFIX + String(i + 1).padStart(PAD, "0") + EXT;
  }
  function preload() {
    // request the first frame first so it arrives fastest
    for (let i = 0; i < N; i++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = () => onFrameLoaded(i);
      img.src = url(i);
      images[i] = img;
    }
  }

  // Reveal the first frame the instant it's ready and stream the rest in the
  // background. Mobile no longer stares at a blank loader — the figure appears
  // fast and the scrub sharpens as more frames arrive.
  function onFrameLoaded() {
    loaded++;
    if (!firstReady && images[0] && images[0].naturalWidth) {
      firstReady = true; ready = true;
      if (loader) loader.classList.add("hide");
      sizeCanvas();
      draw(0, true);
      if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
    } else if (!firstReady && loader) {
      loader.textContent = "Loading studio " + Math.round((loaded / N) * 100) + "%";
    }
    if (loaded === N && typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
  }

  // ---- canvas sizing (DPR-aware, cover fit) ----------------------------- //
  function sizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (ready) draw(curFrame < 0 ? 0 : curFrame, true);
  }

  // nearest already-loaded frame to `i` (so scrubbing works mid-preload)
  function nearestLoaded(i) {
    for (let d = 0; d < N; d++) {
      const a = i - d, b = i + d;
      if (a >= 0 && images[a] && images[a].naturalWidth) return a;
      if (b < N && images[b] && images[b].naturalWidth) return b;
    }
    return -1;
  }

  function draw(i, force) {
    if (!ctx) return;
    i = Math.max(0, Math.min(N - 1, i | 0));
    const idx = (images[i] && images[i].naturalWidth) ? i : nearestLoaded(i);
    if (idx < 0) return;
    if (idx === lastDrawn && !force) return;
    lastDrawn = idx; curFrame = i;
    const img = images[idx];

    const cw = canvas.width, ch = canvas.height;
    const ir = img.naturalWidth / img.naturalHeight;
    const cr = cw / ch;
    let dw, dh, dx, dy;
    if (cr > ir) { dw = cw; dh = cw / ir; dx = 0; dy = (ch - dh) / 2; }
    else { dh = ch; dw = ch * ir; dy = 0; dx = (cw - dw) / 2; }
    ctx.fillStyle = "#f7f5f0";
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // ---- trapezoidal opacity helper (continuous, scrub-friendly) ---------- //
  function band(p, a, b, c, d) {
    if (p <= a || p >= d) return 0;
    if (p < b) return (p - a) / (b - a);
    if (p > c) return 1 - (p - c) / (d - c);
    return 1;
  }
  // monotonic fade from 1 -> 0 across [a,b]; stays 0 after (no reappearance)
  function fadeOut(p, a, b) {
    if (p <= a) return 1;
    if (p >= b) return 0;
    return 1 - (p - a) / (b - a);
  }
  const $ = (s) => document.querySelector(s);
  const elTop = $(".hero-top");
  const caps = Array.from(document.querySelectorAll(".hero-cap"));
  const elEnd = $(".hero-end");
  const elHint = $(".scroll-hint");

  function setText(p) {
    if (elTop) {
      elTop.style.opacity = fadeOut(p, 0.15, 0.28);
      elTop.style.transform = `translateY(${(-p * 50).toFixed(1)}px)`;
    }
    if (caps[0]) caps[0].style.opacity = band(p, 0.20, 0.27, 0.36, 0.44);
    if (caps[1]) caps[1].style.opacity = band(p, 0.42, 0.49, 0.58, 0.66);
    if (caps[2]) caps[2].style.opacity = band(p, 0.64, 0.71, 0.80, 0.88);
    if (elEnd) {
      const o = p < 0.86 ? 0 : Math.min(1, (p - 0.86) / 0.07);
      elEnd.style.opacity = o;
      elEnd.style.pointerEvents = o > 0.6 ? "auto" : "none";
    }
    if (elHint) elHint.style.opacity = fadeOut(p, 0.02, 0.08);
  }

  function render(p) {
    draw(Math.round(p * (N - 1)));
    setText(p);
  }

  // ---- wire to scroll ---------------------------------------------------- //
  function initScroll() {
    const hero = document.querySelector(".hero");
    if (!hero) return;
    if (reduced || typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
      // Fallback: plain scroll listener.
      const onScroll = () => {
        const r = hero.getBoundingClientRect();
        const total = hero.offsetHeight - window.innerHeight;
        const p = Math.max(0, Math.min(1, -r.top / total));
        render(p);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.create({
      trigger: hero,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.6,
      onUpdate: (self) => render(self.progress),
    });
    render(0);
  }

  // ---- nav solidify + reveals + cursor + marquee dup -------------------- //
  function chrome() {
    const nav = document.querySelector(".nav");
    const onScroll = () => {
      if (nav) nav.classList.toggle("solid", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.18 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    // mobile perf: only play videos that are on screen (poster + preload=none means
    // they don't even download until needed), pause the rest.
    const vids = document.querySelectorAll("video");
    if (vids.length) {
      const vio = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          const v = e.target;
          if (e.isIntersecting) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
          else v.pause();
        });
      }, { threshold: 0.2 });
      vids.forEach((v) => vio.observe(v));
    }

    // custom cursor (fine pointers only)
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (fine) {
      const cur = document.createElement("div");
      cur.className = "cursor";
      document.body.appendChild(cur);
      let x = 0, y = 0, cx = 0, cy = 0;
      window.addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; });
      const loop = () => { cx += (x - cx) * 0.2; cy += (y - cy) * 0.2;
        cur.style.transform = `translate(${cx}px, ${cy}px) translate(-50%,-50%)`;
        requestAnimationFrame(loop); };
      loop();
      document.querySelectorAll("a, button, .card").forEach((el) => {
        el.addEventListener("mouseenter", () => cur.classList.add("hot"));
        el.addEventListener("mouseleave", () => cur.classList.remove("hot"));
      });
    }
  }

  // ---- boot -------------------------------------------------------------- //
  window.addEventListener("resize", sizeCanvas, { passive: true });
  document.addEventListener("DOMContentLoaded", () => {
    sizeCanvas();
    chrome();
    initScroll();
    preload();
  });
})();
