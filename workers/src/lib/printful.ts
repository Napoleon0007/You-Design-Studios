/**
 * Printful API client — SECOND fulfilment provider (apparel), ported 1:1 from
 * printful.py. Confirmed dormant in practice (every current catalog product
 * routes "local-sa") but ported faithfully in case it's ever activated.
 *
 * Auth: `Authorization: Bearer <PRINTFUL_API_KEY>` — a Workers secret
 * (`wrangler secret put PRINTFUL_API_KEY`), passed in via env, not a parsed
 * .env file (Workers has no filesystem / no need for the old dotenv shim).
 */

export interface PrintfulEnv {
  PRINTFUL_API_KEY?: string;
}

const BASE = "https://api.printful.com";

export class PrintfulError extends Error {}

export function hasKey(env: PrintfulEnv): boolean {
  return Boolean(env.PRINTFUL_API_KEY?.trim());
}

async function request(
  env: PrintfulEnv,
  method: string,
  path: string,
  body?: unknown,
  storeId?: string
): Promise<unknown> {
  if (!hasKey(env)) throw new PrintfulError("PRINTFUL_API_KEY not set");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (storeId) headers["X-PF-Store-Id"] = storeId;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new PrintfulError(`Network error reaching Printful: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    throw new PrintfulError(`Printful ${res.status} on ${method} ${path}: ${detail}`);
  }
  return res.json();
}

export async function getVariant(env: PrintfulEnv, variantId: string | number): Promise<any> {
  const r = (await request(env, "GET", `/products/variant/${variantId}`)) as { result?: unknown };
  return r.result ?? {};
}

const TYPE_TO_CATEGORY: [string, string][] = [
  ["hoodie", "hoodie"],
  ["sweatshirt", "sweatshirt"],
  ["crewneck", "sweatshirt"],
  ["tank", "tank-top"],
  ["polo", "polo"],
  ["t-shirt", "t-shirt"],
  ["tee", "t-shirt"],
];

export function categoryOf(product: { type_name?: string; title?: string }): string | null {
  const name = (product.type_name ?? product.title ?? "").toLowerCase();
  for (const [needle, cat] of TYPE_TO_CATEGORY) {
    if (name.includes(needle)) return cat;
  }
  return null;
}

/** LIVE guard: the variant must resolve in Printful's catalog, and (when we can
 * tell) its product type must match the expected garment category. */
export async function verifyVariant(
  env: PrintfulEnv,
  variantId: string,
  expectedCategory?: string | null
): Promise<[boolean, string]> {
  if (!hasKey(env)) return [true, "skipped (no key)"];
  let res: any;
  try {
    res = await getVariant(env, variantId);
  } catch (e) {
    const msg = (e as Error).message;
    if ([" 400", " 404", " 422"].some((code) => msg.includes(code))) {
      return [false, `Printful rejected variant ${variantId}: ${msg.slice(0, 120)}`];
    }
    return [true, `live check skipped (${msg.slice(0, 80)})`];
  }
  const product = res.product ?? {};
  const cat = categoryOf(product);
  if (expectedCategory && cat && cat !== expectedCategory) {
    return [false, `Type mismatch: Printful variant ${variantId} is '${cat}', expected '${expectedCategory}'`];
  }
  return [true, "ok"];
}
