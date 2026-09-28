import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Validated lazily on first access so that tooling (lint, typecheck,
 * unit tests) does not require a full environment. Never import this from client components.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  SHOW_DEMO_LISTINGS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ROUTING_PROVIDER: z.enum(["heuristic"]).default("heuristic"),
  ANALYTICS_PROVIDER: z.enum(["console", "none"]).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Roavela <hello@example.com>"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Log field names only — never values, which may be secrets.
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment — ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** Demo (seeded) listings are visible in development, and in production only when explicitly enabled. */
export function demoListingsVisible(): boolean {
  const e = env();
  return e.NODE_ENV !== "production" || e.SHOW_DEMO_LISTINGS;
}
