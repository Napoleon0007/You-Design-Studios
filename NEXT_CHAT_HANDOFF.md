# Handoff — TRUEF Studios (2026-06-22, late session)

---
## ✅ DONE 2026-06-22 (newest) — studio preview light-show + faster spin + room depth · landing opening fixed (LOCAL, undeployed)
- **Studio "Preview in 3D" upgrades** (`static/js/studio.js` `togglePreview`, `static/js/garment3d.js`, `templates/studio.html`,
  `static/css/studio.css`): (a) **spin a touch quicker** — `G.setAutoSpin(on, speed)` now takes a speed; studio preview uses
  `2.2` (landing stays `1.1`). (b) **Theatrical LIGHT-SHOW on entering preview** — `#stage` gets `.preview-show` for ~2s →
  the studio dips dark (`.sr-flash` + garment brightness down) then the key light + softbox POP on and the garment is
  revealed (keyframes `pvFlash`/`pvGarment`/`pvKey`/`pvBox`/`pvShaft`; pro, not strobey; reduced-motion-safe). (c) **More room
  depth** — added `.sr-floor3d` (faint perspective floor), `.sr-lum` (vertical luminance), `perspective` on `.studio-room`,
  deeper atmospheric vignette → feels like real space behind the garment.
- **Landing OPENING glitch FIXED** (Luke: "white shirt, glitch, then black shirt over it"): root cause = (1) opening 3D shot
  was a BLACK logo tee but the instant poster was a WHITE tee → jarring white→black; (2) my new `.intro` reveal was firing
  AFTER the first 3D frame → a re-reveal double-flash. Fix in `static/v2/landing3d.js`: opening is now a **WHITE tee
  (`#f4f3ef`) with a DARK framed-TF mark** (`brand_mark_dark.png`, generated via PIL since the existing `brand_mark.png` is
  WHITE/invisible-on-white), back cleared; `.intro` MOVED to boot start (plays on the poster as the page opens). Poster
  `hero-poster.png` **rebuilt** = white blank tee + the dark mark (RGBA — keep alpha! an RGB save made a black box behind the
  shirt, fixed). Old surreal poster backed up `static/v2/hero-poster-surreal.bak.png`. Verified headless: opening = white+logo,
  no black box, 0 console errors.
- ⏳ Luke to eyeball on phone: the preview light-show feel + faster spin; the studio room depth.

---
## ✅ DONE 2026-06-22 (prev batch) — studio photo-studio bg + landing "more 3D" + quick fixes (LOCAL, undeployed)
- **Quick fixes:** ADMIN_KEY ROTATED in Railway + scrubbed from HANDOFF.md (old value dead). `abstract-1`/`abstract-2`
  glitch designs SWAPPED for clean Pixabay abstracts (ink-wave + glassy 3D render) + cards regenerated.
- **Studio background = a real PHOTO STUDIO** (neutral/greyscale so artwork colours read true): `templates/studio.html`
  `.studio-room` layers + `static/css/studio.css` — seamless cyclorama, key light + softbox, soft light shaft +
  drifting dust, faint out-of-focus light-stand/C-stand gear, edge vignette. Replaced the flat gradient/grid. Verified 390+desktop.
- **Landing "more 3D" (all 5, additive — NO engine changes):** `static/v2/v2.css` + `landing3d.js` + `rolodex.js` +
  `index.html`. (1) garment **top key-light** (`.garment-key`) on top of the existing rim/reflection/shadow; (2) **multi-plane
  scroll parallax** — room(far)/garment(mid, recedes)/copy(near); (3) restrained fabric sheen via the key (deeper normal-map
  weave LEFT as an engine follow-up); (4) cinematic **"lights on" intro** (`.intro` one-shot); (5) **extruded nav wordmark**,
  **bevelled glass CTA**, **cursor-tilt Collection cards** (pointer:fine, with glare). Verified headless 390+desktop: 0 console errors.
- ⚠️ **Open (pre-existing, flagged):** on PHONE the hero copy overlaps the centred white garment (low contrast) — needs a
  scrim behind the copy or push it above/below the garment. Not caused by this batch.
- Everything LOCAL on :7460. Deploy the whole lot (studio rebuild + preview-lock + bg + landing-3D + fixes) together after
  Luke's phone sign-off.

---
## ✅ DONE 2026-06-22 (latest) — /studio REBUILT Lacoste-style (the #1 task below)
Single-screen editor shipped LOCAL (`:7460`, not yet deployed). 3 files:
- **`templates/studio.html`** — restructured: transparent **top bar** (← BACK · FRONT|BACK pill · 🛒cart + **FINISH**),
  **full-bleed stage**, **bottom tool-dock** (Garment · Colour · Size · Design · Move · Qty · Save), and one
  **bottom-sheet per tool** that the dock opens OVER the canvas. Every pipeline `#id` preserved verbatim
  (re-housed, not rewritten). Cart overlay + IP modal + scripts untouched.
- **`static/css/studio.css`** — rewritten single-screen skin: Lacoste tokens, **accent = TRUEF gold `#b78a2e`**
  (the ONE active-tool colour + underline; everything else greyscale), static **studio gradient + floor + contact
  shadow** (editor backdrop now NEUTRAL — colour-cycling stays on the landing). Old 2-col grid / mobile-stack / colour-dock / prodhead CSS removed.
- **`static/js/studio.js`** — added a small dock/sheet controller (open/close, single-active gold state, ✕ / scrim /
  Esc / re-tap / swipe-down close); **removed** the two obsolete mobile-relocation IIFEs + the backdrop colour-cycler.
  All pipeline logic (upload→IP-gate→cart→printfile, transform, design-mode lock) **unchanged**.

**Verified headless (Playwright, 360/390/414 + desktop):** zero page-scroll; top bar/dock pinned; garment canvas
above the dock; 7 dock tools each open their single sheet (gold active + scrim) and close every way; **REAL mouse
input** proven (no overlaps); 0 console errors; screenshots in `/tmp/studio_shots/`. **Pipeline:** engine loads + is
**locked still in design-mode**; swatch recolours the 3D shirt; size; design-library (17) → decal renders + verdict;
Move sheet shows sliders once art is placed; **FINISH (#addBtn) fires save-design**; **upload fires the IP-gate modal**
(proven on a fresh page); the use-design→save-design→shipping-quote round-trip returns ok:true (token, price R399, ship,
total) via in-page fetch. *(Note: headless software-WebGL starves Playwright input + the live `.then` while the 3D loop
runs — a TEST-ENV artifact; proven by stopping the loop and by direct/in-page fetch. Not a code issue.)*

**+ PREVIEW-LOCK FIX (Luke's follow-up):** in **Preview-in-3D** a drag now **orbits the garment** (camera moves) while the
placed print stays **locked on the fabric** — it no longer drags the artwork around. `garment3d.js`: new `_previewLock`
flag (`= !_designMode`, set in `setDesignMode`); pointerdown gets a preview branch that lets OrbitControls handle the drag
(no decal move, no `stopPropagation`); wheel zooms instead of resizing the print in preview; `designMode`/`previewLock`
added to `G.debug()`. **Verified headless 9/9:** Design drag MOVES the print (cx 0.500→0.178 — also proves drag-to-place
works); Preview drag does NOT move it (cx unchanged) + decal stays on the shirt; toggling back restores Design.

**STILL OPEN:** (1) confirm the **feel** of drag-to-place + preview-spin **on a real phone** (logic now proven headless);
(2) **deploy** (hold until Luke's phone sign-off, then `railway up` + git push); (3) the GLB compression + abstract-1/2 swap (unchanged from below).

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

---
## 🧵 STUDIO-CHAT ADDENDUM (2026-06-22, late) — for the next chat
> Ran ALONGSIDE the hero/landing agent above (it committed `bf94351` 3D-depth-pass + the room-lum/halo/haze/`--garment-reflect` work). My edits are STUDIO-focused but some live in shared files (`v2.css`, `landing3d.js`, `garment3d.js`) → don't blanket `git add -A`; coordinate. Full detail in Claude memory `project_inkhaus_print_business`.

**DEPLOYED earlier (commit `8cf062e`):** bg always contrasts the shirt (`pickBackdrop`) + every shirt carries a print (guarantee loop, knockout dropped).

**COMMITTED just now (`4f28841`):** gallery MP4s recompressed 4.7MB→2.6MB (−46%; h264 crf30, no audio, faststart). Originals backed up in `/tmp/media_orig/`. NOT deployed yet.

**MY UNCOMMITTED (verify on a real device, then deploy when the repo's calm):**
- **Studio "FLAT-DESIGN" mode** (Luke chose this from 3 options): `garment3d.js` `G.setDesignMode(on)` (face front, no spin/orbit/zoom, drag-anywhere moves the print via the `_designMode` pointerdown branch); `studio.js` `enterDesignMode()`/`togglePreview()` wired into model-load + every art-apply; `#previewBtn` "Preview in 3D ↻" + `.preview-toggle` CSS in `studio.html`. Verified: shirt locked + Preview spins + decalFront true, 0 errs — **but headless drag didn't move art (cx 0.5→0.5); CHECK ON A REAL PHONE** (likely a headless raycast artifact).
- Nav **logo bigger + thicker** (`v2.css .navword`/`.navmark`).
- **Swap-gap fix** so the landing is NEVER empty between shirts (`.swapping` no longer opacity:0, `wait 360→140`) — ⚠️ the hero agent also rewrote `.swapping`; reconcile.

**🎯 BIG NEXT TASK (Luke): redesign the STUDIO editor like the LACOSTE editor** (ref screenshots 9–10 in `2nd draft of printing website/`): single clean white screen, garment ALWAYS visible, controls DOCKED with the shirt (mobile: you currently scroll to the sliders and lose the shirt — everything must be in ONE non-scrolling area; bottom toolbar BACK/FINISH/undo-redo/tools). Use the **`taste` skill** on the Lacoste editor URL to extract tokens, rebuild mobile-first, PRESERVE pipeline IDs/JS (upload/IP-gate/cart/printfile).

**⚡ COMPRESSION still to do (next chat, verified):** the GLB models (`static/models/*.glb` ~10MB total, preloaded on the landing = the real hero-load cost) are already Draco'd; either mesh-simplify via `gltf-transform` (verify no garment deformation) and/or stop preloading all 4 on the landing (load on-demand). Left undone tonight to avoid breaking models blind.

---
## 🛍 HERO-CHAT note (2026-06-22, latest) — DEPLOYED `8f77a39`
Shipped (committed-only via a throwaway worktree so your uncommitted studio work was NOT included): **(1) The Collection rolodex now shows REAL 3D-rendered shirts** — all 17 `static/v2/cards/*.jpg` regenerated (engine-rendered blank tee + PIL fabric-shaded print; old flat `gen_cards.py` mockups replaced). Regen tools in `tools/` (gitignored). **(2) #5 cinematic depth** in `v2.css` (recede→step-forward on swap; spotlight/haze breathe). 
⚠️ **`landing3d.js` is shared + dirty:** it holds YOUR swap-gap (`wait 140`) AND my `--ground-shift` parallax line — I did NOT ship it (the #5 CSS falls back cleanly without it). When you reconcile, keep both. Also `garment3d.js` has my additive `preserveDrawingBuffer`/`antialias` init opts alongside your `setDesignMode` — both still uncommitted. **TODO for Luke:** `abstract-1` & `abstract-2` source designs are glitch images → swap them (they make bad cards). Full detail in memory `project_inkhaus_print_business`.

---
## 🏁 SESSION WRAP (2026-06-22) — for the NEW chat
Single session now (other chats closed). **Shipped + live:** `8cf062e` bg≠shirt + every-shirt-printed · `fe18a06` studio flat-design + bigger logo + never-empty swap · `4f28841` videos −46% · `a837b51` staggered model preload (no 10MB burst).

**Taste done:** `lacoste-taste/lacoste.md` + `lacoste.json` (gitignored). Editor DNA from Lacoste: full-bleed canvas, transparent top bar (BACK / undo-help-redo pill / FINISH), bottom monochrome tool-dock (active = accent), white→#e9e9ea studio gradient, font Figtree, single screen / zero scroll. Real editor screenshots = `2nd draft of printing website/14.50.33` + `14.50.49`.

**🎯 #1 NEXT TASK — rebuild `/studio` editor Lacoste-style** (see `lacoste.json` rebuildBrief): mobile-first single-scroll, full-bleed canvas + transparent top bar + bottom dock of the EXISTING controls, active=TRUEF accent, studio gradient, reuse `garment3d.js setDesignMode()` lock (already shipped). **Preserve all pipeline IDs/JS** (upload→IP-gate→cart→printfile).

**Open:**
- Studio flat-design drag-to-place needs a **real-phone check** (headless raycast inconclusive).
- **GLB compression unfinished** — `gltf-transform simplify` failed silently (CLI flag/dep); models intact, backups `/tmp/glb_orig/`. Models are 125k-vert pure geometry → simplify IS the lever; fix the CLI + verify renders.
- Swap `abstract-1`/`abstract-2` glitch source designs.
