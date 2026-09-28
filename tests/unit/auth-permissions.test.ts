import { describe, expect, it } from "vitest";
import { can, canManageProperty, PERMISSIONS } from "@/lib/permissions";
import { safeRedirectPath } from "@/lib/utils";
import { signInSchema, signUpSchema } from "@/lib/validation/auth";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { MemoryRateLimiter } from "@/server/rate-limit";

describe("role permissions", () => {
  it("never lets customers access host or admin functionality", () => {
    expect(can("CUSTOMER", "host:portal")).toBe(false);
    expect(can("CUSTOMER", "property:create")).toBe(false);
    expect(can("CUSTOMER", "admin:portal")).toBe(false);
    expect(can("CUSTOMER", "admin:properties:moderate")).toBe(false);
    expect(can("CUSTOMER", "booking:create")).toBe(true);
  });

  it("never lets hosts access admin functionality", () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      if (permission.startsWith("admin:")) expect(can("HOST", permission)).toBe(false);
    }
    expect(can("HOST", "host:portal")).toBe(true);
    expect(can("HOST", "booking:create")).toBe(true); // hosts can travel too
  });

  it("gives admins admin tools but not host tooling", () => {
    expect(can("ADMIN", "admin:portal")).toBe(true);
    expect(can("ADMIN", "admin:compliance:review")).toBe(true);
    expect(can("ADMIN", "host:portal")).toBe(false);
  });

  it("denies everything to anonymous users", () => {
    expect(can(null, "account:manage")).toBe(false);
    expect(can(undefined, "favourite:manage")).toBe(false);
  });

  it("only lets a host manage their own properties", () => {
    const property = { hostUserId: "host_a" };
    expect(canManageProperty({ id: "host_a", role: "HOST" }, property)).toBe(true);
    expect(canManageProperty({ id: "host_b", role: "HOST" }, property)).toBe(false);
    // Matching id but no longer a host (e.g. role changed) → denied
    expect(canManageProperty({ id: "host_a", role: "CUSTOMER" }, property)).toBe(false);
    expect(canManageProperty({ id: "admin_1", role: "ADMIN" }, property)).toBe(false);
    expect(canManageProperty(null, property)).toBe(false);
  });
});

describe("passwords", () => {
  it("hashes with bcrypt and verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery 9");
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery 9", hash)).toBe(true);
    expect(await verifyPassword("wrong password 1", hash)).toBe(false);
  });

  it("returns false (without throwing) for users with no password", async () => {
    expect(await verifyPassword("anything123", null)).toBe(false);
  });
});

describe("session tokens", () => {
  it("generates high-entropy unique tokens and stores only a hash", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
  });
});

describe("auth validation", () => {
  it("normalises email and rejects weak passwords at sign-up", () => {
    const ok = signUpSchema.safeParse({ name: " Sam ", email: " Sam@Example.COM ", password: "longenough1" });
    expect(ok.success && ok.data).toMatchObject({ name: "Sam", email: "sam@example.com" });
    expect(signUpSchema.safeParse({ name: "Sam", email: "sam@example.com", password: "short1" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "Sam", email: "sam@example.com", password: "onlyletterslong" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "Sam", email: "not-an-email", password: "longenough1" }).success).toBe(false);
  });

  it("ignores any role supplied by the client", () => {
    const parsed = signUpSchema.parse({ name: "Eve", email: "eve@example.com", password: "longenough1", role: "ADMIN" });
    expect(parsed).not.toHaveProperty("role");
  });

  it("does not apply strength rules at sign-in", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });

  it("strips control characters from names", () => {
    expect(signUpSchema.parse({ name: "Sam\u0000\u001b", email: "a@b.co", password: "longenough1" }).name).toBe("Sam");
  });
});

describe("safeRedirectPath (open-redirect protection)", () => {
  it.each([
    ["/account", "/account"],
    ["/search?drive=2", "/search?drive=2"],
    ["//evil.example", "/"],
    ["https://evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    [undefined, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });
});

describe("MemoryRateLimiter", () => {
  it("blocks after the limit and resets after the window", async () => {
    let now = 1_000;
    const limiter = new MemoryRateLimiter(() => now);
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await limiter.consume("k", rule)).success);
    expect(results).toEqual([true, true, true, false]);
    expect((await limiter.consume("other", rule)).success).toBe(true); // keys are independent
    now += 60_001;
    expect((await limiter.consume("k", rule)).success).toBe(true);
  });
});
