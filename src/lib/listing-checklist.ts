import type { ComplianceDocumentType } from "@/generated/prisma/enums";
import { jurisdictionFor } from "@/config/jurisdictions";

/**
 * The submission checklist. Pure: it takes a snapshot of the listing's data and says, section by
 * section, what is still missing. Used for the UI *and* enforced server-side on submit.
 */

export const LISTING_SECTIONS = [
  { key: "basics", label: "Property basics" },
  { key: "location", label: "Location" },
  { key: "details", label: "Description" },
  { key: "amenities", label: "Amenities" },
  { key: "photos", label: "Photos" },
  { key: "pricing", label: "Pricing" },
  { key: "availability", label: "Availability" },
  { key: "rules", label: "House rules" },
  { key: "compliance", label: "Compliance" },
] as const;

export type SectionKey = (typeof LISTING_SECTIONS)[number]["key"];

export const MIN_PHOTOS = 3;
export const MAX_PHOTOS = 24;
export const MIN_SUMMARY = 20;
export const MIN_DESCRIPTION = 80;

export interface ListingSnapshot {
  title: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  summary: string | null;
  description: string | null;
  addressLine1: string | null;
  locality: string | null;
  adminArea: string | null;
  postcode: string | null;
  countryCode: string;
  destinationId: string | null;
  amenityCount: number;
  photoCount: number;
  photosMissingAlt: number;
  nightlyPriceCents: number | null;
  completedSections: string[];
  /** Compliance records the host has submitted for this listing, by type. */
  compliance: Partial<Record<ComplianceDocumentType, { referenceNumber: string | null; data: unknown }>>;
  hostProfileComplete: boolean;
}

export interface SectionStatus {
  key: SectionKey;
  label: string;
  complete: boolean;
  issues: string[];
}

function has(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function ack(data: unknown, field: string): boolean {
  return typeof data === "object" && data !== null && (data as Record<string, unknown>)[field] === true;
}

export function evaluateChecklist(s: ListingSnapshot): { sections: SectionStatus[]; complete: boolean; percent: number; hostIssues: string[] } {
  const issues: Record<SectionKey, string[]> = {
    basics: [],
    location: [],
    details: [],
    amenities: [],
    photos: [],
    pricing: [],
    availability: [],
    rules: [],
    compliance: [],
  };

  if (!has(s.title)) issues.basics.push("Add a title");
  if (s.maxGuests < 1) issues.basics.push("Set how many guests can stay");
  if (s.beds < 1) issues.basics.push("Add at least one bed");

  if (!has(s.addressLine1)) issues.location.push("Add the street address");
  if (!has(s.locality)) issues.location.push("Add the suburb or town");
  if (s.countryCode === "AU" && !has(s.adminArea)) issues.location.push("Choose the state or territory");
  if (s.countryCode === "AU" && !has(s.postcode)) issues.location.push("Add the postcode");
  if (!s.destinationId) issues.location.push("Choose the destination guests will search for");

  if (!has(s.summary) || s.summary.trim().length < MIN_SUMMARY) issues.details.push(`Write a summary of at least ${MIN_SUMMARY} characters`);
  if (!has(s.description) || s.description.trim().length < MIN_DESCRIPTION) issues.details.push(`Write a description of at least ${MIN_DESCRIPTION} characters`);

  if (s.amenityCount < 1) issues.amenities.push("Select at least one amenity");

  if (s.photoCount < MIN_PHOTOS) issues.photos.push(`Upload at least ${MIN_PHOTOS} photos (${s.photoCount} so far)`);
  if (s.photosMissingAlt > 0) issues.photos.push(`Describe ${s.photosMissingAlt} photo${s.photosMissingAlt === 1 ? "" : "s"} for guests using screen readers`);

  if (s.nightlyPriceCents === null) issues.pricing.push("Set a nightly price");

  // Availability defaults to "open unless blocked", so the host only needs to have reviewed it.
  if (!s.completedSections.includes("availability")) issues.availability.push("Review your calendar and save it");
  if (!s.completedSections.includes("rules")) issues.rules.push("Review and save your house rules and cancellation policy");

  const jurisdiction = jurisdictionFor(s.countryCode, s.adminArea);
  const reg = s.compliance.SHORT_TERM_RENTAL_REGISTRATION;
  if (!s.adminArea) {
    issues.compliance.push("Add the property's state or territory first");
  } else {
    if (jurisdiction?.registrationRequired && !(has(reg?.referenceNumber) || ack(reg?.data, "exemptionDeclared"))) {
      issues.compliance.push(`Provide your ${jurisdiction.registrationLabel ?? "registration number"} or declare an exemption`);
    }
    const local = s.compliance.LOCAL_COMPLIANCE_ACKNOWLEDGEMENT?.data;
    if (!ack(local, "obligationsAcknowledged")) issues.compliance.push("Confirm you understand your local short-term rental obligations");
    if (!ack(local, "planningAcknowledged")) issues.compliance.push("Confirm the property may be used for short-term rental under local planning rules");
    if (!ack(local, "strataAnswered")) issues.compliance.push("Tell us whether the property is in a strata scheme or community title");
    if (!ack(s.compliance.INSURANCE?.data, "confirmed")) issues.compliance.push("Confirm appropriate insurance is in place");
    if (!ack(s.compliance.AUTHORITY_TO_LIST?.data, "confirmed")) issues.compliance.push("Confirm you own or are authorised to list the property");
  }

  const sections = LISTING_SECTIONS.map((sec) => ({ key: sec.key, label: sec.label, complete: issues[sec.key].length === 0, issues: issues[sec.key] }));
  const hostIssues = s.hostProfileComplete ? [] : ["Complete your host profile"];
  const done = sections.filter((x) => x.complete).length;
  return {
    sections,
    complete: sections.every((x) => x.complete) && hostIssues.length === 0,
    percent: Math.round((done / sections.length) * 100),
    hostIssues,
  };
}
