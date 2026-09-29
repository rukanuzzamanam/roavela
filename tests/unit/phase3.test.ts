import { describe, expect, it } from "vitest";
import { blockRange, nightsInRanges, unblockRange } from "@/lib/date-ranges";
import { parseIsoDate } from "@/lib/dates";
import { checkImage, detectDocumentType, detectImageType, stripImageMetadata } from "@/lib/image-files";
import { evaluateChecklist, MIN_PHOTOS, type ListingSnapshot } from "@/lib/listing-checklist";
import { availableHostIntents, canHostEdit, transition } from "@/lib/listing-lifecycle";
import { basicsSchema, complianceSchema, isValidAbn, locationSchema, parseMoneyToCents, pricingSchema, rulesSchema } from "@/lib/validation/host";

const d = parseIsoDate;

describe("listing lifecycle", () => {
  it("lets hosts submit, withdraw, pause, resume and archive only from the right states", () => {
    expect(transition("submit", "host", "DRAFT")).toEqual({ ok: true, to: "PENDING_REVIEW" });
    expect(transition("submit", "host", "CHANGES_REQUESTED")).toEqual({ ok: true, to: "PENDING_REVIEW" });
    expect(transition("withdraw", "host", "PENDING_REVIEW")).toEqual({ ok: true, to: "DRAFT" });
    expect(transition("pause", "host", "PUBLISHED")).toEqual({ ok: true, to: "PAUSED" });
    expect(transition("resume", "host", "PAUSED")).toEqual({ ok: true, to: "PUBLISHED" });
    expect(transition("archive", "host", "DRAFT")).toEqual({ ok: true, to: "ARCHIVED" });
    expect(transition("submit", "host", "PUBLISHED").ok).toBe(false);
    expect(transition("archive", "host", "PUBLISHED").ok).toBe(false); // pause first
    expect(transition("archive", "host", "PENDING_REVIEW").ok).toBe(false);
  });

  it("never lets a host approve, publish without approval, or suspend", () => {
    for (const intent of ["approve", "request_changes", "reject", "suspend", "reinstate"] as const) {
      for (const from of ["DRAFT", "PENDING_REVIEW", "PUBLISHED", "PAUSED", "SUSPENDED"] as const) {
        expect(transition(intent, "host", from)).toEqual({ ok: false, reason: "wrong_actor" });
      }
    }
    // The only host path to PUBLISHED is resuming an already-approved, paused listing.
    expect(transition("resume", "host", "DRAFT").ok).toBe(false);
    expect(transition("resume", "host", "PENDING_REVIEW").ok).toBe(false);
    expect(transition("resume", "host", "REJECTED").ok).toBe(false);
    expect(transition("resume", "host", "SUSPENDED").ok).toBe(false);
  });

  it("gives admins the review decisions", () => {
    expect(transition("approve", "admin", "PENDING_REVIEW")).toEqual({ ok: true, to: "PUBLISHED" });
    expect(transition("request_changes", "admin", "PENDING_REVIEW")).toEqual({ ok: true, to: "CHANGES_REQUESTED" });
    expect(transition("reject", "admin", "PENDING_REVIEW")).toEqual({ ok: true, to: "REJECTED" });
    expect(transition("approve", "admin", "DRAFT").ok).toBe(false);
    expect(transition("submit", "admin", "DRAFT")).toEqual({ ok: false, reason: "wrong_actor" });
  });

  it("locks editing while under review and after archive/suspension", () => {
    expect(canHostEdit("DRAFT")).toBe(true);
    expect(canHostEdit("PUBLISHED")).toBe(true);
    expect(canHostEdit("PENDING_REVIEW")).toBe(false);
    expect(canHostEdit("ARCHIVED")).toBe(false);
    expect(canHostEdit("SUSPENDED")).toBe(false);
    expect(canHostEdit("REJECTED")).toBe(false);
    expect(availableHostIntents("PENDING_REVIEW")).toEqual(["withdraw"]);
    expect(availableHostIntents("ARCHIVED")).toEqual([]);
  });
});

const complete: ListingSnapshot = {
  title: "Cessnock Family House",
  maxGuests: 6,
  bedrooms: 3,
  beds: 4,
  bathrooms: 2,
  summary: "A roomy three-bedroom house close to the vineyards.",
  description: "A".repeat(100),
  addressLine1: "1 Example Street",
  locality: "Cessnock",
  adminArea: "NSW",
  postcode: "2325",
  countryCode: "AU",
  destinationId: "dest_1",
  amenityCount: 5,
  photoCount: MIN_PHOTOS,
  photosMissingAlt: 0,
  nightlyPriceCents: 25_000,
  completedSections: ["basics", "location", "details", "amenities", "photos", "pricing", "availability", "rules", "compliance"],
  compliance: {
    SHORT_TERM_RENTAL_REGISTRATION: { referenceNumber: "PID-STRA-12345", data: { exemptionDeclared: false } },
    LOCAL_COMPLIANCE_ACKNOWLEDGEMENT: { referenceNumber: null, data: { obligationsAcknowledged: true, planningAcknowledged: true, strataAnswered: true } },
    INSURANCE: { referenceNumber: null, data: { confirmed: true } },
    AUTHORITY_TO_LIST: { referenceNumber: null, data: { confirmed: true } },
  },
  hostProfileComplete: true,
};

describe("submission checklist", () => {
  it("accepts a complete NSW listing", () => {
    const r = evaluateChecklist(complete);
    expect(r.complete).toBe(true);
    expect(r.percent).toBe(100);
  });

  it("reports what's missing, section by section", () => {
    const r = evaluateChecklist({ ...complete, description: "short", photoCount: 1, nightlyPriceCents: null, completedSections: ["basics"], compliance: {} });
    const incomplete = r.sections.filter((s) => !s.complete).map((s) => s.key);
    expect(incomplete).toEqual(["details", "photos", "pricing", "availability", "rules", "compliance"]);
    expect(r.complete).toBe(false);
  });

  it("requires an NSW STRA number unless an exemption is declared", () => {
    const noReg = { ...complete, compliance: { ...complete.compliance, SHORT_TERM_RENTAL_REGISTRATION: undefined } };
    expect(evaluateChecklist(noReg).complete).toBe(false);
    const exempt = { ...complete, compliance: { ...complete.compliance, SHORT_TERM_RENTAL_REGISTRATION: { referenceNumber: null, data: { exemptionDeclared: true } } } };
    expect(evaluateChecklist(exempt).complete).toBe(true);
  });

  it("does not require a registration number where the jurisdiction doesn't", () => {
    const vic = { ...complete, adminArea: "VIC", compliance: { ...complete.compliance, SHORT_TERM_RENTAL_REGISTRATION: undefined } };
    expect(evaluateChecklist(vic).complete).toBe(true);
  });

  it("requires photo descriptions and a complete host profile", () => {
    expect(evaluateChecklist({ ...complete, photosMissingAlt: 1 }).complete).toBe(false);
    const r = evaluateChecklist({ ...complete, hostProfileComplete: false });
    expect(r.complete).toBe(false);
    expect(r.hostIssues).toHaveLength(1);
  });
});

describe("money & pricing validation", () => {
  it("parses dollars to integer cents without floating point", () => {
    expect(parseMoneyToCents("250")).toBe(25_000);
    expect(parseMoneyToCents("$249.50")).toBe(24_950);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("1,250")).toBe(125_000);
    for (const bad of ["-5", "250.555", "1e3", "abc", "", "12.", ".5"]) expect(parseMoneyToCents(bad)).toBeNull();
  });

  it("validates pricing ranges and stay lengths", () => {
    const ok = pricingSchema.parse({ nightlyPrice: "250", weekendPrice: "295", cleaningFee: "80", minNights: "2", maxNights: "" });
    expect(ok).toEqual({ nightlyPrice: 25_000, weekendPrice: 29_500, cleaningFee: 8_000, minNights: 2, maxNights: null });
    expect(pricingSchema.safeParse({ nightlyPrice: "5", weekendPrice: "", cleaningFee: "", minNights: "1", maxNights: "" }).success).toBe(false);
    expect(pricingSchema.safeParse({ nightlyPrice: "999999", weekendPrice: "", cleaningFee: "", minNights: "1", maxNights: "" }).success).toBe(false);
    expect(pricingSchema.safeParse({ nightlyPrice: "250", weekendPrice: "", cleaningFee: "", minNights: "5", maxNights: "3" }).success).toBe(false);
    expect(pricingSchema.safeParse({ nightlyPrice: "", weekendPrice: "", cleaningFee: "", minNights: "1", maxNights: "" }).success).toBe(false);
  });
});

describe("other host validation", () => {
  it("checks ABNs with the official checksum", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true); // ATO's published example
    expect(isValidAbn("51 824 753 557")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
  });

  it("validates basics", () => {
    expect(basicsSchema.safeParse({ title: "Cessnock house", type: "HOUSE", maxGuests: "6", bedrooms: "3", beds: "4", bathrooms: "1.5" }).success).toBe(true);
    expect(basicsSchema.safeParse({ title: "Cessnock house", type: "HOUSE", maxGuests: "6", bedrooms: "3", beds: "4", bathrooms: "1.3" }).success).toBe(false);
    expect(basicsSchema.safeParse({ title: "Cessnock house", type: "CASTLE", maxGuests: "6", bedrooms: "3", beds: "4", bathrooms: "1" }).success).toBe(false);
    expect(basicsSchema.safeParse({ title: "Short", type: "HOUSE", maxGuests: "6", bedrooms: "3", beds: "4", bathrooms: "1" }).success).toBe(false);
  });

  it("requires both coordinates or neither, and Australian location fields", () => {
    const base = { addressLine1: "1 Vincent St", addressLine2: "", locality: "Cessnock", adminArea: "NSW", postcode: "2325", countryCode: "AU", destinationId: "d1" };
    expect(locationSchema.safeParse({ ...base, latitude: "", longitude: "" }).success).toBe(true);
    expect(locationSchema.safeParse({ ...base, latitude: "-32.83", longitude: "" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...base, latitude: "-132", longitude: "151" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...base, postcode: "232", latitude: "", longitude: "" }).success).toBe(false);
    expect(locationSchema.safeParse({ ...base, adminArea: "XX", latitude: "", longitude: "" }).success).toBe(false);
  });

  it("validates house rules", () => {
    const base = { checkInTime: "15:00", checkOutTime: "10:00", houseRules: "", cancellationPolicy: "MODERATE" };
    const r = rulesSchema.parse({ ...base, petsAllowed: "on", quietHoursStart: "22:00", quietHoursEnd: "07:00" });
    expect(r).toMatchObject({ petsAllowed: true, smokingAllowed: false, eventsAllowed: false });
    expect(rulesSchema.safeParse({ ...base, quietHoursStart: "22:00", quietHoursEnd: "" }).success).toBe(false);
    expect(rulesSchema.safeParse({ ...base, checkInTime: "3pm", quietHoursStart: "", quietHoursEnd: "" }).success).toBe(false);
  });

  it("requires compliance acknowledgements, exemption reasons and strata permission", () => {
    const base = {
      registrationNumber: "PID-STRA-12345",
      registrationExpiry: "",
      exemptionReason: "",
      ownershipStatus: "OWNER",
      insurerName: "",
      strataScheme: "NO",
      authorityConfirmed: "on",
      insuranceConfirmed: "on",
      obligationsAcknowledged: "on",
      planningAcknowledged: "on",
    };
    expect(complianceSchema.safeParse(base).success).toBe(true);
    expect(complianceSchema.safeParse({ ...base, insuranceConfirmed: undefined }).success).toBe(false);
    expect(complianceSchema.safeParse({ ...base, exemptionDeclared: "on" }).success).toBe(false);
    expect(complianceSchema.safeParse({ ...base, strataScheme: "YES" }).success).toBe(false);
    expect(complianceSchema.safeParse({ ...base, strataScheme: "YES", strataPermissionConfirmed: "on" }).success).toBe(true);
    expect(complianceSchema.safeParse({ ...base, registrationNumber: "<script>" }).success).toBe(false);
  });
});

describe("blocked date ranges", () => {
  it("merges overlapping and adjacent blocks", () => {
    const r = blockRange([{ start: d("2027-01-01"), end: d("2027-01-05") }], { start: d("2027-01-05"), end: d("2027-01-08") });
    expect(r).toEqual([{ start: d("2027-01-01"), end: d("2027-01-08") }]);
    expect(nightsInRanges(r)).toBe(7);
  });

  it("splits a block when unblocking the middle", () => {
    const r = unblockRange([{ start: d("2027-01-01"), end: d("2027-01-10") }], { start: d("2027-01-04"), end: d("2027-01-06") });
    expect(r).toEqual([
      { start: d("2027-01-01"), end: d("2027-01-04") },
      { start: d("2027-01-06"), end: d("2027-01-10") },
    ]);
  });

  it("is a no-op when unblocking open dates", () => {
    const ranges = [{ start: d("2027-02-01"), end: d("2027-02-03") }];
    expect(unblockRange(ranges, { start: d("2027-03-01"), end: d("2027-03-05") })).toEqual(ranges);
  });
});

// ── Image safety ──
const PNG_1PX = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

function pngWithExif(): Uint8Array {
  const payload = Buffer.from("GPS:-32.8341,151.3556");
  const chunk = Buffer.alloc(12 + payload.length);
  chunk.writeUInt32BE(payload.length, 0);
  chunk.write("eXIf", 4, "ascii");
  payload.copy(chunk, 8);
  // CRC isn't validated by our stripper; zeros are fine for this test.
  const b = Buffer.from(PNG_1PX);
  return Uint8Array.from(Buffer.concat([b.subarray(0, 33), chunk, b.subarray(33)]));
}

function jpegWithExif(): Uint8Array {
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0x00, 0x10]), Buffer.from("Exif\0\0GPS-DATA")]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]);
  return Uint8Array.from(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, exif, sos]));
}

function webpWithExif(): Uint8Array {
  const vp8x = Buffer.alloc(18);
  vp8x.write("VP8X", 0, "ascii");
  vp8x.writeUInt32LE(10, 4);
  vp8x[8] = 0x08; // EXIF flag
  const exifPayload = Buffer.from("GPSDATA!");
  const exif = Buffer.alloc(8 + exifPayload.length);
  exif.write("EXIF", 0, "ascii");
  exif.writeUInt32LE(exifPayload.length, 4);
  exifPayload.copy(exif, 8);
  const img = Buffer.alloc(12);
  img.write("VP8L", 0, "ascii");
  img.writeUInt32LE(4, 4);
  const body = Buffer.concat([vp8x, exif, img]);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WEBP", 8, "ascii");
  return Uint8Array.from(Buffer.concat([header, body]));
}

describe("image upload safety", () => {
  it("detects types by content, not by name", () => {
    expect(detectImageType(PNG_1PX)).toBe("image/png");
    expect(detectImageType(jpegWithExif())).toBe("image/jpeg");
    expect(detectImageType(webpWithExif())).toBe("image/webp");
    expect(detectImageType(Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))).toBeNull();
    expect(detectImageType(Uint8Array.from(Buffer.from("<html><script>alert(1)</script></html>")))).toBeNull();
    expect(detectDocumentType(Uint8Array.from(Buffer.from("%PDF-1.7\n...")))).toBe("application/pdf");
  });

  it("rejects empty, oversized and unsupported files", () => {
    expect(checkImage(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    expect(checkImage(PNG_1PX, 10)).toEqual({ ok: false, error: "too_large" });
    expect(checkImage(Uint8Array.from(Buffer.from("GIF89a..........")))).toEqual({ ok: false, error: "unsupported_type" });
  });

  it("strips location metadata from JPEG, PNG and WebP", () => {
    const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(s);
    const jpeg = stripImageMetadata(jpegWithExif(), "image/jpeg");
    expect(has(jpegWithExif(), "GPS")).toBe(true);
    expect(has(jpeg, "GPS")).toBe(false);
    expect(detectImageType(jpeg)).toBe("image/jpeg");

    const png = stripImageMetadata(pngWithExif(), "image/png");
    expect(has(png, "GPS")).toBe(false);
    expect(Buffer.from(png).equals(Buffer.from(PNG_1PX))).toBe(true);

    const webp = stripImageMetadata(webpWithExif(), "image/webp");
    expect(has(webp, "GPSDATA")).toBe(false);
    expect(webp[20]! & 0x08).toBe(0); // VP8X EXIF flag cleared
    expect(Buffer.from(webp).readUInt32LE(4)).toBe(webp.length - 8); // RIFF size fixed
  });
});
