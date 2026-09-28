import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  // bcrypt only uses the first 72 bytes; cap well below to avoid silent truncation surprises.
  .max(72, "Use 72 characters or fewer")
  .refine((v) => /[a-zA-Z]/.test(v) && /[^a-zA-Z]/.test(v), "Include at least one letter and one number or symbol");

export const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(80, "Name is too long")
    // Plain-text only: strip control characters.
    .transform((v) => v.replace(/[\u0000-\u001f\u007f]/g, "")),
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  // Never apply strength rules on sign-in; just bound the input.
  password: z.string().min(1, "Enter your password").max(200),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
