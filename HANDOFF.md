# You Design Studios — Handoff (start here next chat)

Cinematic custom **print-on-demand store for South Africa**, apparel-only.
Flask + vanilla JS + Three.js/GSAP. `~/Desktop/Printing business/`.
Run: `PORT=7460 python3 app.py` → http://127.0.0.1:7460  (7450/7451 busy).

## ▶▶ LATEST SESSION (2026-06-19 late) — CHECKOUT MILESTONE DONE — START HERE
**✅ CHECKOUT + PAYSTACK + EMAIL + ESCROW + MAGIC-LINK + MOBILE CART — BUILT & PROVEN.**
Backend e2e (12 checks) + headless UI proof @390px (0 console errors, no overflow) both PASS.
Run: `PORT=7460 python3 app.py`. Tests: `python3 /tmp/yds_e2e.py` + `python3 /tmp/yds_ui.py`.

**New files:** `mailer.py` (provider-agnostic email: dev-preview to `data/outbox/*.html` via `/outbox/<f>`,
or Resend when `RESEND_API_KEY` set; templates = confirmation / design-redo-magic-link / refund / released),
`shipping.py` (PLUGGABLE SA shipping — `SHIPPING_STRATEGY`=flat_free_over[default]/flat/passthrough/free;
default = R80 flat, FREE over R800; real per-garment courier table wired for `passthrough`),
`templates/checkout_result.html` · `templates/admin_orders.html` · `templates/resume.html`.

**Flow (all working):** studio cart (localStorage) → `/api/shipping-quote` (live total, no order yet) →
`/api/checkout` (Paystack init → `authorization_url`; or DEV "simulate pay" link when no key) →
`/checkout/callback` + `/api/webhooks/paystack` (HMAC-SHA512, idempotent) → `_settle_payment`:
approved designs → `paid`, any design in review → `in_review` (ESCROW HELD) + confirmation email.
Admin `/admin/orders`: **Approve&release** (blocked until designs moderation-approved) / **Reject→redo**
(emails the magic `/resume/<token>` link) / **Refund** (paystack.refund, last resort). `/resume/<token>` =
mobile mini-studio: upload OR browse designs → swap art → order re-held `in_review`. db: `list_orders`,
`update_order_item`, enriched `get_order` (email + per-item design fields). save-design now returns `unit_price_cents`.

**STILL DEV/SIMULATED until Luke provides keys (none of it blocks more building):**
- 🔑 NEED: Paystack TEST keys (`sk_test`/`pk_test`) + `RESEND_API_KEY` → then re-run e2e with real test cards.
- 💰 SHIPPING MODEL IS LUKE'S CALL: default flat R80 / free-over-R800 is a placeholder — flip `SHIPPING_STRATEGY`
  (+ `SHIPPING_FLAT_CENTS`/`SHIPPING_FREE_OVER_CENTS`) once decided. Real per-garment table in `shipping.py`.
- ⚠️ `ADMIN_KEY` is UNSET = admin pages open on localhost — **MUST set before deploy** (all new keys in `.env.example`).
- ⚠️ PERF (pre-existing, now gates "Add to cart"): `save-design` renders the 300-DPI print file with Pillow and
  takes ~15s on a big library image → add-to-cart spins ~15s. Worth speeding up (downsample source / render async).
- ⏳ Gelato ORDER submission not built (gelato.py = catalog/pricing only) → `_release_to_providers` queues + marks
  `submitted` (Gooten has real `submit_order`). Wire the chosen provider's real submit next.

**↳ STUDIO 3D + LANDING HERO fixes (same session, verified @390px, 0 console errors):**
- **3D recolour/spin fixed.** Root cause: `garment3d.js` rendered on-demand, so after any touch
  (which permanently killed the spin) inertial frames + the recolour weren't drawn → looked frozen
  ("palette changes background but not the shirt"). Now the loop **renders every visible frame** (smooth
  spin/drag/damping + instant recolour; verified shirt brightness 88→244 dark→white), **auto-spin RESUMES
  ~2s after you stop dragging** (`pauseSpin`/`scheduleResume`), and rendering **pauses off-screen / tab-hidden**
  (IntersectionObserver — mobile battery). `autoRotateSpeed` 1.5→1.0.
- **Landing hero reframed** (`hero.js`): brought FORWARD (`LAND_ZOOM` 1.3→1.5, new `PORTRAIT_ZOOM` 1.12),
  **cut at the eyes** (`FOCUS_Y` 0.22→0.18), and **starts turned to the side** (`START_FRAME` 20; progress
  maps 20→120). **Cinematic grade** added (`hero.js` unchanged for this): deeper canvas filter
  (contrast 1.2 / sat 1.22 / brightness .9 / sepia .06), richer teal-orange split-tone, slim anamorphic
  letterbox bars + warm key-light bloom (`.hero-grade` in index.html + style.css).

**↳ FOLLOW-UPS (same session, Luke's calls — all verified):**
- **NO front-end approval wait.** Moderation reworked: an upload is ACCEPTED immediately (no "pending
  review", no checkbox to hunt for). Instead a one-time **originality pop-up** (`#ipModal` — "your own
  original work, no logos/brands") shows when art lands; acknowledging IS the rights confirmation → they
  pay → order **escrows for backend review** (you Approve&release / Reject→redo / Refund in `/admin/orders`).
  A risky FILENAME is no longer blocked — it's just **flagged** for your review (`⚠` chip on the order).
  `moderation.check` uploads → `approved` (+`flag`); library picks auto-confirm rights (our art, no pop-up).
- **Mobile colour dock.** On phones the colour palette is docked onto the bottom of the garment stage
  (`#stageDock`) so you SEE the colour change while picking — the `#swatches` node is *relocated* there
  (single source of truth, desktop unchanged). Stage → 50svh on mobile; controls lifted above the dock.
- Proofs: `/tmp/yds_e2e.py` (new policy) + `/tmp/yds_ui.py` (pop-up→cart→checkout) + `/tmp/yds_dock.py`
  (dock co-visible, desktop intact) — all PASS, 0 console errors @390px.

## ▶▶ PRIOR SESSION (2026-06-19 pm)
**PROVIDER DECISION REVERTED:** apparel = **GELATO for now** (Gooten/Printful "for other things later"). Studio catalog was always Gelato → nothing to redo.

**1. 3D MODELS WIRED (Meshy GLBs), Playwright + network-verified, MOBILE-FIRST:**
- `static/models/`: `meshy_tee.glb` (classic crew), `meshy_tee_premium.glb` (Bella women's cut), `meshy_hoodie.glb` (pullover). Zip-up render HELD (Gelato has no zip hoodie).
- Map (verified each product fetches the right .glb): classic-tee→meshy_tee · premium-tee→meshy_tee_premium · heavy-hoodie & premium-hoodie→meshy_hoodie · **crew-sweatshirt→2D "coming soon"** (no model yet).
- `garment3d.js` G.load NORMALISES Meshy materials (they ship metalness=1+4K map+white emissive → recolour failed; now matte/metalness0/kill emissive → flat recolour via CanvasTexture reads true, folds survive from geo+normalMap).
- `studio.js`: per-product 3D-vs-2D (`modelFor` has NO _default → unmodelled = clean 2D, NEVER the hero mockups). Olive "YOUR DESIGN HERE" guy removed from products. **White/pale garment → grey stage backdrop** (`.garment-light`), white bg for dark colours. Fixed latent bug (post-load recolour used colour NAME not hex).
- **CREW SWEATSHIRT = Gildan 18000** (NOT 18500=hoodie). A white Gildan-18000 photo (model-worn — flat blank unavailable via APIs) is in `~/Desktop/Garment photos for Meshy/Tees/`. Luke renders it in Meshy → drop GLB → wire crew-sweatshirt→3D = all 5 products live 3D.
- ⏳ STILL TODO on models: per-model print-AREA calibration (decal AREA still calibrated to OLD tee.glb bbox → prints may sit off on Meshy models); colour fidelity slightly lifted (tune exposure/env); COMPRESS GLBs (13–37MB, too heavy for mobile — strip 4K baseColor map since we recolour anyway + Draco → 1–3MB); a tee showed a faint pattern (likely a 2nd mesh/material keeping its baked texture — engine recolours only first mesh).

**2. DESIGN LIBRARY = Luke's `~/Desktop/Clothing art/`** → 28 imported into `data/designs/` (sanitised names, dropped 2 garment-mockup templates + old placeholders). ⚠️ SWAP the IP ones (Django/Godfather/Tarantino/Blade Runner/MJ/Dalí/Black Swan) for free Pixabay/Pexels art (Luke curating); abstract/animal ones fine.

**3. ✅ CONTENT-MODERATION / IP GATE BUILT + end-to-end verified** (`moderation.py`, db cols, order gate, `/admin/moderation` queue, rights checkbox). See `[[project_yds_content_moderation]]` memory. Free framework (filename blocklist + manual review + curated auto-approve); cloud detector (Google Vision/AWS) drops into `moderation.set_detector` later. ADMIN_KEY env guards the queue (open on localhost — SET before deploy).

**4. 🔨 CHECKOUT + PAYSTACK + EMAIL + MAGIC-LINK milestone — IN PROGRESS (increment 1 done):**
- DONE: order states `in_review/awaiting_redo/refunded`; `orders.resume_token` + `db.get_order_by_resume_token`; **`paystack.py`** client (initialize/verify/refund/verify_webhook HMAC-SHA512; test-mode-ready; amounts in ZAR cents = db cents; works with NO key set). Verified (no network needed).
- ESCROW FLOW (decided): Paystack charges immediately (no card-hold) → "escrow" = order state `in_review` (paid, not sent to Gelato). Approve→submit Gelato. Reject→magic-link email to RE-UPLOAD (money held = sale saved) or REFUND (last resort, you eat the ~2.9%+R1 fee). Refund-last.
- NEXT (this is where the new chat continues): `mailer.py` (provider-agnostic, dev-preview + Resend adapter; templates: confirmation / design-redo-with-magic-link / refund) → `/api/checkout` (paystack init) + `/api/webhooks/paystack` (verify sig → mark paid → in_review if held) → escrow transitions + admin approve→release-to-Gelato / reject→redo-email / refund → `/resume/<token>` magic page (loads order into studio to swap art) → **CHECKOUT UI (MOBILE-FIRST)** → lock SA SHIPPING model (money-critical, undecided).
- DECISIONS LOCKED: guest checkout + magic-link (no passwords) to "remember them"; email provider-agnostic w/ dev preview; Paystack real-integration test-ready.
- **NEED FROM LUKE:** Paystack TEST keys (sk_test/pk_test — free, no bank/KYC) + a Resend key → to verify end-to-end with test cards. Bank/business account only needed to go LIVE (he has personal; opening a business one). Decide SA shipping charging model.

**MOBILE-FIRST IS PARAMOUNT** (Luke: 90% phone) — studio + checkout + resume page all phone-first @360/390/414, sleek, ≥44px targets. NEW FILES this session: `moderation.py`, `paystack.py`, `templates/admin_moderation.html`. Still LOCAL only; live Railway = old build.

---


- **Live (Railway):** https://you-design-studios-production.up.railway.app
  ✅ **DEPLOYED 2026-06-19 — live = the CURRENT build** (checkout/escrow/email, mobile cart, originality
  pop-up, colour dock, 3D recolour/spin fix, reframed+graded hero). Deploy = `railway up --detach
  --service You-Design-Studios`. Railway vars now set: `ADMIN_KEY=mR8Jbsmz2e8U4YJoeXzre_LLDTLpxjPx`
  (admin pages 401 without `?key=`), `PUBLIC_BASE_URL`=the Railway URL. `data/gelato_apparel.json` was
  un-ignored in `.gitignore` (catalog MUST ship or the store loads empty). Payment/email still DEV-mode
  (no Paystack/Resend keys on Railway yet) → the dev "simulate pay" link works on the public URL, so
  don't share widely until real keys are set. DB/uploads are on ephemeral container disk (mount a Volume
  before real orders).
  **POST-DEPLOY FIXES (all live):** (A) **uploads never block on resolution** anymore — `_grade_and_store`
  only warns, never `fail` (Luke: people print whatever they like). (B) **3D load 24s→~2.6s** — removed the
  `PMREMGenerator`/`RoomEnvironment` env map from `garment3d.js` (it blocked init ~12.7s); + preconnects,
  GLB `<link rel=preload>`, long Cache-Control on `/static/models|media`. (C) **HERO = scroll-scrub of
  clip #4** (tattoo guy, hoodie→shirt): extracted to a 100-frame seq `static/media/hero4/`, driven by the
  existing `hero.js` frame engine (`window.HERO={frames:100,base:'/static/media/hero4/',startFrame:0}`) —
  scroll down morphs hoodie→shirt, up reverses (frames, not raw-video seek, for smooth iOS). Source MP4s
  encoded to `static/media/hero_v{1,2,4,5}.mp4` for easy swaps. (D) **two hoodies share one model** — need
  the **Premium Hoodie Gildan SF500** photo (not in `~/Desktop/Garment photos for Meshy/`) to make a 2nd
  Meshy model. NOTE: a concurrent chat rebranded BRAND→"InkHause Studios" + gold/orange theme.
- **GitHub:** Napoleon0007/You-Design-Studios · deploy = `railway up --detach --service You-Design-Studios`

---

## ✅ DONE TODAY (2026-06-19) — all verified locally, 0 errors

### 1. Apparel-ONLY verified catalog (real Gelato data, no hand-typed UIDs)
Luke locked scope to **apparel only** (no wall art / drinkware / accessories).
- `build_apparel_catalog.py` pulls LIVE Gelato → `data/gelato_apparel.json` (git-ignored). Rerun anytime.
- **5 bases** (real, resolve + ZAR-priced): Classic Tee (Gildan 64000), Premium Tee (Bella+Canvas 3001),
  Crew Sweatshirt (Gildan 18000), Heavy Hoodie (Gildan 18500), Premium Hoodie (Gildan SF500).
- Per-size ZA cost → **retail = cost ×2.0**, charm-rounded (2XL+ surcharge falls out). ~12 curated
  streetwear colours/garment with REAL hex + fabric/GSM (from Gelato product detail).
- `catalog.py` rewritten to read the JSON (`MODE=live`): `build_uid()`, `unit_price_cents()`,
  `verify_item()` (structural guard), `provider_of()`. The mock's UIDs were INVALID — real eliminated that.

### 2. Multi-provider routing — the anti-mix-up keystone (Luke's #1 concern)
- `providers.py` — `verify(provider, uid, cat)` does 3 checks: provider known → **UID grammar matches
  provider** (Gelato=`apparel_product_gca_…`, Printful=`^\d+$`, Gooten SKU=free-form/live-checked) →
  **live resolve + category match**. A line can ONLY reach the factory that makes it. Proven: cross-provider
  + wrong-category all rejected. `group_by_provider()` splits a mixed cart into one order per provider.
- `db.py` migrated: `provider` column on `designs` + `order_items` (stamped through). `app.py` order guard
  + save_design use it. E2E order test passed (per-size price correct, `fulfilment_by_provider` in response).

### 3. Providers wired
- **Gelato** = everyday range, fully built (API in `gelato.py`, key in `.env`). ⚠️ but see SA shipping below.
- **Printful** = EXCLUSIVE lane only (1–4 premium items, hand-set prices). `printful.py`, key in `.env`. Intact, not erased.
- **Gooten = provider #3, the one we can drive from our own site.** `gooten.py` built to their real API:
  - Base `https://api.print.io/api/v/5/source/api`. `recipeId` in URL (public), `PartnerBillingKey` (private/orders).
    **Both keys SAVED in `.env`.** Gooten collects NOTHING from buyers → pairs with Paystack (we own the cart).
  - `list_products()` = static catalog blob (gzip) — 270 products. Apparel ids: **T-Shirts=40, Hoodies(Pullover)=85,
    Sweatshirts=145, Zip Hoodies=244, All-Over-Print 280/281/282**. Wholesale USD (~$8.90 tee / ~$19.40 hoodie).
  - `supports_country` / `get_variants` / `shipping_estimate` / `price_estimate` / `submit_order`
    (with **duplicate-prevention**: SourceId=our ref + IsPartnerSourceIdUnique; + `IsInTestMode`) / `verify_sku`.
  - **Webhook receiver** `/api/webhooks/gooten` BUILT + PROVEN: drove New→In Production→Shipped→Delivered into
    our order state machine; `db.get_order_by_provider_id()` added. Map in `providers.map_gooten_status()`.

---

## 🔭 SA VIABILITY — the core economics finding
- **✅ RE-CONFIRMED LIVE 2026-06-19 → DECISION: APPAREL = GOOTEN.** Pulled Gelato's own quote API
  (`POST /v4/orders:quote`, needs `orderReferenceId`) to Cape Town, ZAR: **Classic Tee fulfils from the US**
  — normal R202.42 (14–25d, DDU) / express R2840.89; **Heavy Hoodie fulfils from GERMANY — NO standard tier,
  express ONLY** R1400.17 DHL (7–11d, DDU) / R1501 UPS. So the famous "R1400" = the **hoodie, made in DE,
  express-only** (not a tee, not standard). **Gelato has NO South African production for these Gildan blanks**
  (ship US/DE, DDU = customer pays duties at the door). Landed cost: tee Gelato ~R398 (14–25d) ≈ Gooten ~R434
  (7d); **hoodie Gelato ~R1823 vs Gooten ~R578 (3.2× cheaper).** Luke delegated the call → **apparel = Gooten**
  (cheaper hoodies, 7d, ZAR, no duty surprise); Gelato kept for international / any genuinely SA-made item only.
- **CURATION GATE (Luke's rule):** the **starting range** = only items that ship to SA **affordably** — drop R1400-style
  express-only items; keep cheap-to-ship cool items + good-quality affordable hoodies. Vet each item's SA landed cost first.
  **NUANCE:** not a permanent ban — an *exceptional-quality* item (e.g. a thick premium hoodie) can justify a high price
  LATER as a **premium lane** (pairs with the Printful exclusive lane). Launch affordable; add premium drops once established.
- **Still to verify:** Gooten ship-from country + DDP-vs-DDU duty status; whether any Gelato product is truly SA-made (matters for accessories).
- **No SA-LOCAL printer has a public API** (TeePrint/In.It/OneOff/OTC = Shopify-app or manual). Luke needs an
  API to auto-fulfil from his custom site, so local is parked until one appears (routing ready as `provider:local-sa`).
- **Gooten DOES serve ZA — confirmed:** supported-countries returns `{Code:ZA, IsSupported:true,
  DefaultCurrency:ZAR, Format:"R{1}"}` (247 countries total). `productvariants?countryCode=ZA` → 200,
  `shippriceestimate` ZA → 200, **EstShipDays=7**. So Gooten = real API **and** native SA/ZAR support —
  the best fit found. (Their API was flaky/slow during testing — intermittent timeouts; just retry.)
  STILL UNKNOWN: exact ZA shipping cost in rand (price_estimate kept timing out) — first task tomorrow.

## ▶ DESIGN STUDIO — CURRENT FOCUS (built 2026-06-19, LOCAL only, Playwright-verified, 0 console errs)
Real-time 3D garment studio: `static/js/garment3d.js` (Three.js r128 via CDN) wired into studio.html/js/css.
- **Recolour** whole garment · **Print** = `THREE.DecalGeometry` on chest/back (folds with the fabric; front/back isolated —
  this tee's UVs are SHARED front↔back so a decal is used, NOT UV-paint) · **Drag** to move + wheel = scale ·
  **Free-transform** panel: Width / Height(stretch) / Rotate (printfile.py honours optional `scale_y`) · **Front/Back** toggle ·
  gentle auto-spin · **WebGL→2D-photo fallback** · mobile clean 360/390/414 · **Save→print-file lockstep** proven.
- **Design-library picker DONE:** drop images into `data/designs/` → they appear under "browse our designs" → picking one runs the
  same DPI grading (`POST /api/use-design`) and drops onto the garment. Routes: `/api/designs`, `/designs/<fn>`, `/api/use-design`.
  (2 sample designs seeded: stay_wild.png, sun_burst.png — replace with real templates.)
- Current model = generic `static/models/tee.glb` (Starklord17/threejs-t-shirt repo).

**⏳ WAITING ON LUKE:** generating REAL garment 3D models in **Meshy** (free, 100 credits) from `~/Desktop/Garment photos for Meshy/`
(5 tees + 2 hoodies — real Gooten blanks) → drops GLBs into `static/models/`. One garment per image-to-3D run.

**NEXT CHAT:** (1) when GLBs land → map each garment to its GLB + wire (recolour-by-real-hex, per-model print-area calibration like the
tee's `AREA` in garment3d.js, spin) + show the real product photo in the picker; (2) **garment-TYPE dropdown + Gelato catalog** via
`attributeFilters` (the quick products:search pagination only hit 'none/kids' PLACEHOLDER products — use filtered queries); (3) colour-
fidelity polish (ACESFilmic exposure 0.95); (4) Phase C **all-over-print** (Printful-style, tile across full garment + auto-arrange).
**KEY FACT:** Gelato API returns NO product images (data only) → garment visuals = 3D models; real photos = Gooten/manufacturer per blank.
**PROVIDER:** apparel = **Gooten** (Gelato ships a hoodie to SA for ~R1400 express-only; Gooten R286, 7 days, ZAR).

## 🎯 TOMORROW — pick up here (provider/catalog workstream)
1. ✅ **DONE 2026-06-19 — Gooten ZA shipping CONFIRMED viable.** Priced real ZA SKUs to Cape Town (8001):
   - 1× tee (NL 3900): wholesale **R177.33** + ship **R257.27**; Gooten suggested retail R202.64. EstShipDays **7**, no expedited.
   - 1× hoodie (Gildan 18500 — same base as our Gelato hoodie): wholesale **R291.74** + ship **R285.88**.
   - **Shipping is PER-GARMENT-TYPE & front-loaded:** 1st unit full (~R257 tee / R286 hoodie), each *additional same*
     garment ~R72 (2× tee ship = R328.78). **Mixed types DON'T combine** — tee+hoodie ship = R543.15 (= 257+286, two shipments).
   - vs Gelato's ~R1400 → **~5× cheaper, ZAR-native = the SA fulfilment answer.** CATCH: single-item orders are
     shipping-heavy (ship > garment); margin lives in multi-buy. Pricing/shipping strategy = open decision (see below).
2. **Build the Gooten catalog** — `build_gooten_catalog.py`: pull apparel variants (40/85/145) for ZA → SKUs +
   options (Color RgbaColor→hex, Size, Print Placement/SpaceId) + PartnerPrice→retail, tag `provider:gooten`,
   store the template SpaceId per SKU. Merge into `catalog.py` (it should read gelato + gooten + printful files).
3. **Print files → Gooten** — render to each SKU's template spec, host via `storage.py` + set `PUBLIC_BASE_URL`,
   pass as `Images[{Url, SpaceId}]` at order time.
4. **Checkout + Paystack** (provider-agnostic) → on payment success, submit per-provider (Gooten in TEST mode first).
   ⚠️ **OPEN DECISION (gates pricing):** how to show the R257/R286 per-garment shipping to customers —
   (a) free shipping baked into item price, (b) item ×2 + live shipping at checkout, or (c) free over a threshold (e.g. R800) else flat fee.
5. **Pick the 1–4 Printful exclusive items** (Luke) → add tagged `provider:printful`, hand-set premium prices.
6. **Configure Gooten webhook URL** in Gooten Admin → Settings → API tab (once deployed; needs public URL).
7. Still open: real garment/model **photos** (placeholders now); **deploy** decision (live = old build).

## Keys / conventions
- `.env` (git-ignored) now holds: `GELATO_API_KEY`, `PRINTFUL_API_KEY`, `GOOTEN_RECIPE_ID`,
  `GOOTEN_PARTNER_BILLING_KEY`. All shared in plaintext chat → rotate when convenient.
- Gooten Admin: https://www.gooten.com/admin (RecipeID + PartnerBillingKey under Settings → API; payment method under Billing).
- gh NOT on PATH → push via keychain PAT. Verify with Playwright (prove-before-showing). MOBILE-FIRST (360/390/414).
- A local dev server may still be running on :7460 — `lsof -tiTCP:7460 | xargs kill -9` to free it.

## File map
`app.py` (routes + order guard + Gooten webhook) · `catalog.py` (verified catalog reader) ·
`build_apparel_catalog.py` (Gelato pull) · `gelato.py` / `printful.py` / `gooten.py` (provider clients) ·
`providers.py` (router/anti-mix-up) · `printfile.py` · `storage.py` · `db.py` (SQLite + provider cols) ·
`data/gelato_apparel.json` (verified catalog) · `templates/` `static/`.
