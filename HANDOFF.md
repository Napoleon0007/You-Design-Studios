# You Design Studios — Handoff (next chat starts here)

Cinematic custom print-on-demand store for South Africa. Flask + vanilla JS +
Three.js/GSAP. `~/Desktop/Printing business/`. Dev: `PORT=7460 python3 app.py`
→ http://127.0.0.1:7460  (7450/7451 are busy on this Mac).

- **Live (Railway):** https://you-design-studios-production.up.railway.app
- **GitHub:** https://github.com/Napoleon0007/You-Design-Studios  (push = backup; deploy = `railway up --detach --service You-Design-Studios`)

## ⚠️ Deploy state
The LIVE site = the **dark + cinematic** build. Newer changes are **local/committed but NOT deployed**
(Luke asked to preview on localhost, not push Railway):
- Hero **reframed** (wide screens push back to show his face; sharper). Tunables in `static/js/hero.js`
  `draw()`: `LAND_ZOOM` (1.3) + `FOCUS_Y` (0.22).
- **Gelato colours** added per garment (tee 14 / hoodie 12, White first) — `catalog.py`.
- **Split theme:** landing **dark**, studio **white** (`<body class="theme-light">` + `body.theme-light{}`
  block in `static/css/studio.css`). Landing untouched.
- Gelato API client + key (below).
→ When Luke says go: `git push` (already?) then `railway up --detach --service You-Design-Studios`.

## ✅ Gelato API — KEY IS IN AND WORKING
- Key stored in **`.env`** (git-ignored) as `GELATO_API_KEY`. Client = `gelato.py` (urllib, certifi for
  SSL, browser User-Agent to beat Cloudflare 1010). Reads `.env` automatically.
- `python3 sync_gelato.py`            → lists all **62 catalogs** (works ✓)
- `python3 sync_gelato.py t-shirts`   → products in a catalog
- `python3 sync_gelato.py product <uid>` → one product's variants/attributes
- `python3 sync_gelato.py dump`       → all product UIDs → `data/gelato_catalog.json`
- Relevant catalogs for us: **t-shirts, hoodies, sweatshirts, tank-tops, polos, kids-apparel,
  baby-clothing, mugs, bottles, posters, framed-posters, canvas, phone-cases, tote-bags, beanies,
  dad-hat, snapback, trucker-hat, bucket-hat, aprons.**
- NOTE: Luke shared the key in plaintext chat → suggest rotating it in the Gelato dashboard.

## 🎯 THE BIG NEXT TASK: curate ~50 products + a correctness-proof catalog
Luke's #1 concern: never let an order map to the wrong Gelato product (cup→shirt). Plan agreed:
1. Pull real catalog via `gelato.py` (UIDs are the **single source of truth** — never hand-type).
2. Curate ~50 best-sellers (Luke will pick FROM the live catalog — get him product lists per catalog).
3. Store each variant's **verified** UID + category/type + print-area; a `verified` flag gates ordering.
4. **Order-time guard:** re-validate every line's UID + type (and optional live price/stock) before
   submitting to Gelato — type-mismatch = hard reject. (Mix structurally impossible.)
- Mix he leaned toward: apparel-heavy + drinkware + wall art + accessories. He'll finalize against
  the real catalog.

## OPEN TODOS (Luke's words)
- **Get garment/model images** for the design overlay (he asked, NOT done). Options: his Image Scraper
  (`~/image_scraper/`, Pexels/Pixabay/Unsplash keys) for blank white tees/hoodies + models; Gelato
  product photos (need mockup endpoint); his own Grok-generated + videos. He wants **white shirts**,
  men + women, a **different person per variant (even per size)** → a per-variant asset library
  (image OR video) keyed by product×gender×size×colour, with a gender toggle + graceful fallback.
- **Realistic print-on-shirt** (his "build first" pick): drag/scale/rotate transform controls + fabric
  blend (folds show through) + displacement warp. NEEDS a clean blank garment image to look right
  (current studio placeholders already have a print on them — `static/media/ref_*.jpg`).
- Per-colour garment images so the studio photo changes with the colour (today it's static).

## BACKEND BUILT & TESTED (keystone, no extra keys)
- `printfile.py` — art + placement → print-ready PNG at exact Gelato size (3543×4724@300DPI,
  transparent, front/back). `storage.py` — file store (local `data/files/`, served `/files/<key>`;
  swap `put()` to R2/S3 for prod; `PUBLIC_BASE_URL` makes URLs absolute). `db.py` — SQLite (no ORM,
  Postgres-ready): users/designs/saved_designs/orders/order_items + order state machine.
- Endpoints: `/api/validate-image` (returns art_key), `/api/render-printfile`, `/api/save-design`
  (renders+persists), `/api/orders`, `/api/track/<ref>`, `/files/<key>`. Studio Save wired e2e.
- PROD caveat: Railway disk ephemeral → mount a Volume at `DATA_DIR` + move to Postgres + R2 before
  real orders.

## STILL TO BUILD (needs keys / later)
- Checkout + **Paystack** (SA payments) → on success submit **Gelato Order API** (print-file URLs +
  verified UID + address) → **webhooks** (status + rejection) → confirmation/rejection **email**
  (Resend/Postmark) → tracking. Test safely via Gelato **draft orders**.
- Deferred: true free-spin **3D garment** in `#garment3d` (GLB + texture-map + OrbitControls).

## CONVENTIONS
gh NOT on PATH → GitHub via keychain PAT (user Napoleon0007). Verify with Playwright before showing
(prove-before-showing). MOBILE-FIRST (verify 360/390/414). Brand name set in `BRAND` in `app.py`.
