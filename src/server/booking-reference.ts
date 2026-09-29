import "server-only";
import { randomInt } from "node:crypto";

/** No 0/O/1/I/L to avoid confusion when read aloud or typed. */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERENCE_PATTERN = /^ROA-[2-9A-HJKMNP-Z]{6}$/;

/** Unpredictable, human-friendly, non-sequential: 31^6 ≈ 887 million combinations (uniqueness enforced by the DB). */
export function generateBookingReference(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `ROA-${code}`;
}
