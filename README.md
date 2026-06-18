# INKHAUS — Custom Print Studio (South Africa)

Cinematic print-on-demand storefront. Flask + vanilla JS + Three.js/GSAP.
Allbirds-calm layout, dark streetwear skin. Real-time 3D design studio,
Gelato fulfilment + Paystack + email as swap-in integration points.

> Brand name "INKHAUS" is a placeholder — change `BRAND` in `app.py`.

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

## DB (planned)
`products`, `variants(color,size,gelato_uid)`, `designs(art,placement)`,
`saved_designs`, `orders`, `order_items`, `templates`, `users`. SQLite → Postgres.

## Deploy (Railway)
`Procfile` + `requirements.txt` are ready (gunicorn). Push to GitHub →
Railway, or `railway up`.
