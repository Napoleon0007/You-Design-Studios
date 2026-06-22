# Handoff — TRUEF Studios (2026-06-22, late session)

---
## 🚨 TASTE SKILLS DROPPED — INCORPORATE NOW (2026-06-22)

A full design-taste skill stack was just installed **globally** in `~/.claude/skills/` — so **this chat can invoke them directly right now** (they're not project-local; restart/relisting may be needed for them to appear). **Use them on the TRUEF re-skin from here on — do not hand-roll generic UI.**

**Use on TRUEF (front-end heavy Lacoste re-skin):**
- **`impeccable`** or **`design-taste-frontend`** or **`frontend-design`** — pick **ONE** as the base voice for any new/redesigned UI (don't stack — they overlap + bloat context). Anti-slop, non-templated.
- **`taste`** — run `/taste <url>` on a **Lacoste reference page** → it drives a real browser and extracts concrete tokens (hex/px/spacing/radii/shadows) + the *why*. Use this to ground the re-skin in the actual reference instead of guessing.
- **`theme-factory`** — generate/apply a cohesive theme + design tokens for the white editing space / landing.
- **`emil-design-eng`** — for the hero motion / micro-interactions polish (the carousel, garment spin, hover states).
- **`webapp-testing`** — Playwright toolkit: drive `:7460`, screenshot, read console logs. Pairs with Luke's **"prove before showing"** rule + the phone-feel verification still outstanding below.

**Order of operations suggested:** `taste` the Lacoste ref → set tokens via `theme-factory` → build/polish with one base skill + `emil-design-eng` → verify with `webapp-testing` before showing Luke.

(Full inventory + repos in Claude memory: `reference_taste_skill_installed.md`.)

---

> Big build session — all four asks DONE, verified (headless Chrome), **committed (`bb83be6`),
> pushed to GitHub, and DEPLOYED + verified LIVE** on Railway. Brand = all-caps **TRUEF Studios**.
> Live: https://you-design-studios-production.up.railway.app  (`/`, `/studio`, `/printer`).
> `/printer` is gated by `PRINTER_KEY` in prod (401 without it) — Luke has the key.

## ✅ Built tonight (all verified)

### 1) Hero touch-glitch — FIXED + PROVEN (was the 5th attempt)
**Root cause (finally):** the landing carousel swapped the garment **mid-interaction**. Every 6s it ran
`showCombo` (recolour + `setSide('front')` tween + `setAutoSpin(true)` + the `.swapping` blur/scale on the
canvas) — and the old idle timer only reset on pointerdown, so it fired *while a finger was still on the
garment*. That fight = the glitch. (The breathing-lens was a red herring — it's off when the room is off.)
**Fix — `static/v2/landing3d.js`:** stop the carousel the instant a finger lands (`onGrab` → `stopTimer`,
clear any in-progress `.swapping`), resume only after **4.5s idle** (`armResume` on pointerup/pointercancel/
wheel, on `window` so off-canvas release counts), and guard `next()`/`showCombo` with a `userActive` flag.
**Proof (headless):** held a drag **7.5s** (crossing the old 6.5s boundary) → `SWAP_DURING_HOLD:false`,
`autoRotate:false` during drag, garment rotates cleanly, auto-spin resumes ~2.5s after release, **0 errors**.

### 2) Hero 3D "space" — BUILT + verified (the Lacoste reference, brought to life)
A lit studio ROOM behind the floating garment, **pure CSS/DOM so it's decoupled from the WebGL camera
and can't reintroduce the glitch**:
- `static/v2/index.html`: new `.hero-room` (`.room-wall` grid · `.room-floor` perspective grid · `.room-glow`
  spotlight · `.room-vignette`).
- `static/v2/v2.css`: back-wall grid lines (white-alpha) + a **perspective floor** (`rotateX(80deg)`, brighter
  grid) receding to a horizon + a soft **spotlight pool** behind the garment + edge **vignette** + a bigger,
  softer **contact shadow** so the garment floats above the floor. Rides the cycling `--stage-bg` colour.
- `static/v2/landing3d.js`: subtle **parallax** on the room layers (cursor + device-tilt) — DOM transforms only.
- Verified desktop + 390px: grid lines visible ("lines on the wall"), depth reads, garment floats, colour-cycles.
  *(Polish note: on mobile the opening garment is large and the copy overlays it — readable, but could be tuned.)*

### 3) Studio — artwork now prints reliably + front/back + transformer
**The real bug:** uploading the **same file** again (e.g. the same art for the back, or a retry) did nothing
— a file input is silent when its value is unchanged. That's the "I uploaded another artwork and nothing
happened." **Fix — `static/js/studio.js`:** reset `els.file.value=""` after each pick so re-selecting the
same image always re-fires. Confirmed: front **and** back prints build + render, art lands immediately on
upload, and the **transformer** (Width/Height/Rotate sliders + drag-to-move) works. Also anchored the rights
reminder modal to the **bottom** (`templates/studio.html`) so it no longer hides the print as it lands.
Added `artBack` to `G.debug()` (`static/js/garment3d.js`).

### 4) SA printer dashboard — BUILT + verified (the local-SA fulfilment portal)
- `app.py`: `import json`; `/printer` page + `/api/printer/job` API (**accept** → `in_production`,
  **ship** → `shipped` + tracking); `_printer_ok()` gate (`PRINTER_KEY` env, open on dev); `_printer_view()`.
- `templates/printer_dashboard.html`: clean, on-brand, **mobile-first**. Reads REAL orders
  (`submitted`/`in_production`), shows each job's garment/colour/size/qty, **300-DPI print-file download
  buttons** (front/back), the **ship-to address**, provider tag, and Accept / Mark-shipped (with tracking).
- Verified: 8 real jobs render; accept moved an order submitted→in_production; ship → shipped + tracking saved.
- Routing target is provider **`local-sa`**; until a specific shop is wired, all released jobs show.

## 👀 See it now (local dev, :7460)
- Landing + 3D space: `http://127.0.0.1:7460/`  · Studio: `/studio`  · **SA printer dashboard: `/printer`**

## ⏭ Next / open
- ✅ DEPLOYED — `railway up` build live + verified (commit `bb83be6` pushed). `PRINTER_KEY` set on Railway.
- Verify the hero feel on a real phone (headless can't confirm touch feel).
- Polish: mobile opening-garment size vs. copy overlap.
- SA printer dashboard is a scaffold — next: filter strictly to `provider:local-sa`, add a CSV/email relay to
  the shop, and a real "shipped" customer email template.

## 💬 Comments
-
