# TRUEF Studios — Handoff

## Current state (HEAD: a5bc649, LIVE on Railway)

**Landing = 3D hero carousel** (`/` → `static/v2/index.html`).

**What shipped 2026-06-24 (this session, all deployed):**

1. **Mobile hero layout** — garment is now a small `44vw × aspect-ratio:2/3` box pinned bottom-right. Hero copy stays left-aligned at the bottom-left. Stage `::before` scrim ensures text is legible over the video. Scroll fixed (canvas `pointer-events:none` on mobile — OrbitControls was eating touch events).
2. **Video autoplay enforcement** — `forcePlay()` JS helper retries on touchstart, visibilitychange, and IntersectionObserver scroll-in. Fixes iOS Low Power Mode blocking `autoplay`. Covers hero + gallery + collection band.
3. **Playlist order** — purple hoodie → white hoodie+Mummy → black hoodie+Ghost → then rest unchanged. Uses `meshy_hoodie.glb` (737KB) for the opener instead of the zip model (1.4MB) — 2× faster load.
4. **White tee poster hidden on mobile** — no more jarring white flash before the 3D loads.
5. **Hero text bigger** — Anton headline `clamp(40px, 11vw, 60px)` on mobile.
6. **Rolodex (Collections)** — shirt card images RESTORED. `object-fit:contain` so neon bg shows around the shirt. 8 cycling neon backgrounds (cyan/pink/violet/orange/mint/yellow/magenta/sky).
7. **Collection band** — rolodex now sits in its own `<div class="collection-band">` with a looping bg video (`gallery_bg.mp4` placeholder). To swap: change `<source src>` in index.html to `collection_bg.mp4` when video is ready.
8. **Studio default shirt** — changed to first DARK colour in palette (black) instead of first light colour. `studio.js:115` and `garment3d.js` default both updated.
9. **Gallery overlay** — reduced 52% → 30% on mobile so bg video shows more.

---

## Deploy method
```
railway up --detach --service You-Design-Studios
```
NOT GitHub auto-deploy — must run CLI manually.

---

## Open items (next session)

1. **Collection bg video** — provide a new video file, drop it as `static/media/collection_bg.mp4`, update `<source src>` in the `.collection-band` video element in `static/v2/index.html`.
2. **Art/designs** — current designs are OK but Luke wants better artwork. Options:
   - Source new Pixabay CC0 / public domain prints
   - Regenerate cards: `python3 tools/comp_cards.py`
3. **Ghost design on black hoodie** — `ghost.png` is assumed to be white art (it was the original opener on a black hoodie). Verify it's visible on the black hoodie. If not, need a white-inverted version.
4. **Auto-release on payment** — `_settle_payment()` in `app.py`: after setting status to `paid`, call `_release_to_providers(order)` immediately. Rights checkbox at upload is legal cover.
5. **Set `PRINTER_EMAIL`** on Railway once SA DTG printer found.
6. **Garment population** — blank photos → Meshy → white GLBs → `static/models/` → add to catalogue.
7. **Pricing** — don't touch until real printer quotes land.

---

## Stack notes
- Dev server: `PORT=7460 python3 app.py`
- Deploy: `railway up --detach --service You-Design-Studios` (Railway CLI, NOT git push)
- Printer dashboard: `/printer?key=PRINTER_KEY`
- DB + uploads survive redeploys (Railway Volume mounted at `/data`)
