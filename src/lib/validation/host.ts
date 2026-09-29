import { z } from "zod";
import { AMENITY_KEYS } from "@/config/amenities";
import { AU_STATES } from "@/config/jurisdictions";
import { isIsoDate, parseIsoDate } from "@/lib/dates";
import { phoneSchema } from "./account";

/**
 * Validation for every host form. The server always re-validates — client-side checks are only a
 * convenience. Status, ownership, host id and user id are NEVER part of these schemas.
 */

const text = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ""))
    .pipe(z.string().min(min, `${label} must be at least ${min} characters`).max(max, `${label} must be ${max} characters or fewer`));

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")));

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

/** Australian Business Number: 11 digits with the official weighted checksum. */
export function isValidAbn(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split("").map(Number);
  nums[0]! -= 1;
  return nums.reduce((sum, d, i) => sum + d * weights[i]!, 0) % 89 === 0;
}

// ── Host profile ──
export const hostProfileSchema = z
  .object({
    displayName: text(2, 40, "Display name"),
    bio: optionalText(600, "About you"),
    hostType: z.enum(["INDIVIDUAL", "BUSINESS"], { message: "Choose individual or business" }),
    legalName: text(2, 100, "Legal name"),
    businessName: optionalText(120, "Business name"),
    abn: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s/g, ""))
      .refine((v) => v === "" || isValidAbn(v), "Enter a valid 11-digit ABN")
      .transform((v) => (v === "" ? null : v)),
    phone: phoneSchema.refine((v) => v !== null, "Add a phone number so Roavela can contact you about your listing"),
  })
  .refine((v) => v.hostType !== "BUSINESS" || v.businessName !== null, { message: "Add your business name", path: ["businessName"] });

// ── Property basics ──
export const HOST_PROPERTY_TYPES = ["HOUSE", "APARTMENT", "CABIN", "COTTAGE", "TINY_HOME", "FARM_STAY", "VILLA", "GUESTHOUSE", "BEACH_HOUSE", "OTHER"] as const;

export const basicsSchema = z.object({
  title: text(8, 80, "Title"),
  type: z.enum(HOST_PROPERTY_TYPES, { message: "Choose a property type" }),
  maxGuests: z.coerce.number().int().min(1, "At least 1 guest").max(16, "Up to 16 guests"),
  bedrooms: z.coerce.number().int().min(0).max(20, "Up to 20 bedrooms"),
  beds: z.coerce.number().int().min(1, "At least 1 bed").max(40),
  bathrooms: z.coerce
    .number()
    .min(0.5, "At least half a bathroom")
    .max(20)
    .refine((v) => Number.isInteger(v * 2), "Use whole or half bathrooms (e.g. 1.5)"),
});

// ── Location ──
const stateCodes = AU_STATES.map((s) => s.code) as [string, ...string[]];
const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .refine((v) => v === null || (Number.isFinite(v) && v >= min && v <= max), `Must be between ${min} and ${max}`);

export const locationSchema = z
  .object({
    addressLine1: text(3, 120, "Street address"),
    addressLine2: optionalText(120, "Address line 2"),
    locality: text(2, 60, "Suburb / town"),
    adminArea: z.enum(stateCodes, { message: "Choose a state or territory" }),
    postcode: z.string().trim().regex(/^\d{4}$/, "Enter a 4-digit postcode"),
    countryCode: z.literal("AU", { message: "Roavela currently lists Australian properties only" }),
    latitude: coordinate(-90, 90),
    longitude: coordinate(-180, 180),
    destinationId: z.string().trim().min(1, "Choose the destination guests will search for").max(64),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), { message: "Enter both latitude and longitude, or neither", path: ["longitude"] });

// ── Description ──
export const detailsSchema = z.object({
  summary: text(20, 160, "Summary"),
  description: text(80, 5000, "Description"),
});

// ── Amenities ──
export const amenitiesSchema = z.object({
  amenities: z
    .array(z.string())
    .max(60)
    .transform((keys) => [...new Set(keys)])
    .refine((keys) => keys.every((k) => AMENITY_KEYS.includes(k)), "Unknown amenity"),
});

// ── Pricing (dollars in the form → integer cents) ──
const MONEY = /^\d{1,6}(\.\d{1,2})?$/;
export function parseMoneyToCents(value: string): number | null {
  const v = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!MONEY.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const money = (label: string, min: number, max: number, optional = false) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") {
        if (optional) return null;
        ctx.addIssue({ code: "custom", message: `Enter a ${label.toLowerCase()}` });
        return z.NEVER;
      }
      const cents = parseMoneyToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: `Enter ${label.toLowerCase()} as dollars, e.g. 250 or 249.50` });
        return z.NEVER;
      }
      if (cents < min * 100 || cents > max * 100) {
        ctx.addIssue({ code: "custom", message: `${label} must be between $${min} and $${max.toLocaleString("en-AU")}` });
        return z.NEVER;
      }
      return cents;
    });

export const pricingSchema = z
  .object({
    nightlyPrice: money("Nightly price", 20, 10_000),
    weekendPrice: money("Weekend price", 20, 10_000, true),
    cleaningFee: money("Cleaning fee", 0, 2_000, true).transform((v) => v ?? 0),
    minNights: z.coerce.number().int().min(1, "At least 1 night").max(30, "Up to 30 nights"),
    maxNights: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 365), "Up to 365 nights"),
  })
  .refine((v) => v.maxNights === null || v.maxNights >= v.minNights, { message: "Maximum stay can't be shorter than the minimum", path: ["maxNights"] });

// ── House rules & cancellation ──
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 15:00");
const optionalTime = z
  .string()
  .trim()
  .refine((v) => v === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), "Use 24-hour time, e.g. 22:00")
  .transform((v) => (v === "" ? null : v));

export const rulesSchema = z
  .object({
    checkInTime: time,
    checkOutTime: time,
    smokingAllowed: checkbox,
    petsAllowed: checkbox,
    eventsAllowed: checkbox,
    quietHoursStart: optionalTime,
    quietHoursEnd: optionalTime,
    houseRules: optionalText(1500, "Additional rules"),
    cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT"], { message: "Choose a cancellation policy" }),
  })
  .refine((v) => (v.quietHoursStart === null) === (v.quietHoursEnd === null), { message: "Set both quiet-hours times, or neither", path: ["quietHoursEnd"] });

// ── Availability ──
export const MAX_BLOCK_AHEAD_DAYS = 730;

export const dateRangeSchema = z
  .object({ start: z.string().refine(isIsoDate, "Choose a start date"), end: z.string().refine(isIsoDate, "Choose an end date") })
  .transform((v) => ({ start: parseIsoDate(v.start), end: parseIsoDate(v.end) }))
  .refine((v) => v.end > v.start, { message: "The end date must be after the start date", path: ["end"] });

// ── Compliance ──
export const complianceSchema = z
  .object({
    registrationNumber: z
      .string()
      .trim()
      .toUpperCase()
      .max(40)
      .refine((v) => v === "" || /^[A-Z0-9][A-Z0-9 -]{2,39}$/.test(v), "Use letters, numbers and dashes only")
      .transform((v) => (v === "" ? null : v)),
    registrationExpiry: z
      .string()
      .trim()
      .refine((v) => v === "" || isIsoDate(v), "Enter a valid date")
      .transform((v) => (v === "" ? null : parseIsoDate(v))),
    exemptionDeclared: checkbox,
    exemptionReason: optionalText(500, "Exemption reason"),
    ownershipStatus: z.enum(["OWNER", "MANAGER", "TENANT_WITH_PERMISSION"], { message: "Tell us your relationship to the property" }),
    authorityConfirmed: checkbox.refine((v) => v, "You must confirm you are authorised to list this property"),
    insuranceConfirmed: checkbox.refine((v) => v, "You must confirm appropriate insurance is in place"),
    insurerName: optionalText(120, "Insurer"),
    obligationsAcknowledged: checkbox.refine((v) => v, "Please confirm you understand your local obligations"),
    planningAcknowledged: checkbox.refine((v) => v, "Please confirm the property may be used for short-term rental"),
    strataScheme: z.enum(["YES", "NO", "UNSURE"], { message: "Tell us whether the property is in a strata scheme" }),
    strataPermissionConfirmed: checkbox,
  })
  .refine((v) => !v.exemptionDeclared || v.exemptionReason !== null, { message: "Explain why an exemption applies", path: ["exemptionReason"] })
  .refine((v) => v.strataScheme !== "YES" || v.strataPermissionConfirmed, {
    message: "Confirm the strata scheme / body corporate permits short-term rental",
    path: ["strataPermissionConfirmed"],
  });

export const photoAltSchema = z.object({ alt: text(3, 160, "Photo description") });
