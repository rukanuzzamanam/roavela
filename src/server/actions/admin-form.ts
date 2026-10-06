import "server-only";
import type { AdminResult } from "@/server/services/admin/common";

/** Result shape every admin form renders (success message, error message, field errors). */
export interface AdminFormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Changes on every completed submission so the client can reset confirmation UI. */
  at?: number;
}

export function denied(error: string): AdminFormState {
  return { ok: false, message: error, at: Date.now() };
}

export function toFormState(result: AdminResult<unknown> & { fieldErrors?: Record<string, string> }, success: string): AdminFormState {
  return result.ok ? { ok: true, message: success, at: Date.now() } : { ok: false, message: result.message, fieldErrors: result.fieldErrors, at: Date.now() };
}

export function field(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

/** An id from a form: bounded and shape-checked; the service still looks it up. */
export function idField(fd: FormData, key: string): string | null {
  const v = field(fd, key);
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

/** Only revalidate admin paths we generated ourselves. */
export function adminPath(value: string): string | null {
  return /^\/admin(\/[A-Za-z0-9_-]+)*$/.test(value) ? value : null;
}
