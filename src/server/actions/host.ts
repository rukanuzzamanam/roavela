"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ComplianceDocumentType } from "@/generated/prisma/enums";
import { can } from "@/lib/permissions";
import { nextSection } from "@/lib/host-sections";
import {
  amenitiesSchema,
  basicsSchema,
  complianceSchema,
  dateRangeSchema,
  detailsSchema,
  hostProfileSchema,
  locationSchema,
  photoAltSchema,
  pricingSchema,
  rulesSchema,
} from "@/lib/validation/host";
import { AuthorizationError, authorize } from "@/server/auth/guards";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { track } from "@/server/providers/analytics";
import { getRateLimiter, RATE_LIMITS, type RateLimitRule } from "@/server/rate-limit";
import type { HostResult } from "@/server/services/host-access";
import { markSectionReviewed, setDatesBlocked } from "@/server/services/host-availability";
import { attachComplianceFile, saveCompliance } from "@/server/services/host-compliance";
import { deletePropertyPhoto, movePhoto, updatePhotoAlt, uploadPropertyPhoto } from "@/server/services/host-photos";
import { saveHostProfile, uploadHostAvatar } from "@/server/services/host-profile";
import {
  changeListingStatus,
  createPropertyDraft,
  saveAmenities,
  saveBasics,
  saveDetails,
  saveLocation,
  savePricing,
  saveRules,
} from "@/server/services/host-properties";

/**
 * Host Server Actions. Each one:
 *  1. derives the user from the server session (never from form data),
 *  2. checks the role permission,
 *  3. rate-limits,
 *  4. validates input with Zod,
 *  5. calls a service that re-checks ownership inside its database query.
 * Status, host id, user id, role and computed prices are never read from the client.
 * Server Actions are POST-only and Next.js verifies the Origin header (CSRF protection).
 */

export interface HostFormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Changes on each successful save so the client can show "Saved". */
  savedAt?: number;
}

const idSchema = z.string().min(1).max(64);

async function hostUser(): Promise<SessionUser> {
  return authorize("property:manage");
}

async function limited(userId: string, name: keyof typeof RATE_LIMITS): Promise<boolean> {
  const rule: RateLimitRule = RATE_LIMITS[name];
  return (await getRateLimiter().consume(`${name}:${userId}`, rule)).success;
}

function formObject(fd: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, typeof fd.get(k) === "string" ? (fd.get(k) as string) : ""]));
}

function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

function fromResult(r: HostResult<unknown>): HostFormState {
  if (r.ok) return { ok: true, savedAt: Date.now() };
  return { ok: false, message: r.message, fieldErrors: r.error === "invalid" ? r.fieldErrors : undefined };
}

const TOO_MANY: HostFormState = { ok: false, message: "You're doing that too often. Please wait a few minutes and try again." };
const SIGNED_OUT: HostFormState = { ok: false, message: "Your session has expired. Please log in again." };

async function guard<T>(fn: (user: SessionUser) => Promise<T>): Promise<T | HostFormState> {
  try {
    return await fn(await hostUser());
  } catch (e) {
    if (e instanceof AuthorizationError) return SIGNED_OUT;
    throw e;
  }
}

// ── Host profile ─────────────────────────────────────────────────────────────

export async function saveHostProfileAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const user = await getCurrentUser();
  // Travellers may become hosts; existing hosts may edit. Admins and signed-out users may not.
  if (!user || !(can(user.role, "host:become") || can(user.role, "host:portal"))) return SIGNED_OUT;
  if (!(await limited(user.id, "hostOnboarding"))) return TOO_MANY;

  const parsed = hostProfileSchema.safeParse(formObject(fd, ["displayName", "bio", "hostType", "legalName", "businessName", "abn", "phone"]));
  if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };

  const result = await saveHostProfile(user, parsed.data);
  if (!result.ok) return fromResult(result);
  track({ name: "host_profile_completed", properties: { hostType: parsed.data.hostType }, userId: user.id });
  revalidatePath("/", "layout");
  if (result.value.created || fd.get("then") === "new-property") redirect("/host/properties/new");
  return { ok: true, savedAt: Date.now() };
}

export async function uploadAvatarAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  return guard(async (user) => {
    if (!(await limited(user.id, "photoUpload"))) return TOO_MANY;
    const file = fd.get("avatar");
    if (!(file instanceof File)) return { ok: false, message: "Choose an image to upload." };
    const r = await uploadHostAvatar(user.id, file);
    revalidatePath("/host/profile");
    return fromResult(r);
  });
}

// ── Property creation & sections ─────────────────────────────────────────────

export async function createPropertyAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const r = await guard(async (user) => {
    if (!(await limited(user.id, "propertyCreate"))) return TOO_MANY;
    const parsed = basicsSchema.safeParse(formObject(fd, ["title", "type", "maxGuests", "bedrooms", "beds", "bathrooms"]));
    if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
    const created = await createPropertyDraft(user.id, parsed.data);
    if (!created.ok) return fromResult(created);
    track({ name: "property_created", properties: { propertyId: created.value.id, type: parsed.data.type }, userId: user.id });
    return { id: created.value.id };
  });
  if ("id" in r) redirect(`/host/properties/${r.id}/edit/location`);
  return r;
}

type SectionHandler = (userId: string, propertyId: string, fd: FormData) => Promise<HostFormState>;

const SECTION_HANDLERS: Record<string, SectionHandler> = {
  basics: async (u, id, fd) => {
    const parsed = basicsSchema.safeParse(formObject(fd, ["title", "type", "maxGuests", "bedrooms", "beds", "bathrooms"]));
    return parsed.success ? fromResult(await saveBasics(u, id, parsed.data)) : { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
  },
  location: async (u, id, fd) => {
    const parsed = locationSchema.safeParse({ ...formObject(fd, ["addressLine1", "addressLine2", "locality", "adminArea", "postcode", "latitude", "longitude", "destinationId"]), countryCode: "AU" });
    return parsed.success ? fromResult(await saveLocation(u, id, parsed.data)) : { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
  },
  details: async (u, id, fd) => {
    const parsed = detailsSchema.safeParse(formObject(fd, ["summary", "description"]));
    return parsed.success ? fromResult(await saveDetails(u, id, parsed.data)) : { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
  },
  amenities: async (u, id, fd) => {
    const parsed = amenitiesSchema.safeParse({ amenities: fd.getAll("amenities").filter((v) => typeof v === "string") });
    return parsed.success ? fromResult(await saveAmenities(u, id, parsed.data)) : { ok: false, message: "Choose amenities from the list." };
  },
  pricing: async (u, id, fd) => {
    const parsed = pricingSchema.safeParse(formObject(fd, ["nightlyPrice", "weekendPrice", "cleaningFee", "minNights", "maxNights"]));
    if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
    const r = await savePricing(u, id, parsed.data);
    if (r.ok) track({ name: "property_pricing_completed", properties: { propertyId: id }, userId: u });
    return fromResult(r);
  },
  rules: async (u, id, fd) => {
    const raw = formObject(fd, ["checkInTime", "checkOutTime", "quietHoursStart", "quietHoursEnd", "houseRules", "cancellationPolicy"]);
    const parsed = rulesSchema.safeParse({ ...raw, smokingAllowed: fd.get("smokingAllowed"), petsAllowed: fd.get("petsAllowed"), eventsAllowed: fd.get("eventsAllowed") });
    return parsed.success ? fromResult(await saveRules(u, id, parsed.data)) : { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
  },
  availability: async (u, id) => fromResult(await markSectionReviewed(u, id, "availability")),
  photos: async (u, id) => fromResult(await markSectionReviewed(u, id, "photos")),
  compliance: async (u, id, fd) => {
    const raw = formObject(fd, ["registrationNumber", "registrationExpiry", "exemptionReason", "ownershipStatus", "insurerName", "strataScheme"]);
    const boxes = Object.fromEntries(
      ["exemptionDeclared", "authorityConfirmed", "insuranceConfirmed", "obligationsAcknowledged", "planningAcknowledged", "strataPermissionConfirmed"].map((k) => [k, fd.get(k)]),
    );
    const parsed = complianceSchema.safeParse({ ...raw, ...boxes });
    return parsed.success ? fromResult(await saveCompliance(u, id, parsed.data)) : { ok: false, fieldErrors: zodErrors(parsed.error), message: "Check the highlighted fields." };
  },
};

/** One entry point for every listing section form. `section` and `propertyId` are validated; ownership is enforced by the service. */
export async function saveSectionAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const section = String(fd.get("section") ?? "");
  const propertyId = idSchema.safeParse(fd.get("propertyId"));
  const handler = SECTION_HANDLERS[section];
  if (!handler || !propertyId.success) return { ok: false, message: "Something went wrong. Refresh the page and try again." };

  const r = await guard(async (user) => {
    if (!(await limited(user.id, "hostSave"))) return TOO_MANY;
    return handler(user.id, propertyId.data, fd);
  });
  if (r.ok) {
    revalidatePath(`/host/properties/${propertyId.data}`, "layout");
    if (fd.get("then") === "continue") {
      const next = nextSection(section);
      redirect(next ? `/host/properties/${propertyId.data}/edit/${next}` : `/host/properties/${propertyId.data}/preview`);
    }
  }
  return r;
}

// ── Photos ─────────────────────────────────────────────────────────────────────

export async function uploadPhotoAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const propertyId = idSchema.safeParse(fd.get("propertyId"));
  const file = fd.get("photo");
  if (!propertyId.success || !(file instanceof File)) return { ok: false, message: "Choose a photo to upload." };
  return guard(async (user) => {
    if (!(await limited(user.id, "photoUpload"))) return TOO_MANY;
    const r = await uploadPropertyPhoto(user.id, propertyId.data, file, String(fd.get("alt") ?? ""));
    if (r.ok) {
      track({ name: "property_photo_uploaded", properties: { propertyId: propertyId.data }, userId: user.id });
      revalidatePath(`/host/properties/${propertyId.data}`, "layout");
    }
    return fromResult(r);
  });
}

export async function photoAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const imageId = idSchema.safeParse(fd.get("imageId"));
  const op = z.enum(["alt", "delete", "up", "down", "cover"]).safeParse(fd.get("op"));
  if (!imageId.success || !op.success) return { ok: false, message: "Something went wrong. Refresh and try again." };
  return guard(async (user) => {
    if (!(await limited(user.id, "hostSave"))) return TOO_MANY;
    let r: HostResult;
    if (op.data === "alt") {
      const alt = photoAltSchema.safeParse({ alt: fd.get("alt") ?? "" });
      if (!alt.success) return { ok: false, fieldErrors: zodErrors(alt.error), message: alt.error.issues[0]?.message };
      r = await updatePhotoAlt(user.id, imageId.data, alt.data.alt);
    } else if (op.data === "delete") {
      r = await deletePropertyPhoto(user.id, imageId.data);
    } else {
      r = await movePhoto(user.id, imageId.data, op.data);
    }
    revalidatePath("/host/properties", "layout");
    return fromResult(r);
  });
}

// ── Availability ───────────────────────────────────────────────────────────────

export async function availabilityAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const propertyId = idSchema.safeParse(fd.get("propertyId"));
  const mode = z.enum(["block", "unblock"]).safeParse(fd.get("mode"));
  const range = dateRangeSchema.safeParse({ start: fd.get("start") ?? "", end: fd.get("end") ?? "" });
  if (!propertyId.success || !mode.success) return { ok: false, message: "Something went wrong. Refresh and try again." };
  if (!range.success) return { ok: false, fieldErrors: zodErrors(range.error), message: range.error.issues[0]?.message ?? "Check the dates." };
  return guard(async (user) => {
    if (!(await limited(user.id, "hostSave"))) return TOO_MANY;
    const r = await setDatesBlocked(user.id, propertyId.data, range.data, mode.data === "block");
    revalidatePath(`/host/properties/${propertyId.data}`, "layout");
    return fromResult(r);
  });
}

// ── Compliance documents ───────────────────────────────────────────────────────

export async function complianceFileAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const propertyId = idSchema.safeParse(fd.get("propertyId"));
  const type = z.enum(Object.values(ComplianceDocumentType) as [ComplianceDocumentType, ...ComplianceDocumentType[]]).safeParse(fd.get("type"));
  const file = fd.get("document");
  if (!propertyId.success || !type.success || !(file instanceof File)) return { ok: false, message: "Choose a document to upload." };
  return guard(async (user) => {
    if (!(await limited(user.id, "complianceUpload"))) return TOO_MANY;
    const r = await attachComplianceFile(user.id, propertyId.data, type.data, file);
    revalidatePath(`/host/properties/${propertyId.data}`, "layout");
    return fromResult(r);
  });
}

// ── Listing status (named intents only — never a raw status) ───────────────────

export async function listingStatusAction(_prev: HostFormState, fd: FormData): Promise<HostFormState> {
  const propertyId = idSchema.safeParse(fd.get("propertyId"));
  const intent = z.enum(["submit", "withdraw", "pause", "resume", "archive"]).safeParse(fd.get("intent"));
  if (!propertyId.success || !intent.success) return { ok: false, message: "That action isn't available." };
  return guard(async (user) => {
    if (!(await limited(user.id, intent.data === "submit" ? "listingSubmit" : "hostSave"))) return TOO_MANY;
    const r = await changeListingStatus(user.id, propertyId.data, intent.data);
    if (r.ok) {
      if (intent.data === "submit") track({ name: "property_submitted", properties: { propertyId: propertyId.data }, userId: user.id });
      if (intent.data === "pause") track({ name: "property_paused", properties: { propertyId: propertyId.data }, userId: user.id });
      revalidatePath("/host", "layout");
    }
    return fromResult(r);
  });
}
