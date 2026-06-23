# TRUEF Studios — Handoff

## Open items

### 1. Deploy (3 commits ahead of GitHub + Railway)
`c39ca77` → `2a2565e` → `c06e27f` — holding for phone sign-off.
Deploy: `railway up` + `git push origin main`

### 2. Phone sign-off needed
- Studio drag-to-place feel (headless raycast can't prove this — needs real touch)
- Studio Preview-in-3D spin + light-show entrance feel
- Hero mobile: copy overlaps the centred garment (needs a scrim or repositioning)

### 3. SA printer dashboard — next steps
- Filter `/printer` strictly to `provider:local-sa` orders only
- Add CSV/email relay to the physical shop
- Build a real "shipped" customer email template (currently just status update)

## What's live (Railway)
`https://you-design-studios-production.up.railway.app`
`/printer` is gated by `PRINTER_KEY` env var (Luke has it)

## Stack notes
- All provider files kept (gelato/gooten/printful) — back-burner for international
- Catalog data in `data/gelato_apparel.json` — keep as-is (internal IDs)
- GLB models already compressed (c06e27f) — originals backed up in `/tmp/glb_orig/`
