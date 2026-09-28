import "server-only";
import { headers } from "next/headers";

/**
 * Best-effort client IP. X-Forwarded-For is only trustworthy behind a proxy that overwrites it
 * (e.g. Vercel, a configured load balancer). Used for rate-limit keys, never for authorisation.
 */
export async function getRequestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || h.get("x-real-ip") || "unknown",
    userAgent: h.get("user-agent"),
  };
}
