/**
 * Rate-limiting abstraction.
 *
 * The in-memory implementation is suitable for local development and single-instance deployments
 * only. Serverless / multi-instance production needs a shared store (e.g. Redis/Upstash) —
 * implement `RateLimiter` and swap it in `getRateLimiter()`.
 */

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private now: () => number = Date.now) {}

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = this.now();
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      success: bucket.count <= rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  private sweep(now: number) {
    if (this.buckets.size < 10_000) return;
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

export const RATE_LIMITS = {
  signIn: { limit: 8, windowMs: 15 * 60_000 },
  signUp: { limit: 5, windowMs: 60 * 60_000 },
  favourite: { limit: 60, windowMs: 60_000 },
  profile: { limit: 20, windowMs: 60 * 60_000 },
  passwordResetRequestByIp: { limit: 5, windowMs: 15 * 60_000 },
  passwordResetRequestByEmail: { limit: 3, windowMs: 60 * 60_000 },
  passwordResetSubmit: { limit: 10, windowMs: 15 * 60_000 },
  // Host tools: generous enough for normal editing, tight enough to stop automated abuse.
  hostOnboarding: { limit: 20, windowMs: 60 * 60_000 },
  propertyCreate: { limit: 10, windowMs: 60 * 60_000 },
  hostSave: { limit: 300, windowMs: 60 * 60_000 },
  photoUpload: { limit: 120, windowMs: 60 * 60_000 },
  complianceUpload: { limit: 30, windowMs: 60 * 60_000 },
  listingSubmit: { limit: 20, windowMs: 60 * 60_000 },
  // Booking & payments (Phase 4).
  bookingQuote: { limit: 30, windowMs: 60 * 60_000 },
  checkout: { limit: 60, windowMs: 60 * 60_000 },
  paymentIntent: { limit: 30, windowMs: 60 * 60_000 },
  bookingCancel: { limit: 10, windowMs: 60 * 60_000 },
  // Per source IP. Stripe retries with backoff, so a generous cap only stops floods.
  webhook: { limit: 600, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

const globalForLimiter = globalThis as unknown as { rateLimiter?: RateLimiter };

export function getRateLimiter(): RateLimiter {
  globalForLimiter.rateLimiter ??= new MemoryRateLimiter();
  return globalForLimiter.rateLimiter;
}
