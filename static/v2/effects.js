/* =============================================================
 *  Visual effects layer — v2 landing page
 *  2. Cursor paint trail — garment-colour dots that fade behind the cursor
 *  3. Live toasts       — SA social-proof notifications
 *  4. Ink-drop transitions — radial colour bloom on section entry
 *  9. Portal CTA        — particle burst before navigating to /studio
 * ============================================================= */
(function () {
  "use strict";

  /* ── 2. CURSOR PAINT TRAIL ──────────────────────────────────────────────── */
  function initCursorTrail() {
    // Touch-only devices don't have a cursor — skip entirely
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;

    var lastX = -999, lastY = -999;
    var MIN_DIST_SQ = 225; // minimum 15px between dots

    window.addEventListener("mousemove", function (e) {
      var dx = e.clientX - lastX;
      var dy = e.clientY - lastY;
      if (dx * dx + dy * dy < MIN_DIST_SQ) return;
      lastX = e.clientX;
      lastY = e.clientY;

      var color = getComputedStyle(document.documentElement)
        .getPropertyValue("--garment-reflect").trim() || "#e8001d";

      var size = 7 + Math.random() * 9;
      var d    = document.createElement("div");
      d.style.cssText = [
        "position:fixed",
        "left:" + e.clientX + "px",
        "top:" + e.clientY + "px",
        "width:" + size + "px",
        "height:" + size + "px",
        "border-radius:50%",
        "background:" + color,
        "pointer-events:none",
        "z-index:9200",
        "transform:translate(-50%,-50%) scale(1)",
        "opacity:0.7",
        "transition:opacity 0.5s ease,transform 0.5s ease",
        "will-change:opacity,transform"
      ].join(";");
      document.body.appendChild(d);

      // Kick the fade on next paint
      requestAnimationFrame(function () {
        d.style.opacity   = "0";
        d.style.transform = "translate(-50%,-50%) scale(0.15)";
      });

      setTimeout(function () { d.remove(); }, 550);
    }, { passive: true });
  }


  /* ── 9. PORTAL CTA TRANSITION ───────────────────────────────────────────── */
  function initPortalCTA() {
    function burst(cx, cy, color) {
      var n = 28;
      for (var i = 0; i < n; i++) {
        (function (i) {
          var angle  = (i / n) * Math.PI * 2;
          var dist   = 60 + Math.random() * 110;
          var size   = 5 + Math.random() * 8;
          var p      = document.createElement("div");
          p.style.cssText = [
            "position:fixed",
            "left:" + cx + "px",
            "top:" + cy + "px",
            "width:" + size + "px",
            "height:" + size + "px",
            "border-radius:50%",
            "background:" + color,
            "pointer-events:none",
            "z-index:9999",
            "transform:translate(-50%,-50%)",
            "transition:all 0.52s cubic-bezier(0.15,0.85,0.3,1)"
          ].join(";");
          document.body.appendChild(p);

          var tx = (Math.cos(angle) * dist).toFixed(1);
          var ty = (Math.sin(angle) * dist).toFixed(1);
          requestAnimationFrame(function () {
            p.style.transform =
              "translate(calc(-50% + " + tx + "px), calc(-50% + " + ty + "px)) scale(0.08)";
            p.style.opacity = "0";
          });
          setTimeout(function () { p.remove(); }, 580);
        }(i));
      }
    }

    document.querySelectorAll(".hiw-btn, .btn-pill").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var href = this.getAttribute("href");
        if (!href || href === "#" || href.charAt(0) === "#") return;
        e.preventDefault();
        var self = this;

        var rect  = self.getBoundingClientRect();
        var cx    = rect.left + rect.width  / 2;
        var cy    = rect.top  + rect.height / 2;
        var color = getComputedStyle(document.documentElement)
          .getPropertyValue("--garment-reflect").trim() || "#e8001d";

        self.classList.add("portal-fired");
        burst(cx, cy, color);
        setTimeout(function () { window.location.href = href; }, 460);
      });
    });
  }


  /* ── BOOT ───────────────────────────────────────────────────────────────── */
  function boot() {
    try { initCursorTrail();     } catch (e) { console.warn("trail:", e); }
    try { initPortalCTA();       } catch (e) { console.warn("portal:", e); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}());
