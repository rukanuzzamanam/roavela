/**
 * Admin list query parameters (filters live in the URL so views are shareable and reloadable).
 * Everything is validated here; anything unexpected falls back to a safe default.
 */
export const ADMIN_PAGE_SIZE = 25;
export const MAX_ADMIN_PAGE = 2000;
export const MAX_QUERY_LENGTH = 100;

export type RawParams = Record<string, string | string[] | undefined>;

export function first(params: RawParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parsePage(params: RawParams): number {
  const n = Number(first(params, "page"));
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_ADMIN_PAGE) : 1;
}

/** Free-text search: trimmed, control characters removed, length-capped. Empty → undefined. */
export function parseQuery(params: RawParams, key = "q"): string | undefined {
  const v = (first(params, key) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_QUERY_LENGTH);
  return v.length > 0 ? v : undefined;
}

export function oneOf<T extends string>(params: RawParams, key: string, allowed: readonly T[]): T | undefined {
  const v = first(params, key);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function pageCount(total: number, pageSize = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Build a list URL from the current (validated) filters plus overrides; empty values are dropped. */
export function listHref(base: string, filters: Record<string, string | number | undefined>, overrides: Record<string, string | number | undefined> = {}): string {
  const merged = { ...filters, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "" || (k === "page" && v === 1)) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
