import "server-only";

/**
 * Structured server logging (one JSON line per event). Callers pass identifiers only — booking
 * references, internal ids, status names, amounts. Never emails, names, addresses, card data,
 * client secrets or API/webhook secrets; `redact` is a last line of defence, not a licence.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEY = /secret|password|token|authorization|card|cvc|email|phone|address|signature/i;
const SECRET_VALUE = /\b(sk|rk|pk)_(test|live)_[A-Za-z0-9]+|\bwhsec_[A-Za-z0-9]+|\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g;

export function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : typeof v === "string" ? v.replace(SECRET_VALUE, "[redacted]") : v;
  }
  return out;
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, fields: Fields = {}) => write("info", event, fields),
  warn: (event: string, fields: Fields = {}) => write("warn", event, fields),
  error: (event: string, fields: Fields = {}) => write("error", event, fields),
};

/** Error summary safe to log: class and message only, with anything secret-shaped stripped. */
export function errorFields(e: unknown): Fields {
  if (!(e instanceof Error)) return { error: "unknown" };
  return { error: e.name, message: e.message.slice(0, 300) };
}
