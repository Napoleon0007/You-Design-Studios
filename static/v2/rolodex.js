/* =============================================================
 *  Landing rolodex — flip through the 2D "shirts that have been done".
 *  Cards are built from /api/designs; each shows the pre-rendered shirt
 *  card (/static/v2/cards/<slug>.jpg, falls back to the raw design image).
 *  Native horizontal scroll-snap (swipe on phones) + arrows + dots; the
 *  most-centred card scales up. Mobile-first.
 * ============================================================= */
(() => {
  "use strict";
  const root = document.getElementById("rolodex");
  const track = document.getElementById("rdxTrack");
  const dotsEl = document.getElementById("rdxDots");
  const prev = document.getElementById("rdxPrev");
  const next = document.getElementById("rdxNext");
  if (!root || !track) return;
  const stem = (id) => id.replace(/\.[^.]+$/, "");

  fetch("/api/designs").then((r) => r.json()).then((d) => {
    const designs = (d && d.designs) || [];
    if (!designs.length) { root.style.display = "none"; if (dotsEl) dotsEl.style.display = "none"; return; }

    track.innerHTML = "";
    designs.forEach((g, i) => {
      const a = document.createElement("a");
      a.className = "rdx-card"; a.href = "/studio"; a.dataset.i = i;
      a.innerHTML =
        `<div class="rdx-shot"><img loading="lazy" alt="${g.title}"` +
        ` src="/static/v2/cards/${stem(g.id)}.jpg"` +
        ` onerror="this.onerror=null;this.src='${g.url}';this.classList.add('raw')"></div>` +
        `<div class="rdx-cap"><b>${g.title}</b><span>Make it yours &rarr;</span></div>`;
      track.appendChild(a);
      const dot = document.createElement("button");
      dot.className = "rdx-dot"; dot.type = "button";
      dot.setAttribute("aria-label", "Show " + g.title);
      dot.addEventListener("click", () => center(i));
      dotsEl.appendChild(dot);
    });

    const cards = Array.from(track.children);
    const dots = Array.from(dotsEl.children);
    let active = -1;

    const center = (i) => {
      i = Math.max(0, Math.min(cards.length - 1, i));
      const c = cards[i];
      track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.clientWidth) / 2, behavior: "smooth" });
    };
    const setActive = (i) => {
      if (i === active) return;
      active = i;
      cards.forEach((c, j) => c.classList.toggle("on", j === i));
      dots.forEach((dt, j) => dt.classList.toggle("on", j === i));
    };

    let raf = 0;
    track.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = track.scrollLeft + track.clientWidth / 2;
        let best = 0, bestD = Infinity;
        cards.forEach((c, j) => {
          const dd = Math.abs((c.offsetLeft + c.clientWidth / 2) - mid);
          if (dd < bestD) { bestD = dd; best = j; }
        });
        setActive(best);
      });
    }, { passive: true });

    if (prev) prev.addEventListener("click", () => center(active - 1));
    if (next) next.addEventListener("click", () => center(active + 1));
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") center(active - 1);
      else if (e.key === "ArrowRight") center(active + 1);
    });
    setActive(0);

    // cursor tilt — each card leans toward the pointer like a physical photo print
    // (fine-pointer / desktop only; touch keeps the clean swipe).
    if (window.matchMedia && window.matchMedia("(pointer:fine)").matches) {
      cards.forEach((card) => {
        const shot = card.querySelector(".rdx-shot");
        if (!shot) return;
        card.addEventListener("pointermove", (e) => {
          const r = card.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          shot.style.transform = "rotateX(" + ((0.5 - py) * 12).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * 16).toFixed(2) + "deg)";
          shot.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
          shot.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
          card.classList.add("tilting");
        });
        card.addEventListener("pointerleave", () => {
          shot.style.transform = "rotateX(0) rotateY(0)";
          card.classList.remove("tilting");
        });
      });
    }
  }).catch(() => { root.style.display = "none"; if (dotsEl) dotsEl.style.display = "none"; });
})();
