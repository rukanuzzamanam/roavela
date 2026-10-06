import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/server/auth/session";
import { errorFields, log } from "@/server/log";
import { getRateLimiter, RATE_LIMITS } from "@/server/rate-limit";
import { recordDocumentAccess } from "@/server/services/admin/compliance";
import { readComplianceFile } from "@/server/services/host-compliance";

/**
 * Private compliance-document download. Only the owning host (or an admin with the compliance
 * review capability) can read it; everyone else gets a 404 so the document's existence isn't
 * revealed. Files live in private storage with no public URL; every response is no-store and
 * no-index, and admin reads are recorded in the audit log.
 */
const NOT_FOUND = () => new Response("Compliance document is unavailable.", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NOT_FOUND();
  const limit = await getRateLimiter().consume(`documentAccess:${user.id}`, RATE_LIMITS.documentAccess);
  if (!limit.success) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store" } });

  const { id } = await params;
  const file = await readComplianceFile(user, id);
  if (!file) return NOT_FOUND();
  if (can(user.role, "admin:compliance:review")) {
    await recordDocumentAccess(user, id).catch((e) => log.error("compliance.access_audit_failed", { documentId: id, ...errorFields(e) }));
  }
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="compliance-document.${file.ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
