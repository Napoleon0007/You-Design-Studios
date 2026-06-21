# Product expansion — status & scope

## ✅ Done — Women's range activated
- Every base carries a `gender` field; surfaced it through `catalog._compat_product` **and**
  `catalog.studio_products` (both were dropping it).
- Studio now has a **range filter** (`#genderFilter`, segmented **All / Men / Women**) above the
  product tabs. `data-gender` on each tab; the filter shows/hides and auto-selects the first visible
  product. Men = `unisex` (the standard cut), Women = `women` (`womens-tee`, `womens-crop`).
- Files: `templates/studio.html` (filter markup + `data-gender`), `static/js/studio.js` (filter logic),
  `static/css/studio.css` (`.gender-filter`), `catalog.py` (gender passthrough).

## 🟡 Scoped — not built (needs care / assets)

### Kids range
Don't fabricate — needs real fulfilment data + a model:
1. **Base** in `data/gelato_apparel.json` — a Gelato YOUTH/KIDS tee. Pull + verify the real UID via
   `build_apparel_catalog.py` (never hand-type a UID — wrong-product risk). Add kids sizes
   (3-4 / 5-6 / 7-8 / 9-11 / 12-13), real colour hex/codes, price = cost×2, and `"gender": "kids"`.
2. **3D model** — generate a kids-tee GLB in Meshy (image-to-3D), Draco-compress, drop in
   `static/models/`, wire in `window.MODELS` (studio.html) — until then it shows the clean 2D "coming soon".
3. **Filter** — add a `Kids` button to `#genderFilter` (`data-g="kids"`) once the base exists.
4. **Designs** — kids art goes in `data/designs/kids/` (folder ready). The parked **penguin**
   (`data/designs_parked/penguin.png`) is earmarked for kids.
5. Verify the **kids print area** (smaller than adult) so the print file matches.

### More garment types (long-sleeve, oversized, etc.)
Same discipline — **real Gelato UIDs only**:
1. Pull the type from the live Gelato catalogue via `build_apparel_catalog.py`, verify it resolves,
   add to `data/gelato_apparel.json` with real colours/sizes/price.
2. Reuse an existing 3D model where the shape fits (long-sleeve/oversized tee → `meshy_tee`); map in
   `window.MODELS`.
3. **Vet SA landed cost** before listing (the curation gate: drop anything that ships expensive to SA).
4. Assets/notes staging folder: `data/designs/more-types/`.

> Why scoped, not auto-built: real money + a real Gelato account ride on these. Fabricating a UID or
> listing an item with bad SA economics is exactly the failure mode to avoid — so these get a proper
> Gelato pull + verification pass, not a quick edit.
