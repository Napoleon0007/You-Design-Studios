# TRUEF Studios — Handoff

## Current state (HEAD: 5caef47, LIVE on Railway)

**Landing = 3D hero carousel** (`/` → `static/v2/index.html`). The "v3" video-only landing was scrapped; v3 files remain at `/v3` if anything needs salvaging.

**What shipped 2026-06-24 (all deployed, GitHub → Railway auto-deploy):**
1. **3D hero carousel restored** — fixed 8-slot PLAYLIST, design-lag fix (images preloaded + double-rAF), touch-glitch retained
2. **AI video hero background** — `static/media/hero_bg.mp4` (from `~/Desktop/Hero Backround 1.mov`), `object-fit:contain`, loops on `#000` stage bg
3. **Anton graffiti font** — hero headline + blurb, `clamp(54px→110px)` desktop / `clamp(48px→72px)` mobile, always white
4. **Gallery background video** — `static/media/gallery_bg.mp4` (from `~/Desktop/Hero backround 2.MP4`) behind Collections section, 52% dark overlay
5. **Playlist reordered** (Luke's sequence): 0=black hoodie+Ghost → 1=white hoodie+Mummy → 2=terracotta tee+Neon → 3=dusty-blue tee+Skull → 4=amber tee+Dark Surreal → 5=forest zip hoodie+Green Tides → 6=sage tee+Shamaan → 7=plum zip hoodie+Paint Splash

---

## Open items (next session)

1. **Phone check** — hero video bg load speed, Anton font feel, carousel swipe, gallery bg performance
2. **Hero video swap** — currently `hero_bg.mp4`. If Luke wants a different clip, update `src` + `poster` in `static/v2/index.html`. Gallery bg similarly in the same file.
3. **Art/designs** — Luke doesn't love the current design library. Options:
   - Source new designs (Pixabay CC0, public domain art)
   - Remove weaker ones from `data/designs/`
   - Cards regenerate via `python3 tools/comp_cards.py`
4. **Auto-release on payment** — still pending.
   In `_settle_payment()` (app.py), after setting status to `paid`, call `_release_to_providers(order)` immediately instead of waiting for manual admin release. Rights checkbox at upload is the legal cover.
5. **Set `PRINTER_EMAIL`** on Railway once SA DTG printer is found → printer gets job notification emails automatically
6. **Garment population** — Luke visiting a Cape Town DTG printer. Blank photos → Meshy → white GLBs → `static/models/` → add to catalogue.
7. **Pricing** — don't touch until real printer quotes land.

---

## Stack notes

- Dev server: `PORT=7460 python3 app.py`
- Deploy: `git push origin main` (Railway auto-deploys on push)
- Printer dashboard: `/printer?key=PRINTER_KEY` (set `PRINTER_KEY` env on Railway)
- DB + uploads survive redeploys (Railway Volume mounted at `/data`)
- All provider files kept (gelato/gooten/printful) — dormant, not deleted
