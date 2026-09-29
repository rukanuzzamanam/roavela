import { getCurrentUser } from "@/server/auth/session";
import { readComplianceFile } from "@/server/services/host-compliance";

/**
 * Private compliance-document download. Only the owning host (or an admin) can read it; everyone
 * else gets a 404 so the document's existence isn't revealed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const file = await readComplianceFile(user, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="compliance-document.${file.ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
