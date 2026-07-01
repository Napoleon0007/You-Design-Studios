/**
 * imageService.ts — thin client for the standalone Railway image-processing
 * microservice (image-service/, Flask + Pillow). Bytes in, bytes out over
 * HTTP; this Worker owns storage (R2) — the microservice is stateless.
 *
 * Two operations don't fit in a Worker: render_print_file (printfile.py, a
 * ~67MB-decoded canvas composite — too close to the 128MB isolate ceiling)
 * and studio_card (mockup.py, procedural fabric-shaded compositing Cloudflare's
 * WASM image library has no primitives for). See the migration plan for the
 * full rationale.
 */

export interface ImageServiceEnv {
  IMAGE_SERVICE_URL?: string;
  IMAGE_SERVICE_KEY?: string;
}

export class ImageServiceError extends Error {}

function base64Encode(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64Decode(s: string): ArrayBuffer {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function post(env: ImageServiceEnv, path: string, body: unknown): Promise<any> {
  const base = (env.IMAGE_SERVICE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new ImageServiceError("IMAGE_SERVICE_URL not set — deploy image-service/ to Railway and bind its URL.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.IMAGE_SERVICE_KEY) headers["X-Service-Key"] = env.IMAGE_SERVICE_KEY;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (e) {
    throw new ImageServiceError(`Network error reaching image service: ${(e as Error).message}`);
  }
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new ImageServiceError(json?.error || `image service ${res.status} on ${path}`);
  }
  return json;
}

export interface PrintAreaSpec {
  w_px: number;
  h_px: number;
  dpi?: number;
}

export interface RenderPrintfileResult {
  printPng: ArrayBuffer;
  previewPng: ArrayBuffer;
  width: number;
  height: number;
  dpi: number;
}

/** Composite `artBytes` onto a transparent print-area canvas; also returns a preview thumb. */
export async function renderPrintfile(
  env: ImageServiceEnv,
  artBytes: ArrayBuffer,
  area: PrintAreaSpec,
  placement?: Record<string, unknown>
): Promise<RenderPrintfileResult> {
  const res = await post(env, "/render-printfile", {
    art_base64: base64Encode(artBytes),
    area,
    placement: placement ?? {},
  });
  return {
    printPng: base64Decode(res.print_png_base64),
    previewPng: base64Decode(res.preview_png_base64),
    width: res.width,
    height: res.height,
    dpi: res.dpi,
  };
}

/** Render a shareable studio-card mockup (JPEG bytes) of a design on a coloured garment. */
export async function studioCard(
  env: ImageServiceEnv,
  designBytes: ArrayBuffer,
  family: string,
  hexColor: string,
  opts?: { wordmark?: string; size?: "portrait" | "square" }
): Promise<ArrayBuffer> {
  const res = await post(env, "/mockup", {
    design_base64: base64Encode(designBytes),
    family,
    hex_color: hexColor,
    wordmark: opts?.wordmark ?? "",
    size: opts?.size ?? "portrait",
  });
  return base64Decode(res.image_base64);
}

export interface GradeVerdict {
  verdict: "pass" | "warn";
  message: string;
  format: string;
  width: number;
  height: number;
  has_transparency: boolean;
  effective_dpi: number;
  recommended_max_cm: { width: number; height: number };
  thresholds: { warn: number; fail: number };
}

/** Inspect an uploaded design and report a print-quality verdict. Throws
 * ImageServiceError (400-worthy) on an unreadable/unsupported image —
 * resolution itself never blocks, it's graded pass/warn only. */
export async function gradeImage(env: ImageServiceEnv, imageBytes: ArrayBuffer, printWCm: number, printHCm: number): Promise<GradeVerdict> {
  const res = await post(env, "/grade-image", {
    image_base64: base64Encode(imageBytes),
    print_w_cm: printWCm,
    print_h_cm: printHCm,
  });
  const { ok, ...verdict } = res;
  return verdict as GradeVerdict;
}
