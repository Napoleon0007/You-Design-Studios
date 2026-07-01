/**
 * storage.ts — file storage abstraction, ported 1:1 from storage.py.
 * Local filesystem -> Cloudflare R2 (the swap storage.py's docstring anticipated:
 * "a one-function change"). Needs the FILES R2 binding — added to wrangler.jsonc
 * once R2 is enabled on the account (blocked as of Phase 4 start).
 */

export interface StorageEnv {
  // Optional (not required) until R2 is enabled on the account and the binding
  // is added to wrangler.jsonc — put()/openBytes() throw a clear error if
  // called before then, rather than making every caller's env type depend on
  // a binding that doesn't exist yet.
  FILES?: R2Bucket;
  PUBLIC_BASE_URL?: string;
}

function bucket(env: StorageEnv): R2Bucket {
  if (!env.FILES) throw new Error("R2 'FILES' binding not configured — enable R2 and add it to wrangler.jsonc first.");
  return env.FILES;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newKey(prefix: string, ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/^\.+/, "");
  return `${prefix}_${randomHex(8)}.${cleanExt}`;
}

/** Absolute URL when PUBLIC_BASE_URL is set (prod / Gelato), else a path. */
export function publicUrl(env: StorageEnv, key: string): string {
  const base = (env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return base ? `${base}/files/${key}` : `/files/${key}`;
}

/** Store bytes under `key`; return its public URL. */
export async function put(env: StorageEnv, data: ArrayBuffer | Uint8Array, key: string): Promise<string> {
  await bucket(env).put(key, data);
  return publicUrl(env, key);
}

export async function openBytes(env: StorageEnv, key: string): Promise<ArrayBuffer | null> {
  const obj = await bucket(env).get(key);
  if (!obj) return null;
  return obj.arrayBuffer();
}

export async function exists(env: StorageEnv, key: string): Promise<boolean> {
  const head = await bucket(env).head(key);
  return head !== null;
}
