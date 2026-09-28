import { z } from "zod";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(80, "Name is too long")
  // Plain text only: strip control characters.
  .transform((v) => v.replace(/[\u0000-\u001f\u007f]/g, ""))
  .pipe(z.string().min(1, "Enter your name"));

/** Optional phone. Lenient on formatting (spaces, brackets, dashes) but digits-only content. */
export const phoneSchema = z
  .string()
  .trim()
  .max(24, "Phone number is too long")
  .transform((v) => (v === "" ? null : v))
  .refine((v) => v === null || /^\+?[0-9][0-9 ()-]{5,22}$/.test(v), "Enter a valid phone number, e.g. 0412 345 678 or +61 412 345 678");

/**
 * Editable profile fields. Email is intentionally NOT editable here: changing it safely requires
 * verifying the new address first, which arrives with account verification.
 */
export const profileSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
});

export type ProfileInput = z.infer<typeof profileSchema>;
