import { JURISDICTIONS } from "@/config/jurisdictions";
import type { ComplianceDocumentType, ComplianceStatus } from "@/generated/prisma/enums";
import { addDays } from "@/lib/dates";

/**
 * Compliance review rules. Roavela REVIEWS the information a host declares; it does not verify it
 * with government registers and never certifies a listing as legally compliant. UI copy must say
 * "Compliance information reviewed", never "verified" or "certified".
 *
 * Flags are jurisdiction-aware: an expiry is only checked where the host recorded one, and a
 * registration is only "missing" where that jurisdiction actually requires it.
 */
export const EXPIRING_SOON_DAYS = 30;

export type ComplianceDecision = "start" | "approve" | "reject" | "expire";

const TRANSITIONS: Record<ComplianceDecision, { from: readonly ComplianceStatus[]; to: ComplianceStatus }> = {
  start: { from: ["SUBMITTED"], to: "UNDER_REVIEW" },
  approve: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "APPROVED" },
  reject: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "REJECTED" },
  expire: { from: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"], to: "EXPIRED" },
};

export function complianceTransition(decision: ComplianceDecision, from: ComplianceStatus): ComplianceStatus | null {
  const rule = TRANSITIONS[decision];
  return rule.from.includes(from) ? rule.to : null;
}

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, { label: string; tone: "neutral" | "warning" | "success" | "demo" }> = {
  SUBMITTED: { label: "Awaiting review", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "warning" },
  APPROVED: { label: "Information reviewed", tone: "success" },
  REJECTED: { label: "Needs correction", tone: "demo" },
  EXPIRED: { label: "Expired", tone: "demo" },
};

export const COMPLIANCE_TYPE_LABELS: Record<ComplianceDocumentType, string> = {
  SHORT_TERM_RENTAL_REGISTRATION: "Short-term rental registration",
  ABN: "ABN",
  INSURANCE: "Insurance",
  AUTHORITY_TO_LIST: "Authority to list",
  LOCAL_COMPLIANCE_ACKNOWLEDGEMENT: "Local rules & strata acknowledgement",
  OTHER: "Other",
};

export type ComplianceFlag = { code: "expired" | "expiring_soon" | "registration_missing" | "not_confirmed" | "requirement_missing"; label: string };

export interface FlaggableDocument {
  type: ComplianceDocumentType;
  status: ComplianceStatus;
  jurisdiction: string;
  referenceNumber: string | null;
  expiresAt: Date | null;
  data: unknown;
}

/** Flags for a single record. `today` is a UTC-midnight calendar date. */
export function documentFlags(doc: FlaggableDocument, today: Date): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  if (doc.expiresAt) {
    if (doc.expiresAt < today) flags.push({ code: "expired", label: "Expired" });
    else if (doc.expiresAt <= addDays(today, EXPIRING_SOON_DAYS)) flags.push({ code: "expiring_soon", label: `Expires within ${EXPIRING_SOON_DAYS} days` });
  }
  const data = (doc.data ?? {}) as Record<string, unknown>;
  if (doc.type === "SHORT_TERM_RENTAL_REGISTRATION" && JURISDICTIONS[doc.jurisdiction]?.registrationRequired && !doc.referenceNumber && data.exemptionDeclared !== true) {
    flags.push({ code: "registration_missing", label: "Registration number missing" });
  }
  if ((doc.type === "INSURANCE" || doc.type === "AUTHORITY_TO_LIST") && data.confirmed !== true) {
    flags.push({ code: "not_confirmed", label: "Not confirmed by host" });
  }
  return flags;
}

/** Requirement types a listing should have on file in its jurisdiction. */
export function requiredTypes(jurisdiction: string | null): ComplianceDocumentType[] {
  const types: ComplianceDocumentType[] = ["AUTHORITY_TO_LIST", "INSURANCE", "LOCAL_COMPLIANCE_ACKNOWLEDGEMENT"];
  if (jurisdiction && JURISDICTIONS[jurisdiction]?.registrationRequired) types.unshift("SHORT_TERM_RENTAL_REGISTRATION");
  return types;
}

/** Listing-level flags: missing requirements plus every record's own flags. */
export function listingComplianceFlags(jurisdiction: string | null, docs: readonly FlaggableDocument[], today: Date): ComplianceFlag[] {
  const present = new Set(docs.map((d) => d.type));
  const missing = requiredTypes(jurisdiction)
    .filter((t) => !present.has(t))
    .map((t): ComplianceFlag => ({ code: "requirement_missing", label: `${COMPLIANCE_TYPE_LABELS[t]} not provided` }));
  return [...missing, ...docs.flatMap((d) => documentFlags(d, today))];
}
