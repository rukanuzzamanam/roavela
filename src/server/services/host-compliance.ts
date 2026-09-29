import "server-only";
import type { z } from "zod";
import { jurisdictionFor } from "@/config/jurisdictions";
import type { ComplianceDocumentType, Prisma } from "@/generated/prisma/client";
import { todayInTimeZone } from "@/lib/dates";
import { detectDocumentType, MAX_DOCUMENT_BYTES } from "@/lib/image-files";
import type { complianceSchema } from "@/lib/validation/host";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { getStorage } from "@/server/storage";
import { loadEditableProperty, noteEdit, notFound, withSection, type HostResult } from "./host-access";

/**
 * Compliance information for a listing, stored as one ComplianceDocument per requirement type and
 * tagged with the jurisdiction (e.g. "AU-NSW"). Hosts can only ever create SUBMITTED records —
 * any edit resets a record to SUBMITTED for re-review. Roavela records what the host declares; it
 * does not verify registrations with government registers.
 */

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const ATTACHABLE_TYPES: ComplianceDocumentType[] = ["SHORT_TERM_RENTAL_REGISTRATION", "INSURANCE", "AUTHORITY_TO_LIST"];

export async function saveCompliance(userId: string, propertyId: string, input: z.infer<typeof complianceSchema>): Promise<HostResult> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;

  const jurisdiction = jurisdictionFor(p.countryCode, p.adminArea);
  if (!p.adminArea) return { ok: false, error: "invalid", message: "Add the property's location first — requirements depend on the state or territory." };
  const code = `${p.countryCode}-${p.adminArea}`;

  if (input.registrationExpiry && input.registrationExpiry < todayInTimeZone("Australia/Sydney")) {
    return { ok: false, error: "invalid", message: "That registration has expired.", fieldErrors: { registrationExpiry: "This date is in the past — renew the registration first" } };
  }
  if (jurisdiction?.registrationRequired && !input.registrationNumber && !input.exemptionDeclared) {
    return {
      ok: false,
      error: "invalid",
      message: `Provide your ${jurisdiction.registrationLabel ?? "registration number"} or declare an exemption.`,
      fieldErrors: { registrationNumber: "Required in this state unless an exemption applies" },
    };
  }

  const records: { type: ComplianceDocumentType; referenceNumber?: string | null; expiresAt?: Date | null; data: Prisma.InputJsonValue }[] = [
    {
      type: "AUTHORITY_TO_LIST",
      data: { confirmed: input.authorityConfirmed, ownershipStatus: input.ownershipStatus },
    },
    { type: "INSURANCE", data: { confirmed: input.insuranceConfirmed, insurerName: input.insurerName } },
    {
      type: "LOCAL_COMPLIANCE_ACKNOWLEDGEMENT",
      data: {
        obligationsAcknowledged: input.obligationsAcknowledged,
        planningAcknowledged: input.planningAcknowledged,
        strataAnswered: true,
        strataScheme: input.strataScheme,
        strataPermissionConfirmed: input.strataScheme === "YES" ? input.strataPermissionConfirmed : null,
      },
    },
  ];
  if (jurisdiction?.registrationRequired || input.registrationNumber) {
    records.push({
      type: "SHORT_TERM_RENTAL_REGISTRATION",
      referenceNumber: input.registrationNumber,
      expiresAt: input.registrationExpiry,
      data: { exemptionDeclared: input.exemptionDeclared, exemptionReason: input.exemptionDeclared ? input.exemptionReason : null },
    });
  }

  await prisma.$transaction(
    records.map((r) =>
      prisma.complianceDocument.upsert({
        where: { propertyId_type: { propertyId: p.id, type: r.type } },
        create: { hostId: p.hostId, propertyId: p.id, jurisdiction: code, type: r.type, referenceNumber: r.referenceNumber ?? null, expiresAt: r.expiresAt ?? null, data: r.data, status: "SUBMITTED" },
        // Any change goes back to SUBMITTED for re-review. Hosts can never set APPROVED.
        update: { jurisdiction: code, referenceNumber: r.referenceNumber ?? null, expiresAt: r.expiresAt ?? null, data: r.data, status: "SUBMITTED", submittedAt: new Date(), reviewedAt: null, reviewedById: null, reviewNote: null },
      }),
    ),
  );
  await prisma.property.update({ where: { id: p.id }, data: { completedSections: withSection(p.completedSections, "compliance") } });
  // Log that compliance was submitted, never its contents.
  await audit(userId, "compliance.submitted", "Property", p.id, { jurisdiction: code, types: records.map((r) => r.type) });
  await noteEdit(userId, p, "compliance");
  return { ok: true, value: undefined };
}

/** Attach a supporting document (PDF or image) to an existing compliance record. Stored privately. */
export async function attachComplianceFile(userId: string, propertyId: string, type: ComplianceDocumentType, file: File): Promise<HostResult> {
  if (!ATTACHABLE_TYPES.includes(type)) return { ok: false, error: "invalid", message: "Documents can't be attached to that item." };
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const doc = await prisma.complianceDocument.findUnique({ where: { propertyId_type: { propertyId: loaded.value.id, type } }, select: { id: true, fileKey: true } });
  if (!doc) return { ok: false, error: "invalid", message: "Save the compliance details first, then attach documents." };

  if (file.size === 0) return { ok: false, error: "invalid", message: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES) return { ok: false, error: "invalid", message: "Documents must be 10 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectDocumentType(bytes);
  if (!kind) return { ok: false, error: "invalid", message: "Upload a PDF, JPEG, PNG or WebP file." };

  const storage = getStorage();
  const stored = await storage.put({ visibility: "private", folder: `compliance/${loaded.value.hostId}`, extension: EXT[kind]!, bytes });
  await prisma.complianceDocument.update({ where: { id: doc.id }, data: { fileKey: stored.key, fileUrl: null, status: "SUBMITTED", submittedAt: new Date() } });
  if (doc.fileKey) await storage.delete(doc.fileKey).catch(() => {});
  await audit(userId, "compliance.document_attached", "Property", loaded.value.id, { type });
  return { ok: true, value: undefined };
}

/** Private document download: the owning host, or an admin. */
export async function readComplianceFile(user: { id: string; role: string }, documentId: string) {
  const doc = await prisma.complianceDocument.findFirst({
    where: user.role === "ADMIN" ? { id: documentId } : { id: documentId, host: { userId: user.id } },
    select: { fileKey: true },
  });
  if (!doc?.fileKey) return null;
  const bytes = await getStorage().get(doc.fileKey);
  if (!bytes) return null;
  const ext = doc.fileKey.split(".").pop()!;
  return { bytes, contentType: Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream", ext };
}

export { notFound };
