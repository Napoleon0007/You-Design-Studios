/**
 * You Design Studios catalogue — OTC Printing products only.
 * Ported 1:1 from catalog.py. Pure functions, no I/O — catalog data is
 * bundled at build time from data/otc_catalog.json (same source file).
 */
import catalogData from "../data/otc_catalog.json";

export interface PrintAreaSide {
  w_cm: number;
  h_cm: number;
  w_px: number;
  h_px: number;
  dpi: number;
}
export interface PrintArea {
  front: PrintAreaSide;
  back: PrintAreaSide;
}
interface CatalogColor {
  gelato_code: string;
  name: string;
  hex: string;
}
interface CatalogSize {
  code: string;
  label: string;
  cost_zar?: number;
  retail_zar?: number;
}
interface CatalogBase {
  slug: string;
  name: string;
  otc_garment?: string;
  blank?: string;
  provider?: string;
  blurb: string;
  catalog?: string;
  fabric?: string;
  gsm?: number;
  gender?: string;
  price_from?: number;
  print_area?: PrintArea;
  sizes: CatalogSize[];
  colors: CatalogColor[];
}

const REF: Record<string, string> = {
  "t-shirts": "media/ref_tee.jpg",
  hoodies: "media/ref_hoodie.jpg",
  headwear: "media/ref_tee.jpg",
};

// Matches printfile.py (30x40cm @ 300 DPI) so render + catalogue never disagree.
const DEFAULT_PRINT_AREA: PrintArea = {
  front: { w_cm: 30, h_cm: 40, w_px: 3543, h_px: 4724, dpi: 300 },
  back: { w_cm: 30, h_cm: 40, w_px: 3543, h_px: 4724, dpi: 300 },
};

// Enlarge the printable area a touch so designs can be pushed a bit bigger on the
// shirt. MUST stay in sync with the 3D print-zone in garment3d.js (calibrateArea
// factors are this same PRINT_GROW) so the preview matches the printed result.
// Apparel only — caps/hats are hardware-limited (small fixed areas, skipped).
const PRINT_GROW = 1.15;

function growPrintArea(pa: PrintArea): PrintArea {
  const out = {} as PrintArea;
  for (const side of ["front", "back"] as const) {
    const a = pa[side];
    out[side] = {
      ...a,
      w_cm: Math.round(a.w_cm * PRINT_GROW * 10) / 10,
      h_cm: Math.round(a.h_cm * PRINT_GROW * 10) / 10,
      w_px: Math.round(a.w_px * PRINT_GROW),
      h_px: Math.round(a.h_px * PRINT_GROW),
    };
  }
  return out;
}

const BASES: CatalogBase[] = (catalogData as { bases: CatalogBase[] }).bases.map((b) => {
  if (b.print_area && b.print_area.front.w_cm >= 20) {
    return { ...b, print_area: growPrintArea(b.print_area) };
  }
  return b;
});

export const PRINT_AREA: PrintArea = BASES[0]?.print_area ?? DEFAULT_PRINT_AREA;

const BY_SLUG: Record<string, CatalogBase> = Object.fromEntries(BASES.map((b) => [b.slug, b]));

function refImage(base: CatalogBase): string {
  return REF[base.catalog ?? ""] ?? "media/ref_tee.jpg";
}

export function providerOf(slug: string): string {
  return BY_SLUG[slug]?.provider ?? "local-sa";
}

/** Mirrors app.py's `_product_name`: display name for a slug, falling back to
 * the slug itself (or "Item" if there's no slug at all). */
export function productName(slug: string | null | undefined): string {
  if (!slug) return "Item";
  return BY_SLUG[slug]?.name ?? slug;
}

export interface CompatProduct {
  slug: string;
  name: string;
  blurb: string;
  provider: string;
  gender: string;
  price?: number;
  ref_image: string;
  colors: { name: string; hex: string; gelato_code: string }[];
  sizes: { label: string; gelato_code: string }[];
}

function compatProduct(b: CatalogBase): CompatProduct {
  return {
    slug: b.slug,
    name: b.name,
    blurb: b.blurb,
    provider: b.provider ?? "local-sa",
    gender: b.gender ?? "unisex",
    price: b.price_from,
    ref_image: refImage(b),
    colors: b.colors.map((c) => ({ name: c.name, hex: c.hex, gelato_code: c.gelato_code })),
    sizes: b.sizes.map((s) => ({ label: s.label, gelato_code: s.code })),
  };
}

export const PRODUCTS: CompatProduct[] = BASES.map(compatProduct);

export function buildUid(
  slug: string,
  colorCode: string,
  sizeCode: string,
  sides: string = "front"
): string | null {
  if (!BY_SLUG[slug]) return null;
  return `otc_${slug}_${colorCode}_${sizeCode}_${sides}`;
}

export function sidesFor(hasFront: boolean, hasBack: boolean): string {
  if (hasFront && hasBack) return "both";
  return hasBack ? "back" : "front";
}

/** Front-end payload. `staticUrl` builds the same `/static/...` URL Flask's url_for did. */
export function studioProducts(staticUrl: (path: string) => string) {
  return BASES.map((b) => {
    const productPrintArea = b.print_area ?? PRINT_AREA;
    return {
      slug: b.slug,
      name: b.name,
      otc_garment: b.otc_garment ?? b.name,
      blank: b.blank,
      blurb: b.blurb,
      gender: b.gender ?? "unisex",
      fabric: b.fabric,
      gsm: b.gsm,
      price: b.price_from,
      price_from: b.price_from,
      ref_image: staticUrl(refImage(b)),
      print_area: productPrintArea,
      uid_template: buildUid(b.slug, "{color}", "{size}", "front"),
      colors: b.colors.map((c) => ({ name: c.name, hex: c.hex, gelato_code: c.gelato_code })),
      sizes: b.sizes.map((s) => ({ label: s.label, gelato_code: s.code, retail: s.retail_zar })),
    };
  });
}

export function unitPriceCents(slug: string, sizeCode: string): number {
  const b = BY_SLUG[slug];
  if (!b) return 0;
  for (const s of b.sizes) {
    if (s.code === sizeCode && s.retail_zar) return Math.round(s.retail_zar * 100);
  }
  return Math.round((b.price_from ?? 0) * 100);
}

// Bigger prints cost more (OTC add-on). A line is "large" when the printed art
// WIDTH exceeds the threshold; at/below it the standard print is included in the
// base price. The threshold sits ABOVE the current 30cm max print width, so this
// stays dormant (no fee charged) until the print area is grown with the studio UI.
export const UPSIZE_THRESHOLD_W_CM = 31.0;
// DISABLED for now — bigger prints carry no extra charge yet (set to OTC's add-on × markup when ready)
export const UPSIZE_FEE_CENTS: { light: number; dark: number } = { light: 0, dark: 0 };

export function colorHex(slug: string, colorCode: string): string | null {
  const b = BY_SLUG[slug];
  if (!b) return null;
  for (const c of b.colors) {
    if (c.gelato_code === colorCode) return c.hex;
  }
  return null;
}

/** Perceived-luminance light test — mirrors studio.js isLightColor(). */
export function isLightHex(hexStr: string | null | undefined): boolean {
  const h = (hexStr ?? "").replace(/^#/, "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.78;
}

interface Placement {
  front?: { scale?: number };
  back?: { scale?: number };
}

function maxScale(placement: Placement | string | null | undefined): number {
  let p: Placement | null = null;
  if (typeof placement === "string") {
    try {
      p = JSON.parse(placement);
    } catch {
      return 0.0;
    }
  } else if (placement && typeof placement === "object") {
    p = placement;
  }
  if (!p) return 0.0;
  let best = 0.0;
  for (const side of ["front", "back"] as const) {
    const scale = p[side]?.scale;
    if (typeof scale === "number") best = Math.max(best, scale);
  }
  return best;
}

export function isLargePrint(
  placement: Placement | string | null | undefined,
  areaWCm?: number
): boolean {
  const aw = areaWCm ?? PRINT_AREA.front.w_cm;
  return maxScale(placement) * aw > UPSIZE_THRESHOLD_W_CM;
}

/** Per-unit large-print add-on for this line, or 0 for a standard-size print. */
export function upsizeFeeCents(
  slug: string,
  colorCode: string,
  placement: Placement | string | null | undefined,
  areaWCm?: number
): number {
  if (!isLargePrint(placement, areaWCm)) return 0;
  const light = isLightHex(colorHex(slug, colorCode));
  return light ? UPSIZE_FEE_CENTS.light : UPSIZE_FEE_CENTS.dark;
}

/** STRUCTURAL guard (offline): the variant must exist in our verified catalogue. */
export function verifyItem(
  slug: string,
  colorCode: string,
  sizeCode: string
): [boolean, string] {
  const b = BY_SLUG[slug];
  if (!b) return [false, `Unknown product '${slug}'`];
  if (!b.sizes.some((s) => s.code === sizeCode)) {
    return [false, `Size '${sizeCode}' not offered for ${b.name}`];
  }
  if (!b.colors.some((c) => c.gelato_code === colorCode)) {
    return [false, `Colour '${colorCode}' not offered for ${b.name}`];
  }
  return [true, "otc"];
}
