# You Design Studios — Custom Print-on-Demand (South Africa)

Cinematic print-on-demand storefront. Flask + vanilla JS + Three.js/GSAP.
Allbirds-calm layout, dark streetwear skin. Design studio with live preview,
Gelato fulfilment + Paystack + email as swap-in integration points.

**Live:** https://you-design-studios-production.up.railway.app
**Repo:** https://github.com/Napoleon0007/You-Design-Studios

> Brand name lives in `BRAND` in `app.py` — change it in one place.

## Run locally
```bash
cd "~/Desktop/Printing business"
pip install -r requirements.txt
PORT=7460 python3 app.py        # http://127.0.0.1:7460
```
(7450/7451 are used by other tools on this machine — 7460 is clear.)

## What's built (Phase 1 — DONE, Playwright-verified)
- **Cinematic hero** — the turning-man video (V1) is exploded to a 121-frame
  sequence and scrubbed by scroll on a `<canvas>` (Apple-style). He rotates
  front → back as you scroll and stays pinned with you. `static/js/hero.js`.
- **Landing** — marquee, how-it-works, 360° showcase, template gallery (V2/V3/V4),
  value strip, CTA band, footer. `templates/index.html`, `static/css/style.css`.
- **Studio shell** (`/studio`) — product/colour/size/qty, front/back toggle,
  drag-drop upload with **live print-quality validation** (REAL, Pillow-backed
  `/api/validate-image`: DPI at print size → pass/warn/fail, gates add-to-cart),
  2.5D art overlay preview. `templates/studio.html`, `static/js/studio.js`.
- Verified: 0 console/page errors; no horizontal overflow @ 360/390/414px;
  validation pass+fail paths correct.

## Next (Phase 2 — the real-time 3D garment)
The studio stage (`#garment3d`) is wired and waiting for a Three.js scene:
load a t-shirt + hoodie GLB, apply a `CanvasTexture` (base colour + uploaded
art positioned in the print area) to the front/back UV regions, OrbitControls
for free 360° spin. Replaces the `.stage__placeholder` video stand-in.

Then: cart + accounts + saved designs → Gelato order API + Paystack init +
transactional email (services/ layer) → admin dashboard → Gelato tracking proxy.

## Source assets
Raw AI mockup MP4s live in this folder (git-ignored). Processed web copies are
in `static/media/` (hero_seq/ frames + spin_swae / look_astro / look_throne).

## Backend — print pipeline + DB (BUILT)
The keystone of POD fulfilment is done and tested:
- **`printfile.py`** — renders a **print-ready PNG at the exact Gelato print size**
  (3543×4724px @ 300 DPI for 30×40cm), transparent bg, art composited from a
  normalised placement (scale/cx/cy/rotation), front & back.
- **`storage.py`** — file store abstraction (local `data/files/`, served at
  `/files/<key>`); swap `put()` to Cloudflare R2 / S3 for prod. Gelato fetches
  print files from these URLs (set `PUBLIC_BASE_URL` so they're absolute).
- **`db.py`** — SQLite (no ORM, Postgres-ready): `users`, `designs`,
  `saved_designs`, `orders`, `order_items` + an order state machine
  (`created→paid→submitted→in_production→shipped→delivered`, `rejected/failed`).
- **Endpoints:** `/api/validate-image` (now returns `art_key`),
  `/api/render-printfile`, `/api/save-design` (renders + persists),
  `/api/orders` (persists order + items), `/api/track/<ref>`, `/files/<key>`.

> Prod note: container disk is ephemeral on Railway — mount a Volume at
> `DATA_DIR` (or move storage to R2) and switch to Postgres before real orders.

## Next backend (needs keys, do last)
Paystack checkout → on success submit to **Gelato Order API** (print-file URLs +
variant UID + address) → store `gelato_order_id` → **webhooks** for status /
rejection → confirmation + rejection **emails** → tracking proxy.

## Deploy (Railway)
`Procfile` + `requirements.txt` are ready (gunicorn). Push to GitHub →
Railway, or `railway up`.
