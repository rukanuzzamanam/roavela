/**
 * Phase 5 integration + security tests: admin authorisation (real sessions — the role is always
 * re-read from the database), property and compliance review, IDOR on private documents, refunds
 * (idempotency, limits, concurrency, provider failure, live-key refusal), financial reconciliation,
 * commission scheduling, account suspension, review moderation, notes privacy, audit immutability,
 * search and pagination. Real PostgreSQL with isolated fixtures; payments use the development mock
 * provider — no network calls.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real session resolution, driven by a fake cookie jar.
let currentToken: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (currentToken ? { value: currentToken } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { decideListingAction, addNoteAction, moderateReviewAction, reviewComplianceAction, startReviewAction } from "@/server/actions/admin-listings";
import { cancelBookingAction, createCommissionAction, executeRefundAction, suspendAccountAction } from "@/server/actions/admin-operations";
import { reserveStay } from "@/server/actions/bookings";
import { GET as complianceFileRoute } from "@/app/host/compliance/[id]/file/route";
import { gateAdminAction } from "@/server/auth/admin-guard";
import { getCurrentUser } from "@/server/auth/session";
import { generateToken, hashToken } from "@/server/auth/tokens";
import { prisma } from "@/server/db";
import { setPaymentProviderForTests, MockPaymentProvider } from "@/server/payments/provider";
import { getAdminBooking, listAdminBookings, listReconciliation } from "@/server/services/admin/bookings";
import { createFeeSchedule } from "@/server/services/admin/commission";
import { listComplianceQueue, reviewComplianceDocument } from "@/server/services/admin/compliance";
import { addAdminNote, listNotes } from "@/server/services/admin/history";
import { getDashboardMetrics } from "@/server/services/admin/metrics";
import { listAdminProperties } from "@/server/services/admin/properties";
import { cancelBookingAsAdmin, executeAdminRefund, listRefundAttention } from "@/server/services/admin/refunds";
import { moderateReview } from "@/server/services/admin/reviews";
import { listCustomers, reactivateAccount, suspendAccount } from "@/server/services/admin/users";
import { createBookingHold } from "@/server/services/bookings";
import { cancelBookingAsGuest, preparePayment, simulateMockPayment } from "@/server/services/checkout";
import { getActiveFeeSchedule } from "@/server/services/fees";
import { getManagedProperty } from "@/server/services/host-properties";
import { reviewListing } from "@/server/services/listing-review";
import { resolveRange } from "@/lib/admin/ranges";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { LocalDiskStorage, setStorageForTests } from "@/server/storage";
import type { AdminFormState } from "@/server/actions/admin-form";

const run = randomBytes(4).toString("hex");
const ids = { destination: "", admin: "", admin2: "", hostA: "", hostB: "", hostAProfile: "", hostBProfile: "", customerA: "", customerB: "", live: "", liveB: "" };
const createdProperties: string[] = [];
const createdSchedules: string[] = [];
let storageDir = "";
const tokens = new Map<string, string>();

/** Act as a user (a real Session row) — or as nobody. */
async function as(userId: string | null) {
  if (!userId) {
    currentToken = null;
    return;
  }
  let token = tokens.get(userId);
  if (!token || (await prisma.session.count({ where: { id: hashToken(token) } })) === 0) {
    token = generateToken();
    await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + 3_600_000) } });
    tokens.set(userId, token);
  }
  currentToken = token;
}

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const call = (action: (p: AdminFormState, fd: FormData) => Promise<AdminFormState>, values: Record<string, string>) => action({}, form(values));
const admin = () => ({ id: ids.admin, role: "ADMIN" as const });
const admin2 = () => ({ id: ids.admin2, role: "ADMIN" as const });

const propertyBase = () => ({
  destinationId: ids.destination,
  summary: "Phase 5 fixture listing",
  description: "Phase 5 fixture listing used by the admin operations integration tests.",
  type: "COTTAGE" as const,
  addressLine1: "5 Admin Road",
  locality: "Pokolbin",
  adminArea: "NSW",
  postcode: "2320",
  countryCode: "AU",
  timezone: "Australia/Sydney",
  bedrooms: 2,
  beds: 2,
  bathrooms: 1,
  maxGuests: 4,
  nightlyPriceCents: 20_000,
  cleaningFeeCents: 8_000,
  minNights: 1,
  cancellationPolicy: "MODERATE" as const,
});

async function property(hostProfileId: string, status: "PUBLISHED" | "PENDING_REVIEW" | "DRAFT" | "REJECTED", title: string) {
  const p = await prisma.property.create({ data: { ...propertyBase(), hostId: hostProfileId, slug: `p5-${title.toLowerCase().replace(/\W+/g, "-")}-${run}`, title, status, submittedAt: status === "DRAFT" ? null : new Date() } });
  createdProperties.push(p.id);
  return p;
}

let nextDay = 0;
/** A paid, CONFIRMED booking on `propertyId` through the real hold → payment → event pipeline. */
async function confirmedBooking(guestId: string, propertyId = ids.live) {
  const start = new Date(Date.UTC(2027, 4, 1) + nextDay * 86_400_000 * 3);
  nextDay += 1;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const res = await createBookingHold({ id: guestId }, { propertyId, checkIn: iso(start), checkOut: iso(new Date(start.getTime() + 2 * 86_400_000)), adults: 2, children: 0 });
  if (!res.ok) throw new Error(`hold failed: ${res.error}`);
  expect((await preparePayment(guestId, res.reference)).ok).toBe(true);
  expect(await simulateMockPayment(guestId, res.reference, "succeeded")).toMatchObject({ ok: true, outcome: "processed" });
  return prisma.booking.findUniqueOrThrow({ where: { reference: res.reference }, include: { payments: true, refunds: true } });
}
const reload = (reference: string) => prisma.booking.findUniqueOrThrow({ where: { reference }, include: { payments: true, refunds: true } });

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "roavela-p5-"));
  setStorageForTests(new LocalDiskStorage(storageDir));
  setPaymentProviderForTests(undefined);
  ids.destination = (await prisma.destination.create({ data: { slug: `p5-dest-${run}`, name: "P5 Destination", kind: "TOWN", countryCode: "AU", adminArea: "NSW", latitude: -32.8, longitude: 151.3, timezone: "Australia/Sydney" } })).id;
  const mk = (key: string, role: "ADMIN" | "HOST" | "CUSTOMER", name: string) =>
    prisma.user.create({ data: { email: `p5-${key}-${run}@integration.test`, name, role, ...(role === "HOST" ? { hostProfile: { create: { displayName: name, onboardingStatus: "COMPLETE" } } } : {}) }, include: { hostProfile: true } });
  const [a, a2, hA, hB, cA, cB] = await Promise.all([mk("admin", "ADMIN", "Ada Admin"), mk("admin2", "ADMIN", "Abe Admin"), mk("hosta", "HOST", "Hana Host"), mk("hostb", "HOST", "Hugo Host"), mk("cust-a", "CUSTOMER", "Cara Customer"), mk("cust-b", "CUSTOMER", "Cody Customer")]);
  Object.assign(ids, { admin: a.id, admin2: a2.id, hostA: hA.id, hostB: hB.id, hostAProfile: hA.hostProfile!.id, hostBProfile: hB.hostProfile!.id, customerA: cA.id, customerB: cB.id });
  ids.live = (await property(ids.hostAProfile, "PUBLISHED", "P5 Live Cottage")).id;
  ids.liveB = (await property(ids.hostBProfile, "PUBLISHED", "P5 Other Host Cottage")).id;
});

afterAll(async () => {
  setPaymentProviderForTests(undefined);
  setStorageForTests(undefined);
  const userIds = [ids.admin, ids.admin2, ids.hostA, ids.hostB, ids.customerA, ids.customerB];
  const bookings = await prisma.booking.findMany({ where: { OR: [{ propertyId: { in: createdProperties } }, { guestId: { in: userIds } }] }, select: { id: true } });
  const bookingIds = bookings.map((b) => b.id);
  const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
  await prisma.webhookEvent.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
  await prisma.review.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  // Retire the test fee schedule (after its bookings) so later suites price with the normal fees.
  await prisma.platformFeeSchedule.deleteMany({ where: { id: { in: createdSchedules } } });
  await prisma.complianceDocument.deleteMany({ where: { propertyId: { in: createdProperties } } });
  await prisma.property.deleteMany({ where: { id: { in: createdProperties } } });
  await prisma.adminNote.deleteMany({ where: { authorId: { in: userIds } } });
  await prisma.adminAction.deleteMany({ where: { adminId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { contains: `-${run}@` } }] } });
  await prisma.destination.deleteMany({ where: { id: ids.destination } });
  await rm(storageDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

// ── Authorisation ────────────────────────────────────────────────────────────

describe("admin authorisation is server-side and session-derived", () => {
  it("only a signed-in, active ADMIN passes the admin gate", async () => {
    await as(null);
    expect((await gateAdminAction("admin:portal")).ok).toBe(false);
    await as(ids.customerA);
    expect((await gateAdminAction("admin:portal")).ok).toBe(false);
    await as(ids.hostA);
    expect((await gateAdminAction("admin:portal")).ok).toBe(false);
    await as(ids.admin);
    expect(await gateAdminAction("admin:portal")).toMatchObject({ ok: true, admin: { id: ids.admin, role: "ADMIN" } });
  });

  it("a suspended ADMIN with a live session is treated as signed out", async () => {
    const suspended = await prisma.user.create({ data: { email: `p5-sus-admin-${run}@integration.test`, name: "Sus Admin", role: "ADMIN", status: "SUSPENDED" } });
    await as(suspended.id);
    expect(await getCurrentUser()).toBeNull();
    expect((await gateAdminAction("admin:portal")).ok).toBe(false);
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Suspended Admin Target");
    const res = await call(decideListingAction, { propertyId: p.id, decision: "approve", complianceReviewed: "on", role: "ADMIN" });
    expect(res.ok).toBe(false);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING_REVIEW");
  });

  it("customers and hosts can't call any admin action, even claiming role=ADMIN in the request", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Role Claim Target");
    const b = await confirmedBooking(ids.customerB);
    for (const user of [ids.customerA, ids.hostA]) {
      await as(user);
      const attempts = [
        call(decideListingAction, { propertyId: p.id, decision: "approve", complianceReviewed: "on", role: "ADMIN", status: "PUBLISHED" }),
        call(startReviewAction, { propertyId: p.id }),
        call(executeRefundAction, { reference: b.reference, mode: "custom", amount: "10", reason: "malicious refund", requestKey: randomUUID(), role: "ADMIN" }),
        call(cancelBookingAction, { reference: b.reference, refundMode: "full", reason: "malicious cancel", requestKey: randomUUID(), version: b.updatedAt.toISOString() }),
        call(createCommissionAction, { name: "Hacked", guestServiceFeeBps: "0", hostCommissionBps: "0", effectiveDate: "2030-01-01", reason: "malicious change", confirmed: "on" }),
        call(suspendAccountAction, { userId: ids.hostB, reason: "malicious suspension", version: new Date().toISOString() }),
        call(addNoteAction, { targetType: "Property", targetId: p.id, body: "x", path: "/admin" }),
        call(reviewComplianceAction, { documentId: "nope", decision: "approve", version: new Date().toISOString() }),
        call(moderateReviewAction, { reviewId: "nope", decision: "remove", reason: "malicious", version: new Date().toISOString() }),
      ];
      for (const res of await Promise.all(attempts)) expect(res).toMatchObject({ ok: false, message: "You don't have permission to do that." });
    }
    expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PENDING_REVIEW");
    expect(await prisma.refund.count({ where: { bookingId: b.id } })).toBe(0);
    expect((await reload(b.reference)).status).toBe("CONFIRMED");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.hostB } })).status).toBe("ACTIVE");
    expect(await prisma.platformFeeSchedule.count({ where: { name: "Hacked" } })).toBe(0);
  });

  it("services re-check the capability too (defence in depth)", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Service Check");
    expect(await reviewListing({ id: ids.hostA, role: "HOST" }, p.id, "approve")).toEqual({ ok: false, error: "forbidden" });
    expect((await executeAdminRefund({ id: ids.customerA, role: "CUSTOMER" }, { reference: "ROA-AAAAAA", mode: "custom", amount: "1", reason: "nope nope", requestKey: randomUUID() })).ok).toBe(false);
    expect((await createFeeSchedule({ id: ids.hostA, role: "HOST" }, {})).ok).toBe(false);
    expect((await suspendAccount({ id: ids.customerA, role: "CUSTOMER" }, { userId: ids.customerB, reason: "nope nope", expectedUpdatedAt: new Date() })).ok).toBe(false);
  });
});

// ── Property review ──────────────────────────────────────────────────────────

describe("property review workflow", () => {
  it("queues, starts review, requests changes (host sees the message, not internal notes), then approves on resubmission", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Review Flow");
    expect((await listAdminProperties({ filter: "pending", q: "P5 Review Flow", page: 1 })).rows.map((r) => r.id)).toEqual([p.id]);

    await as(ids.admin);
    expect(await call(startReviewAction, { propertyId: p.id })).toMatchObject({ ok: true });
    expect((await listAdminProperties({ filter: "under_review", q: "P5 Review Flow", page: 1 })).total).toBe(1);

    const v1 = (await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).updatedAt.toISOString();
    const res = await call(decideListingAction, { propertyId: p.id, decision: "request_changes", category: "photos", reason: "Please add a photo of the bathroom.", internalNote: "INTERNAL-ONLY-SECRET-NOTE", version: v1 });
    expect(res).toMatchObject({ ok: true });
    const after = await prisma.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ status: "CHANGES_REQUESTED", rejectionReason: "Photos: Please add a photo of the bathroom.", reviewStartedAt: null });
    expect(await prisma.adminAction.findFirst({ where: { targetId: p.id, action: "property.request_changes" } })).toMatchObject({ adminId: ids.admin, reason: "Please add a photo of the bathroom.", metadata: { from: "PENDING_REVIEW", to: "CHANGES_REQUESTED", category: "photos" } });

    // The host's own view carries the reviewer's message but never internal notes.
    const hostView = await getManagedProperty(ids.hostA, p.id);
    expect(hostView?.property.rejectionReason).toContain("bathroom");
    expect(JSON.stringify(hostView)).not.toContain("INTERNAL-ONLY-SECRET-NOTE");
    expect((await listNotes("Property", p.id)).map((n) => n.body)).toEqual(["INTERNAL-ONLY-SECRET-NOTE"]);

    // Host resubmits (simulated: back to review) → admin approves with the compliance acknowledgement.
    await prisma.property.update({ where: { id: p.id }, data: { status: "PENDING_REVIEW", submittedAt: new Date(), rejectionReason: null } });
    const v2 = (await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).updatedAt.toISOString();
    expect(await call(decideListingAction, { propertyId: p.id, decision: "approve", version: v2 })).toMatchObject({ ok: false });
    expect(await call(decideListingAction, { propertyId: p.id, decision: "approve", complianceReviewed: "on", version: v2 })).toMatchObject({ ok: true });
    expect(await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "PUBLISHED", rejectionReason: null });
    expect(await prisma.adminAction.count({ where: { targetId: p.id, action: { in: ["property.review_started", "property.request_changes", "property.approve"] } } })).toBe(3);
  });

  it("rejects without deleting, and requires a reason", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Reject Me");
    await as(ids.admin);
    const v = p.updatedAt.toISOString();
    expect(await call(decideListingAction, { propertyId: p.id, decision: "reject", category: "policy", reason: "", version: v })).toMatchObject({ ok: false });
    expect(await call(decideListingAction, { propertyId: p.id, decision: "reject", category: "policy", reason: "Commercial event venue, not accommodation.", version: v })).toMatchObject({ ok: true });
    expect(await prisma.property.findUnique({ where: { id: p.id } })).toMatchObject({ status: "REJECTED" });
  });

  it("blocks every invalid route to PUBLISHED", async () => {
    for (const status of ["DRAFT", "REJECTED"] as const) {
      const p = await property(ids.hostAProfile, status, `P5 Invalid ${status}`);
      expect(await reviewListing(admin(), p.id, "approve")).toEqual({ ok: false, error: "invalid_transition" });
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(status);
    }
    const s = await property(ids.hostAProfile, "PUBLISHED", "P5 Suspend Then Approve");
    expect(await reviewListing(admin(), s.id, "suspend", "Safety complaint under investigation")).toEqual({ ok: true, status: "SUSPENDED" });
    expect(await reviewListing(admin(), s.id, "approve")).toEqual({ ok: false, error: "invalid_transition" });
    expect(await reviewListing(admin(), s.id, "reinstate")).toEqual({ ok: true, status: "PAUSED" });
  });

  it("a stale page can't overwrite another admin's newer decision", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Stale Page");
    const stale = p.updatedAt;
    expect(await reviewListing(admin(), p.id, "approve", { expectedUpdatedAt: stale })).toEqual({ ok: true, status: "PUBLISHED" });
    // Admin B, still looking at the old page, clicks reject.
    expect(await reviewListing(admin2(), p.id, "reject", { reason: "Looks wrong to me", expectedUpdatedAt: stale })).toEqual({ ok: false, error: "stale" });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PUBLISHED");
  });

  it("concurrent decisions on the same version: exactly one wins", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Race");
    const results = await Promise.all([
      reviewListing(admin(), p.id, "approve", { expectedUpdatedAt: p.updatedAt }),
      reviewListing(admin2(), p.id, "request_changes", { reason: "Needs more photos", expectedUpdatedAt: p.updatedAt }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.adminAction.count({ where: { targetId: p.id, action: { in: ["property.approve", "property.request_changes"] } } })).toBe(1);
  });
});

// ── Compliance ───────────────────────────────────────────────────────────────

describe("compliance review and private documents", () => {
  it("reviews with version checks, requires a host-facing note to reject, flags expiry", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Compliance");
    const doc = await prisma.complianceDocument.create({ data: { hostId: ids.hostAProfile, propertyId: p.id, jurisdiction: "AU-NSW", type: "SHORT_TERM_RENTAL_REGISTRATION", referenceNumber: `PID-STRA-${run.toUpperCase()}`, expiresAt: new Date("2020-01-01") } });

    const queue = await listComplianceQueue({ filter: "expired", q: `PID-STRA-${run}`, page: 1 });
    expect(queue.rows.map((r) => r.id)).toEqual([doc.id]);
    expect(queue.rows[0]!.flags.map((f) => f.code)).toContain("expired");

    expect((await reviewComplianceDocument(admin(), { documentId: doc.id, decision: "reject", note: "", expectedUpdatedAt: doc.updatedAt })).ok).toBe(false);
    expect((await reviewComplianceDocument(admin(), { documentId: doc.id, decision: "approve", expectedUpdatedAt: new Date(0) })).ok).toBe(false); // stale
    expect(await reviewComplianceDocument(admin(), { documentId: doc.id, decision: "approve", note: "Registration number checked against the host's certificate.", expectedUpdatedAt: doc.updatedAt })).toMatchObject({ ok: true, value: { status: "APPROVED" } });
    const reviewed = await prisma.complianceDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(reviewed).toMatchObject({ status: "APPROVED", reviewedById: ids.admin });
    expect(await reviewComplianceDocument(admin(), { documentId: doc.id, decision: "expire", expectedUpdatedAt: reviewed.updatedAt })).toMatchObject({ ok: true, value: { status: "EXPIRED" } });
    expect(await prisma.adminAction.count({ where: { targetId: p.id, action: { in: ["compliance.reviewed", "compliance.expired"] } } })).toBe(2);
  });

  it("documents are private: owner and admin only — other hosts and customers get a 404", async () => {
    const p = await property(ids.hostAProfile, "PENDING_REVIEW", "P5 Private Doc");
    const { getStorage } = await import("@/server/storage");
    const stored = await getStorage().put({ visibility: "private", folder: `compliance/${ids.hostAProfile}`, extension: "pdf", bytes: new TextEncoder().encode("%PDF-1.4 secret") });
    expect(stored.url).toBeNull(); // no public URL exists
    const doc = await prisma.complianceDocument.create({ data: { hostId: ids.hostAProfile, propertyId: p.id, jurisdiction: "AU-NSW", type: "INSURANCE", data: { confirmed: true }, fileKey: stored.key } });
    const get = () => complianceFileRoute(new Request("http://localhost/x"), { params: Promise.resolve({ id: doc.id }) });

    for (const outsider of [null, ids.hostB, ids.customerA]) {
      await as(outsider);
      const res = await get();
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("secret");
    }
    await as(ids.hostA);
    const own = await get();
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toContain("no-store");
    expect(own.headers.get("x-robots-tag")).toContain("noindex");

    await as(ids.admin);
    expect((await get()).status).toBe(200);
    expect(await prisma.adminAction.count({ where: { adminId: ids.admin, action: "compliance.document_viewed", metadata: { path: ["documentId"], equals: doc.id } } })).toBe(1);
  });
});

// ── Refunds ──────────────────────────────────────────────────────────────────

describe("admin refunds (TEST mode)", () => {
  it("validates amounts on the server and never trusts the browser", async () => {
    const b = await confirmedBooking(ids.customerA);
    await as(ids.admin);
    for (const amount of ["abc", "-5", "10.005", "0", String((b.totalCents + 1) / 100), "1e3"]) {
      expect(await call(executeRefundAction, { reference: b.reference, mode: "custom", amount, reason: "Goodwill refund for noise", requestKey: randomUUID() })).toMatchObject({ ok: false });
    }
    // "policy" mode ignores any client amount: nothing is owed on a CONFIRMED booking.
    expect(await call(executeRefundAction, { reference: b.reference, mode: "policy", amount: "999", reason: "Policy refund please", requestKey: randomUUID() })).toMatchObject({ ok: false });
    expect(await prisma.refund.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it("executes once per request key — duplicates and retries never refund twice", async () => {
    const b = await confirmedBooking(ids.customerA);
    await as(ids.admin);
    const key = randomUUID();
    const values = { reference: b.reference, mode: "custom", amount: "50.00", reason: "Hot water outage goodwill", requestKey: key };
    const first = await call(executeRefundAction, values);
    expect(first).toMatchObject({ ok: true });
    const again = await Promise.all([call(executeRefundAction, values), call(executeRefundAction, values)]);
    for (const r of again) expect(r).toMatchObject({ ok: true, message: expect.stringContaining("already submitted") });

    const after = await reload(b.reference);
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({ amountCents: 5_000, status: "SUCCEEDED", reason: "admin_refund", requestedById: ids.admin });
    expect(after.payments[0]).toMatchObject({ refundedCents: 5_000, status: "PARTIALLY_REFUNDED" });
    expect(after.status).toBe("CONFIRMED"); // a goodwill refund doesn't cancel the stay
    expect(await prisma.adminAction.count({ where: { targetId: b.id, action: "refund.executed" } })).toBe(1);
  });

  it("never refunds more than paid − previous refunds, even under concurrency", async () => {
    const b = await confirmedBooking(ids.customerA);
    const total = b.totalCents;
    const results = await Promise.all(
      [1, 2, 3].map(() => executeAdminRefund(admin(), { reference: b.reference, mode: "custom", amount: (total / 100).toFixed(2), reason: "Full goodwill refund", requestKey: randomUUID() })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await reload(b.reference);
    expect(after.payments[0]!.refundedCents).toBe(total);
    expect(after.refunds.filter((r) => r.status !== "FAILED").reduce((t, r) => t + r.amountCents, 0)).toBe(total);
    expect((await executeAdminRefund(admin(), { reference: b.reference, mode: "custom", amount: "0.01", reason: "One more cent", requestKey: randomUUID() })).ok).toBe(false);
  });

  it("a provider failure changes no booking or payment state and lands in the refund queue", async () => {
    const b = await confirmedBooking(ids.customerA);
    const failing = new MockPaymentProvider();
    failing.refund = async () => {
      throw new Error("network down");
    };
    setPaymentProviderForTests(failing);
    try {
      const cancelled = await cancelBookingAsGuest(ids.customerA, b.reference);
      expect(cancelled).toMatchObject({ ok: true, status: "REFUND_PENDING" });
      const res = await executeAdminRefund(admin(), { reference: b.reference, mode: "policy", amount: "", reason: "Retry the policy refund", requestKey: randomUUID() });
      expect(res).toMatchObject({ ok: false, message: expect.stringContaining("No booking or payment status was changed") });
    } finally {
      setPaymentProviderForTests(undefined);
    }
    const stuck = await reload(b.reference);
    expect(stuck.status).toBe("REFUND_PENDING");
    expect(stuck.payments[0]!.refundedCents).toBe(0);
    expect(stuck.refunds.every((r) => r.status === "FAILED")).toBe(true);
    expect((await listRefundAttention(1)).rows.some((r) => r.reference === b.reference && r.outstandingCents === stuck.refundDueCents)).toBe(true);

    // Two admins retry the owed refund at the same moment with different keys: only one goes through.
    const retries = await Promise.all([admin(), admin2()].map((a) => executeAdminRefund(a, { reference: b.reference, mode: "policy", amount: "", reason: "Retry owed policy refund", requestKey: randomUUID() })));
    expect(retries.filter((r) => r.ok)).toHaveLength(1);
    const done = await reload(b.reference);
    expect(done.status).toBe("REFUNDED");
    expect(done.payments[0]!.refundedCents).toBe(done.refundDueCents);
  });

  it("refuses to refund when live Stripe keys are configured (fails safely, records nothing)", async () => {
    const b = await confirmedBooking(ids.customerA);
    const saved = { STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY, PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER };
    process.env.STRIPE_SECRET_KEY = "sk_live_not_a_real_key";
    try {
      const res = await executeAdminRefund(admin(), { reference: b.reference, mode: "custom", amount: "10", reason: "Should never run live", requestKey: randomUUID() });
      expect(res).toMatchObject({ ok: false, code: "provider" });
    } finally {
      if (saved.STRIPE_SECRET_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = saved.STRIPE_SECRET_KEY;
    }
    expect(await prisma.refund.count({ where: { bookingId: b.id } })).toBe(0);
  });

  it("admin cancellation goes through the lifecycle and refunds via the same pipeline", async () => {
    const b = await confirmedBooking(ids.customerB);
    expect((await cancelBookingAsAdmin(admin(), { reference: b.reference, refundMode: "full", reason: "Property flooded", requestKey: randomUUID(), expectedUpdatedAt: new Date(0) })).ok).toBe(false); // stale
    const res = await cancelBookingAsAdmin(admin(), { reference: b.reference, refundMode: "full", reason: "Property flooded", requestKey: randomUUID(), expectedUpdatedAt: b.updatedAt });
    expect(res).toMatchObject({ ok: true, value: { status: "REFUND_PENDING", refundCents: b.totalCents } });
    const after = await reload(b.reference);
    expect(after).toMatchObject({ status: "REFUNDED", refundDueCents: b.totalCents, cancellationReason: "Cancelled by Roavela: Property flooded" });
    expect(after.refunds).toEqual([expect.objectContaining({ reason: "admin_cancellation", amountCents: b.totalCents, status: "SUCCEEDED" })]);
    // A cancelled booking can't be cancelled again.
    expect((await cancelBookingAsAdmin(admin(), { reference: b.reference, refundMode: "full", reason: "Again", requestKey: randomUUID(), expectedUpdatedAt: after.updatedAt })).ok).toBe(false);
  });
});

// ── Reconciliation, search, metrics ──────────────────────────────────────────

describe("financial oversight", () => {
  it("a real booking reconciles; tampered figures are flagged, never repaired", async () => {
    const b = await confirmedBooking(ids.customerA);
    expect((await getAdminBooking(b.reference))!.reconciliation.issues).toEqual([]);

    // Shift one cent from host proceeds to commission (the DB total check still holds).
    await prisma.booking.update({ where: { id: b.id }, data: { hostCommissionCents: { increment: 1 }, hostPayoutCents: { decrement: 1 }, platformRevenueCents: { increment: 1 } } });
    await prisma.payment.update({ where: { id: b.payments[0]!.id }, data: { currency: "NZD" } });
    const codes = (await getAdminBooking(b.reference))!.reconciliation.issues.map((i) => i.code);
    // The shift is internally consistent, so only the rate check catches it — plus the currency.
    expect(codes).toEqual(expect.arrayContaining(["commission_mismatch", "currency_mismatch"]));
    const range = resolveRange({ range: "7d" });
    expect((await listReconciliation({ from: range.from, to: range.to, issuesOnly: true, page: 1 })).rows.some((r) => r.reference === b.reference)).toBe(true);
    // Nothing was "fixed" behind our back.
    const untouched = await reload(b.reference);
    expect(untouched.hostCommissionCents).toBe(b.hostCommissionCents + 1);
    expect(untouched.payments[0]!.currency).toBe("NZD");
    await prisma.payment.update({ where: { id: b.payments[0]!.id }, data: { currency: "AUD" } });
  });

  it("searches bookings by reference, customer email and status", async () => {
    const b = await confirmedBooking(ids.customerB);
    expect((await listAdminBookings({ q: b.reference, page: 1 })).rows.map((r) => r.reference)).toEqual([b.reference]);
    expect((await listAdminBookings({ q: `p5-cust-b-${run}`, status: "CONFIRMED", page: 1 })).rows.some((r) => r.reference === b.reference)).toBe(true);
    expect((await listAdminBookings({ q: b.reference, status: "CANCELLED", page: 1 })).total).toBe(0);
  });

  it("dashboard GBV and platform revenue come from real bookings (demo excluded)", async () => {
    const range = resolveRange({ range: "7d" });
    const before = await getDashboardMetrics(range);
    const b = await confirmedBooking(ids.customerB);
    const after = await getDashboardMetrics(range);
    expect(after.bookings.confirmed - before.bookings.confirmed).toBe(1);
    expect(after.money.gbvCents - before.money.gbvCents).toBe(b.totalCents);
    expect(after.money.platformGrossCents - before.money.platformGrossCents).toBe(b.platformRevenueCents);
  });
});

// ── Commission ───────────────────────────────────────────────────────────────

describe("commission scheduling preserves historical bookings", () => {
  it("validates, audits, applies only to new bookings, and never changes existing ones", async () => {
    const old = await confirmedBooking(ids.customerA);
    const snapshot = { guestServiceFeeBps: old.guestServiceFeeBps, hostCommissionBps: old.hostCommissionBps, totalCents: old.totalCents, platformRevenueCents: old.platformRevenueCents, feeScheduleId: old.feeScheduleId };

    await as(ids.admin);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
    expect(await call(createCommissionAction, { name: "Too high", guestServiceFeeBps: "35", hostCommissionBps: "3", effectiveDate: today, reason: "Testing upper bound", confirmed: "on" })).toMatchObject({ ok: false, fieldErrors: { guestServiceFeeBps: expect.any(String) } });
    expect(await call(createCommissionAction, { name: "Backdated", guestServiceFeeBps: "10", hostCommissionBps: "3", effectiveDate: "2020-01-01", reason: "Testing back-dating", confirmed: "on" })).toMatchObject({ ok: false });
    expect(await call(createCommissionAction, { name: "Unconfirmed", guestServiceFeeBps: "10", hostCommissionBps: "3", effectiveDate: today, reason: "Testing confirmation" })).toMatchObject({ ok: false });

    const newRates = { guest: old.guestServiceFeeBps === 1111 ? "11.12" : "11.11", host: old.hostCommissionBps === 222 ? "2.23" : "2.22" };
    const res = await call(createCommissionAction, { name: `P5 schedule ${run}`, guestServiceFeeBps: newRates.guest, hostCommissionBps: newRates.host, effectiveDate: today, reason: "Phase 5 integration test schedule", confirmed: "on" });
    expect(res).toMatchObject({ ok: true });
    const created = await prisma.platformFeeSchedule.findFirstOrThrow({ where: { name: `P5 schedule ${run}` } });
    createdSchedules.push(created.id);
    expect(await prisma.adminAction.count({ where: { targetId: created.id, action: "commission.schedule_created", adminId: ids.admin } })).toBe(1);
    expect((await getActiveFeeSchedule("AU")).id).toBe(created.id);

    const fresh = await confirmedBooking(ids.customerA);
    expect(fresh.feeScheduleId).toBe(created.id);
    expect(fresh.guestServiceFeeBps).toBe(created.guestServiceFeeBps);

    // The earlier booking is untouched and still reconciles against its own snapshot.
    const reread = await reload(old.reference);
    expect({ guestServiceFeeBps: reread.guestServiceFeeBps, hostCommissionBps: reread.hostCommissionBps, totalCents: reread.totalCents, platformRevenueCents: reread.platformRevenueCents, feeScheduleId: reread.feeScheduleId }).toEqual(snapshot);
    expect((await getAdminBooking(old.reference))!.reconciliation.issues).toEqual([]);
  });
});

// ── Accounts ─────────────────────────────────────────────────────────────────

describe("account suspension", () => {
  it("host suspension: signs out, suspends live listings, keeps bookings, blocks new bookings and approvals; reactivation restores as paused", async () => {
    const host = await prisma.user.create({ data: { email: `p5-sushost-${run}@integration.test`, name: "Sam Suspend", role: "HOST", hostProfile: { create: { displayName: "Sam" } } }, include: { hostProfile: true } });
    const live = await property(host.hostProfile!.id, "PUBLISHED", "P5 Suspended Host Live");
    const pending = await property(host.hostProfile!.id, "PENDING_REVIEW", "P5 Suspended Host Pending");
    const kept = await confirmedBooking(ids.customerA, live.id);
    await as(host.id);
    expect(await getCurrentUser()).not.toBeNull();

    expect((await suspendAccount(admin(), { userId: host.id, reason: "Repeated policy breaches", expectedUpdatedAt: new Date(0) })).ok).toBe(false); // stale
    const res = await suspendAccount(admin(), { userId: host.id, reason: "Repeated policy breaches", expectedUpdatedAt: host.updatedAt });
    expect(res).toMatchObject({ ok: true, value: { listingsSuspended: 1, upcomingBookings: 1 } });

    expect(await getCurrentUser()).toBeNull(); // session revoked
    expect(await prisma.session.count({ where: { userId: host.id } })).toBe(0);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("SUSPENDED");
    expect((await reload(kept.reference)).status).toBe("CONFIRMED"); // not cancelled automatically
    expect((await createBookingHold({ id: ids.customerB }, { propertyId: live.id, checkIn: "2027-09-01", checkOut: "2027-09-03", adults: 1, children: 0 })).ok).toBe(false);
    expect(await reviewListing(admin(), pending.id, "approve")).toEqual({ ok: false, error: "host_inactive" });

    const suspended = await prisma.user.findUniqueOrThrow({ where: { id: host.id } });
    expect(await reactivateAccount(admin(), { userId: host.id, reason: "Appeal upheld after review", expectedUpdatedAt: suspended.updatedAt })).toMatchObject({ ok: true, value: { listingsRestored: 1 } });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: live.id } })).status).toBe("PAUSED");
    expect(await prisma.adminAction.count({ where: { targetId: host.id, action: { in: ["host.suspend", "host.reactivate"] } } })).toBe(2);
  });

  it("customer suspension blocks new bookings and keeps history", async () => {
    const cust = await prisma.user.create({ data: { email: `p5-suscust-${run}@integration.test`, name: "Sue Customer", role: "CUSTOMER" } });
    const kept = await confirmedBooking(cust.id);
    await as(cust.id);
    const v = (await prisma.user.findUniqueOrThrow({ where: { id: cust.id } })).updatedAt;
    expect(await suspendAccount(admin(), { userId: cust.id, reason: "Chargeback fraud investigation", expectedUpdatedAt: v })).toMatchObject({ ok: true });
    const fd = form({ propertyId: ids.live, checkIn: "2027-10-01", checkOut: "2027-10-03", adults: "1" });
    expect(await reserveStay({}, fd)).toEqual({ error: "Please log in with a traveller account to book." });
    expect(await prisma.booking.findUnique({ where: { reference: kept.reference } })).not.toBeNull();
  });

  it("can't suspend yourself or another admin", async () => {
    const me = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } });
    expect((await suspendAccount(admin(), { userId: ids.admin, reason: "Self suspension", expectedUpdatedAt: me.updatedAt })).ok).toBe(false);
    const other = await prisma.user.findUniqueOrThrow({ where: { id: ids.admin2 } });
    expect((await suspendAccount(admin(), { userId: ids.admin2, reason: "Admin suspension", expectedUpdatedAt: other.updatedAt })).ok).toBe(false);
  });
});

// ── Reviews, notes, audit, pagination ────────────────────────────────────────

describe("review moderation", () => {
  it("changes visibility only, recomputes public aggregates, and can't fabricate or edit reviews", async () => {
    const p = await property(ids.hostBProfile, "PUBLISHED", "P5 Reviewed Stay");
    const b = await prisma.booking.create({
      data: {
        reference: `ROA-${run.slice(0, 6).toUpperCase().replace(/[^2-9A-HJKMNP-Z]/g, "Q")}`,
        propertyId: p.id,
        guestId: ids.customerA,
        status: "COMPLETED",
        checkIn: new Date("2026-01-01"),
        checkOut: new Date("2026-01-03"),
        nights: 2,
        adults: 2,
        currency: "AUD",
        accommodationCents: 40_000,
        cleaningFeeCents: 8_000,
        guestServiceFeeCents: 4_800,
        totalCents: 52_800,
        hostCommissionCents: 1_200,
        hostPayoutCents: 46_800,
        platformRevenueCents: 6_000,
        guestServiceFeeBps: 1200,
        hostCommissionBps: 300,
        completedAt: new Date("2026-01-03"),
      },
    });
    const body = "Lovely stay but the host was rude about check-out.";
    const review = await prisma.review.create({ data: { bookingId: b.id, propertyId: p.id, authorId: ids.customerA, overallRating: 2, cleanlinessRating: 3, locationRating: 4, valueRating: 2, communicationRating: 1, body, status: "FLAGGED" } });

    expect((await moderateReview(admin(), { reviewId: review.id, decision: "edit", reason: "Rewrite it", expectedUpdatedAt: review.updatedAt })).ok).toBe(false);
    expect((await moderateReview(admin(), { reviewId: review.id, decision: "restore", reason: "Not hidden", expectedUpdatedAt: review.updatedAt })).ok).toBe(false);
    expect(await moderateReview(admin(), { reviewId: review.id, decision: "keep", reason: "Fair, first-hand feedback", expectedUpdatedAt: review.updatedAt })).toMatchObject({ ok: true, value: { status: "PUBLISHED" } });
    expect(await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ reviewCount: 1, ratingAverage: 2 });

    const kept = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(await moderateReview(admin(), { reviewId: review.id, decision: "hide", reason: "Contains a personal dispute", expectedUpdatedAt: kept.updatedAt })).toMatchObject({ ok: true });
    const hidden = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
    expect(hidden).toMatchObject({ status: "HIDDEN", body, overallRating: 2, moderatedById: ids.admin });
    expect(await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ reviewCount: 0, ratingAverage: null });
    // One review per booking is enforced by the database — moderation can't add another.
    await expect(prisma.review.create({ data: { bookingId: b.id, propertyId: p.id, authorId: ids.customerB, overallRating: 5, cleanlinessRating: 5, locationRating: 5, valueRating: 5, communicationRating: 5, body: "Fake 5 stars" } })).rejects.toThrow();
  });
});

describe("notes, audit immutability and pagination", () => {
  it("internal notes are admin-only and append-only", async () => {
    expect((await addAdminNote({ id: ids.hostA, role: "HOST" }, "Property", ids.live, "host trying to add a note")).ok).toBe(false);
    expect((await addAdminNote(admin(), "Property", "does-not-exist", "note")).ok).toBe(false);
    expect((await addAdminNote(admin(), "Payment", ids.live, "note")).ok).toBe(false);
    expect(await addAdminNote(admin(), "Property", ids.live, "Guest complaint about noise — monitor")).toMatchObject({ ok: true });
    const note = await prisma.adminNote.findFirstOrThrow({ where: { targetId: ids.live } });
    await expect(prisma.adminNote.update({ where: { id: note.id }, data: { body: "rewritten" } })).rejects.toThrow();
  });

  it("audit records can't be edited", async () => {
    const entry = await prisma.adminAction.findFirstOrThrow({ where: { adminId: ids.admin } });
    await expect(prisma.adminAction.update({ where: { id: entry.id }, data: { reason: "tampered" } })).rejects.toThrow();
    await expect(prisma.adminAction.updateMany({ where: { adminId: ids.admin }, data: { reason: "tampered" } })).rejects.toThrow();
    expect((await prisma.adminAction.findUniqueOrThrow({ where: { id: entry.id } })).reason).toBe(entry.reason);
  });

  it("lists are paginated on the server", async () => {
    await prisma.user.createMany({ data: Array.from({ length: ADMIN_PAGE_SIZE + 2 }, (_, i) => ({ email: `p5-page-${i}-${run}@integration.test`, name: `Paging ${i}`, role: "CUSTOMER" as const })) });
    const q = `-${run}@integration.test`;
    const page1 = await listCustomers({ q: `p5-page-`, page: 1 });
    expect(page1.rows.length).toBeLessThanOrEqual(ADMIN_PAGE_SIZE);
    const mine = await listCustomers({ q: `page-1-${run}`, page: 1 });
    expect(mine.total).toBeGreaterThanOrEqual(1);
    const all = [...(await listCustomers({ q: run, page: 1 })).rows, ...(await listCustomers({ q: run, page: 2 })).rows];
    expect(all.filter((u) => u.email.endsWith(q) && u.email.startsWith("p5-page-"))).toHaveLength(ADMIN_PAGE_SIZE + 2);
    expect((await listCustomers({ q: run, page: 99 })).rows).toEqual([]);
  });
});
