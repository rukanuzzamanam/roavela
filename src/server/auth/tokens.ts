import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Only ever sent to the user; the database stores its hash. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
