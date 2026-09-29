/**
 * Phase 3 integration + security tests (real PostgreSQL, isolated fixtures, temp-dir storage).
 * Host A and Host B are separate accounts; every cross-account attempt must fail.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { parseIsoDate, addDays, toIsoDate, todayInTimeZone } from "@/lib/dates";
import { parseSearchParams } from "@/lib/validation/search";
import { createPropertyAction, listingStatusAction, saveHostProfileAction, saveSectionAction, uploadPhotoAction } from "@/server/actions/host";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { LocalDiskStorage, setStorageForTests } from "@/server/storage";
import { setDatesBlocked } from "@/server/services/host-availability";
import { saveCompliance } from "@/server/services/host-compliance";
import { deletePropertyPhoto, movePhoto, updatePhotoAlt, uploadPropertyPhoto } from "@/server/services/host-photos";
import { saveHostProfile } from "@/server/services/host-profile";
import {
  changeListingStatus,
  createPropertyDraft,
  getManagedProperty,
  saveAmenities,
  saveBasics,
  saveDetails,
  saveLocation,
  savePricing,
  saveRules,
} from "@/server/services/host-properties";
import { reviewListing } from "@/server/services/listing-review";
import { getHostPropertyPreview, getPublicProperty } from "@/server/services/properties";
import { searchProperties } from "@/server/services/search";
import { markSectionReviewed } from "@/server/services/host-availability";

const run = randomBytes(4).toString("hex");
type U = { id: string; email: string; name: string; role: "CUSTOMER" | "HOST" | "ADMIN" };
const hostA: U = { id: "", email: `ha-${run}@integration.test`, name: "Harper A", role: "CUSTOMER" };
const hostB: U = { id: "", email: `hb-${run}@integration.test`, name: "Blake B", role: "CUSTOMER" };
const admin: U = { id: "", email: `ad-${run}@integration.test`, name: "Admin Z", role: "ADMIN" };
let destinationId = "";
let storageDir = "";
const asUser = (u: U | null) => vi.mocked(getCurrentUser).mockResolvedValue(u ? { id: u.id, email: u.email, name: u.name, role: u.role } : null);

const PNG = () =>
  new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")], "photo.png", { type: "image/png" });
const form = (fields: Record<string, string | string[] | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
};
const profile = { displayName: "Harper", bio: null, hostType: "INDIVIDUAL" as const, legalName: "Harper Example", businessName: null, abn: null, phone: "0412 345 678" };
const basics = { title: "Cessnock Family House", type: "HOUSE" as const, maxGuests: 6, bedrooms: 3, beds: 4, bathrooms: 2 };
const future = (days: number) => addDays(todayInTimeZone("Australia/Sydney"), days);

/** Build a listing that satisfies every checklist item, as host A. */
async function completeListing(userId: string): Promise<string> {
  const draft = await createPropertyDraft(userId, basics);
  if (!draft.ok) throw new Error(draft.message);
  const id = draft.value.id;
  const must = (r: { ok: boolean; message?: string }) => {
    if (!r.ok) throw new Error(r.message);
  };
  must(await saveLocation(userId, id, { addressLine1: "1 Vincent Street", addressLine2: null, locality: "Cessnock", adminArea: "NSW", postcode: "2325", countryCode: "AU", latitude: null, longitude: null, destinationId }));
  must(await saveDetails(userId, id, { summary: "A roomy family house near the Hunter vineyards.", description: "Three bedrooms, a big kitchen and a garden. ".repeat(3) }));
  must(await saveAmenities(userId, id, { amenities: ["wifi", "parking"] }));
  for (let i = 0; i < 3; i++) must(await uploadPropertyPhoto(userId, id, PNG(), `Photo ${i + 1} of the house`));
  must(await savePricing(userId, id, { nightlyPrice: 25_000, weekendPrice: 29_500, cleaningFee: 8_000, minNights: 2, maxNights: null }));
  must(await markSectionReviewed(userId, id, "availability"));
  must(await saveRules(userId, id, { checkInTime: "15:00", checkOutTime: "10:00", smokingAllowed: false, petsAllowed: false, eventsAllowed: false, quietHoursStart: "22:00", quietHoursEnd: "07:00", houseRules: null, cancellationPolicy: "MODERATE" }));
  must(
    await saveCompliance(userId, id, {
      registrationNumber: "PID-STRA-12345",
      registrationExpiry: null,
      exemptionDeclared: false,
      exemptionReason: null,
      ownershipStatus: "OWNER",
      authorityConfirmed: true,
      insuranceConfirmed: true,
      insurerName: null,
      obligationsAcknowledged: true,
      planningAcknowledged: true,
      strataScheme: "NO",
      strataPermissionConfirmed: false,
    }),
  );
  return id;
}

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "roavela-test-"));
  setStorageForTests(new LocalDiskStorage(storageDir));
  for (const [key, label] of [["wifi", "Wi-Fi"], ["parking", "Free parking"], ["pet_friendly", "Pet friendly"]] as const) {
    await prisma.amenity.upsert({ where: { key }, create: { key, label, category: "ESSENTIALS" }, update: {} });
  }
  destinationId = (await prisma.destination.create({ data: { slug: `p3-dest-${run}`, name: "P3 Region", kind: "REGION", countryCode: "AU", adminArea: "NSW", latitude: -32.83, longitude: 151.35, timezone: "Australia/Sydney", isPublished: true } })).id;
  for (const u of [hostA, hostB, admin]) u.id = (await prisma.user.create({ data: { email: u.email, name: u.name, role: u.role } })).id;
});

afterAll(async () => {
  setStorageForTests(undefined);
  const ids = [hostA.id, hostB.id, admin.id];
  const props = await prisma.property.findMany({ where: { host: { userId: { in: ids } } }, select: { id: true } });
  const pids = props.map((p) => p.id);
  await prisma.booking.deleteMany({ where: { propertyId: { in: pids } } });
  await prisma.complianceDocument.deleteMany({ where: { propertyId: { in: pids } } });
  await prisma.property.deleteMany({ where: { id: { in: pids } } });
  await prisma.adminAction.deleteMany({ where: { adminId: { in: ids } } });
  await prisma.hostProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.destination.deleteMany({ where: { id: destinationId } });
  await rm(storageDir, { recursive: true, force: true });
  await prisma.$disconnect();
});

beforeEach(() => asUser(null));

describe("becoming a host", () => {
  it("upgrades the same customer account to HOST with a profile — and ignores a forged ADMIN role", async () => {
    asUser(hostA);
    const fd = form({ ...profile, bio: "", businessName: "", abn: "", role: "ADMIN", userId: hostB.id, then: "" } as unknown as Record<string, string>);
    await expect(saveHostProfileAction({}, fd)).rejects.toThrow(/NEXT_REDIRECT/); // → /host/properties/new
    const user = await prisma.user.findUniqueOrThrow({ where: { id: hostA.id }, include: { hostProfile: true } });
    expect(user.role).toBe("HOST");
    expect(user.hostProfile?.legalName).toBe("Harper Example");
    expect(await prisma.user.count({ where: { email: hostA.email } })).toBe(1);
    expect(await prisma.hostProfile.count({ where: { userId: hostB.id } })).toBe(0);
    hostA.role = "HOST";

    expect((await saveHostProfile({ id: hostB.id, role: "CUSTOMER" }, { ...profile, displayName: "Blake", legalName: "Blake Example" })).ok).toBe(true);
    hostB.role = "HOST";
  });

  it("does not let an admin become a host", async () => {
    const r = await saveHostProfile({ id: admin.id, role: "ADMIN" }, profile);
    expect(r.ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });
});

describe("drafts, sections and data integrity", () => {
  it("creates a private draft owned by the session host, ignoring a forged hostId", async () => {
    asUser(hostA);
    const hostBProfile = await prisma.hostProfile.findUniqueOrThrow({ where: { userId: hostB.id } });
    const fd = form({ title: "Forged Owner Cottage", type: "COTTAGE", maxGuests: "4", bedrooms: "2", beds: "2", bathrooms: "1", hostId: hostBProfile.id, status: "PUBLISHED" });
    await expect(createPropertyAction({}, fd)).rejects.toThrow(/NEXT_REDIRECT/);
    const created = await prisma.property.findFirstOrThrow({ where: { title: "Forged Owner Cottage" }, include: { host: true } });
    expect(created.host.userId).toBe(hostA.id);
    expect(created.status).toBe("DRAFT");
    expect(await getPublicProperty(created.slug)).toBeNull();
  });

  it("stores money as integer cents and rejects manipulated prices", async () => {
    asUser(hostA);
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const id = draft.value.id;
    const save = (fields: Record<string, string>) => saveSectionAction({}, form({ propertyId: id, section: "pricing", ...fields }));
    const ok = await save({ nightlyPrice: "250", weekendPrice: "295.50", cleaningFee: "80", minNights: "2", maxNights: "", nightlyPriceCents: "1" });
    expect(ok.ok).toBe(true);
    const p = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect([p.nightlyPriceCents, p.weekendPriceCents, p.cleaningFeeCents]).toEqual([25_000, 29_550, 8_000]);

    for (const bad of ["-250", "0", "250.999", "1e9", "99999999", "abc"]) {
      const r = await save({ nightlyPrice: bad, weekendPrice: "", cleaningFee: "", minNights: "1", maxNights: "" });
      expect(r.ok, bad).toBe(false);
    }
    expect((await prisma.property.findUniqueOrThrow({ where: { id } })).nightlyPriceCents).toBe(25_000);
  });

  it("assigns amenities without duplicates and replaces the set", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const id = draft.value.id;
    await saveAmenities(hostA.id, id, { amenities: ["wifi", "wifi", "parking"] });
    expect(await prisma.propertyAmenity.count({ where: { propertyId: id } })).toBe(2);
    await saveAmenities(hostA.id, id, { amenities: ["wifi"] });
    expect(await prisma.propertyAmenity.count({ where: { propertyId: id } })).toBe(1);
    await expect(prisma.propertyAmenity.create({ data: { propertyId: id, amenityId: (await prisma.amenity.findUniqueOrThrow({ where: { key: "wifi" } })).id } })).rejects.toThrow();
  });

  it("keeps the pets rule and the pet-friendly amenity in sync", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const rules = { checkInTime: "15:00", checkOutTime: "10:00", smokingAllowed: false, eventsAllowed: false, quietHoursStart: null, quietHoursEnd: null, houseRules: null, cancellationPolicy: "FLEXIBLE" as const };
    await saveRules(hostA.id, draft.value.id, { ...rules, petsAllowed: true });
    expect(await prisma.propertyAmenity.count({ where: { propertyId: draft.value.id, amenity: { key: "pet_friendly" } } })).toBe(1);
    await saveRules(hostA.id, draft.value.id, { ...rules, petsAllowed: false });
    expect(await prisma.propertyAmenity.count({ where: { propertyId: draft.value.id, amenity: { key: "pet_friendly" } } })).toBe(0);
  });

  it("the database refuses to publish an incomplete listing, even bypassing the app", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    await expect(prisma.property.update({ where: { id: draft.value.id }, data: { status: "PUBLISHED" } })).rejects.toThrow(/Property_listable_complete_check/);
  });
});

describe("photos", () => {
  it("uploads, strips metadata, reorders, sets cover and deletes", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const id = draft.value.id;
    const a = await uploadPropertyPhoto(hostA.id, id, PNG(), "Front");
    const b = await uploadPropertyPhoto(hostA.id, id, PNG(), "Kitchen");
    if (!a.ok || !b.ok) throw new Error("upload");
    expect(a.value.url).toMatch(/^\/media\/properties\//);

    await movePhoto(hostA.id, b.value.id, "cover");
    const order = await prisma.propertyImage.findMany({ where: { propertyId: id }, orderBy: { position: "asc" }, select: { id: true } });
    expect(order.map((o) => o.id)).toEqual([b.value.id, a.value.id]);

    expect((await updatePhotoAlt(hostA.id, a.value.id, "Front of the house")).ok).toBe(true);
    expect((await deletePropertyPhoto(hostA.id, a.value.id)).ok).toBe(true);
    expect(await prisma.propertyImage.count({ where: { propertyId: id } })).toBe(1);
  });

  it("rejects disguised and oversized files, and enforces the photo limit", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const id = draft.value.id;
    const html = new File(["<html><script>alert(1)</script></html>"], "cute.jpg", { type: "image/jpeg" });
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], "x.svg", { type: "image/svg+xml" });
    const big = new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    for (const f of [html, svg, big]) expect((await uploadPropertyPhoto(hostA.id, id, f)).ok, f.name).toBe(false);
    expect(await prisma.propertyImage.count({ where: { propertyId: id } })).toBe(0);

    await prisma.propertyImage.createMany({ data: Array.from({ length: 24 }, (_, i) => ({ propertyId: id, url: `/demo/scenes/cabin.svg`, alt: "x", position: i })) });
    const over = await uploadPropertyPhoto(hostA.id, id, PNG());
    expect(over).toMatchObject({ ok: false, error: "limit" });
  });
});

describe("availability", () => {
  it("blocks and unblocks dates, merging ranges", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const id = draft.value.id;
    expect((await setDatesBlocked(hostA.id, id, { start: future(10), end: future(14) }, true)).ok).toBe(true);
    expect((await setDatesBlocked(hostA.id, id, { start: future(14), end: future(16) }, true)).ok).toBe(true);
    let blocks = await prisma.blockedDate.findMany({ where: { propertyId: id }, orderBy: { startDate: "asc" } });
    expect(blocks.map((b) => [toIsoDate(b.startDate), toIsoDate(b.endDate)])).toEqual([[toIsoDate(future(10)), toIsoDate(future(16))]]);
    await setDatesBlocked(hostA.id, id, { start: future(12), end: future(13) }, false);
    blocks = await prisma.blockedDate.findMany({ where: { propertyId: id }, orderBy: { startDate: "asc" } });
    expect(blocks).toHaveLength(2);
  });

  it("rejects past dates, far-future dates and blocks over active bookings", async () => {
    const id = await completeListing(hostA.id);
    expect((await setDatesBlocked(hostA.id, id, { start: future(-3), end: future(-1) }, true)).ok).toBe(false);
    expect((await setDatesBlocked(hostA.id, id, { start: future(800), end: future(802) }, true)).ok).toBe(false);
    await prisma.booking.create({
      data: {
        reference: `RV-P3-${run}`, propertyId: id, guestId: hostB.id, status: "CONFIRMED", checkIn: future(30), checkOut: future(32), nights: 2, adults: 2, currency: "AUD",
        accommodationCents: 1, cleaningFeeCents: 0, guestServiceFeeCents: 0, totalCents: 1, hostCommissionCents: 0, hostPayoutCents: 1, platformRevenueCents: 0, guestServiceFeeBps: 600, hostCommissionBps: 400,
      },
    });
    expect((await setDatesBlocked(hostA.id, id, { start: future(31), end: future(33) }, true))).toMatchObject({ ok: false, error: "conflict" });
    // …and an archive with an upcoming booking is refused.
    expect(await changeListingStatus(hostA.id, id, "archive")).toMatchObject({ ok: false });
  });

  it("rejects an end date before the start date at validation", async () => {
    asUser(hostA);
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const { availabilityAction } = await import("@/server/actions/host");
    const r = await availabilityAction({}, form({ propertyId: draft.value.id, mode: "block", start: toIsoDate(future(10)), end: toIsoDate(future(8)) }));
    expect(r.ok).toBe(false);
  });
});

describe("submission, review and lifecycle", () => {
  it("won't submit an incomplete listing", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    const r = await changeListingStatus(hostA.id, draft.value.id, "submit");
    expect(r).toMatchObject({ ok: false, error: "invalid" });
    expect((await prisma.property.findUniqueOrThrow({ where: { id: draft.value.id } })).status).toBe("DRAFT");
  });

  it("submits a complete listing for review without publishing it, and admins decide", async () => {
    const id = await completeListing(hostA.id);
    expect(await changeListingStatus(hostA.id, id, "submit")).toEqual({ ok: true, value: { status: "PENDING_REVIEW" } });
    const p = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe("PENDING_REVIEW");
    expect(await getPublicProperty(p.slug)).toBeNull();
    const search = await searchProperties(parseSearchParams({ destination: `p3-dest-${run}`, adults: "1" }), { pageSize: 50 });
    expect(search.results.map((r) => r.id)).not.toContain(id);

    // Editing is locked while under review.
    expect(await saveDetails(hostA.id, id, { summary: "Changed summary during review!!", description: "x".repeat(90) })).toMatchObject({ ok: false, error: "not_editable" });

    // Hosts cannot approve — not through the review service, not through the status action.
    expect(await reviewListing({ id: hostA.id, role: "HOST" }, id, "approve")).toEqual({ ok: false, error: "forbidden" });
    asUser(hostA);
    expect((await listingStatusAction({}, form({ propertyId: id, intent: "approve" }))).ok).toBe(false);
    expect((await listingStatusAction({}, form({ propertyId: id, intent: "resume", status: "PUBLISHED" }))).ok).toBe(false);
    expect((await prisma.property.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_REVIEW");

    // Admin requests changes → host edits → resubmits → admin approves.
    expect(await reviewListing({ id: admin.id, role: "ADMIN" }, id, "request_changes")).toEqual({ ok: false, error: "reason_required" });
    expect(await reviewListing({ id: admin.id, role: "ADMIN" }, id, "request_changes", "Please add a photo of the bathroom.")).toEqual({ ok: true, status: "CHANGES_REQUESTED" });
    expect((await prisma.property.findUniqueOrThrow({ where: { id } })).rejectionReason).toBe("Please add a photo of the bathroom.");
    expect((await uploadPropertyPhoto(hostA.id, id, PNG(), "Bathroom")).ok).toBe(true);
    expect((await changeListingStatus(hostA.id, id, "submit")).ok).toBe(true);
    expect(await reviewListing({ id: admin.id, role: "ADMIN" }, id, "approve")).toEqual({ ok: true, status: "PUBLISHED" });
    const log = await prisma.adminAction.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["property.request_changes", "property.approve"]);
    expect(log[0]).toMatchObject({ adminId: admin.id, reason: "Please add a photo of the bathroom." });

    const live = await getPublicProperty(p.slug);
    expect(live?.title).toBe(basics.title);
    expect(live).not.toHaveProperty("addressLine1");

    // Pause hides it; resume restores it; host can't archive while live.
    expect((await changeListingStatus(hostA.id, id, "pause")).ok).toBe(true);
    expect(await getPublicProperty(p.slug)).toBeNull();
    expect((await saveDetails(hostA.id, id, { summary: "Updated summary while paused, still fine.", description: "y".repeat(90) })).ok).toBe(true);
    expect((await changeListingStatus(hostA.id, id, "resume")).ok).toBe(true);
    expect(await getPublicProperty(p.slug)).not.toBeNull();
    expect(await changeListingStatus(hostA.id, id, "archive")).toMatchObject({ ok: false, error: "conflict" });

    // Host audit trail
    const audit = await prisma.auditLog.findMany({ where: { targetId: id } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["property.created", "compliance.submitted", "property.submitted", "property.paused", "property.resumed", "property.edited_after_review"]));
  });

  it("archives drafts and then locks them", async () => {
    const draft = await createPropertyDraft(hostA.id, basics);
    if (!draft.ok) throw new Error("draft");
    expect(await changeListingStatus(hostA.id, draft.value.id, "archive")).toEqual({ ok: true, value: { status: "ARCHIVED" } });
    expect(await saveBasics(hostA.id, draft.value.id, basics)).toMatchObject({ ok: false, error: "not_editable" });
    expect(await changeListingStatus(hostA.id, draft.value.id, "submit")).toMatchObject({ ok: false, error: "conflict" });
  });

  it("stores compliance as SUBMITTED and resets it on edit after an admin approval", async () => {
    const id = await completeListing(hostA.id);
    const docs = await prisma.complianceDocument.findMany({ where: { propertyId: id } });
    expect(docs.map((d) => d.type).sort()).toEqual(["AUTHORITY_TO_LIST", "INSURANCE", "LOCAL_COMPLIANCE_ACKNOWLEDGEMENT", "SHORT_TERM_RENTAL_REGISTRATION"]);
    expect(docs.every((d) => d.status === "SUBMITTED" && d.jurisdiction === "AU-NSW")).toBe(true);

    await prisma.complianceDocument.updateMany({ where: { propertyId: id }, data: { status: "APPROVED" } });
    await saveCompliance(hostA.id, id, {
      registrationNumber: "PID-STRA-99999", registrationExpiry: null, exemptionDeclared: false, exemptionReason: null, ownershipStatus: "OWNER",
      authorityConfirmed: true, insuranceConfirmed: true, insurerName: null, obligationsAcknowledged: true, planningAcknowledged: true, strataScheme: "NO", strataPermissionConfirmed: false,
    });
    expect(await prisma.complianceDocument.count({ where: { propertyId: id, status: "APPROVED" } })).toBe(0);
    expect(await prisma.complianceDocument.count({ where: { propertyId: id } })).toBe(4); // upserted, not duplicated

    const expired = await saveCompliance(hostA.id, id, {
      registrationNumber: "PID-STRA-1", registrationExpiry: parseIsoDate("2020-01-01"), exemptionDeclared: false, exemptionReason: null, ownershipStatus: "OWNER",
      authorityConfirmed: true, insuranceConfirmed: true, insurerName: null, obligationsAcknowledged: true, planningAcknowledged: true, strataScheme: "NO", strataPermissionConfirmed: false,
    });
    expect(expired.ok).toBe(false);
  });
});

describe("IDOR: host B against host A's listing", () => {
  it("cannot read, edit, upload, reorder, delete, change dates or status on another host's property", async () => {
    const id = await completeListing(hostA.id);
    const photo = await prisma.propertyImage.findFirstOrThrow({ where: { propertyId: id } });
    const before = await prisma.property.findUniqueOrThrow({ where: { id } });

    expect(await getManagedProperty(hostB.id, id)).toBeNull();
    expect(await getHostPropertyPreview(id, hostB.id)).toBeNull();
    const nf = { ok: false, error: "not_found" };
    expect(await saveBasics(hostB.id, id, { ...basics, title: "Hijacked listing title" })).toMatchObject(nf);
    expect(await savePricing(hostB.id, id, { nightlyPrice: 2_000, weekendPrice: null, cleaningFee: 0, minNights: 1, maxNights: null })).toMatchObject(nf);
    expect(await saveAmenities(hostB.id, id, { amenities: [] })).toMatchObject(nf);
    expect(await uploadPropertyPhoto(hostB.id, id, PNG())).toMatchObject(nf);
    expect(await deletePropertyPhoto(hostB.id, photo.id)).toMatchObject(nf);
    expect(await movePhoto(hostB.id, photo.id, "cover")).toMatchObject(nf);
    expect(await updatePhotoAlt(hostB.id, photo.id, "defaced")).toMatchObject(nf);
    expect(await setDatesBlocked(hostB.id, id, { start: future(5), end: future(7) }, true)).toMatchObject(nf);
    expect(await changeListingStatus(hostB.id, id, "submit")).toMatchObject(nf);
    expect(await changeListingStatus(hostB.id, id, "archive")).toMatchObject(nf);

    // Same attempts through the Server Actions, as a signed-in host B.
    asUser(hostB);
    expect((await saveSectionAction({}, form({ propertyId: id, section: "details", summary: "Hijacked summary text here", description: "z".repeat(90) }))).ok).toBe(false);
    expect((await uploadPhotoAction({}, form({ propertyId: id, photo: PNG() }))).ok).toBe(false);
    expect((await listingStatusAction({}, form({ propertyId: id, intent: "submit" }))).ok).toBe(false);

    const after = await prisma.property.findUniqueOrThrow({ where: { id } });
    expect(after.title).toBe(before.title);
    expect(after.nightlyPriceCents).toBe(before.nightlyPriceCents);
    expect(after.status).toBe(before.status);
    expect(await prisma.propertyImage.count({ where: { propertyId: id } })).toBe(3);
    expect(await prisma.blockedDate.count({ where: { propertyId: id } })).toBe(0);
  });

  it("rejects host actions from signed-out users and customers", async () => {
    const id = await completeListing(hostA.id);
    asUser(null);
    expect((await saveSectionAction({}, form({ propertyId: id, section: "details", summary: "x".repeat(30), description: "x".repeat(90) }))).message).toMatch(/session/i);
    const customer = await prisma.user.create({ data: { email: `c-${run}@integration.test`, name: "Cust" } });
    asUser({ id: customer.id, email: customer.email, name: customer.name, role: "CUSTOMER" });
    expect((await listingStatusAction({}, form({ propertyId: id, intent: "submit" }))).ok).toBe(false);
    await prisma.user.delete({ where: { id: customer.id } });
  });
});
