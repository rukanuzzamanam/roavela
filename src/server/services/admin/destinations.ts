import "server-only";
import { z } from "zod";
import { ADMIN_PAGE_SIZE } from "@/lib/admin/query";
import { prisma } from "@/server/db";
import { FORBIDDEN, fail, ok, permitted, recordAdminAction, STALE, type AdminActor, type AdminResult } from "./common";

/**
 * Destination metadata used by marketplace pages. Admins edit existing destinations' editorial and
 * SEO fields and publish/unpublish them. Slugs, hierarchy and timezones are structural (search and
 * drive-time data depend on them) and are not editable here; nothing generates pages in bulk.
 */
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === "" ? null : v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")));

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => /^-?\d{1,3}(\.\d{1,7})?$/.test(v) && Number(v) >= min && Number(v) <= max, `Enter a value between ${min} and ${max}`)
    .transform(Number);

export const destinationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  adminArea: optional(10),
  tagline: optional(140),
  summary: optional(1200),
  // Same-origin images (bundled scenes or uploaded media) or the configured image CDN only.
  heroImageUrl: optional(500).refine(
    (v) => v === null || /^https:\/\/res\.cloudinary\.com\/[\w./-]+$/.test(v) || /^\/(media|demo)\/[\w./-]+$/.test(v),
    "Use an image path on Roavela (e.g. /media/…) or the image CDN",
  ),
  seoTitle: optional(70),
  seoDescription: optional(170),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  isPublished: z.preprocess((v) => v === "on", z.boolean()),
});

export async function listAdminDestinations({ q, page }: { q?: string; page: number }) {
  const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q.toLowerCase() } }] } : {};
  const [total, rows] = await Promise.all([
    prisma.destination.count({ where }),
    prisma.destination.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: { id: true, slug: true, name: true, kind: true, adminArea: true, countryCode: true, isPublished: true, isOrigin: true, updatedAt: true, _count: { select: { properties: { where: { status: "PUBLISHED" } } } } },
    }),
  ]);
  return { total, rows };
}

export function getAdminDestination(id: string) {
  if (id.length > 64) return null;
  return prisma.destination.findUnique({ where: { id }, include: { parent: { select: { name: true } } } });
}

export async function updateDestination(actor: AdminActor, input: { id: string; values: Record<string, unknown>; expectedUpdatedAt: Date | null }): Promise<AdminResult<undefined> & { fieldErrors?: Record<string, string> }> {
  if (!permitted(actor, "admin:destinations:manage")) return FORBIDDEN();
  const parsed = destinationSchema.safeParse(input.values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ...fail("invalid", "Please fix the highlighted fields."), fieldErrors };
  }
  const current = await prisma.destination.findUnique({ where: { id: input.id }, select: { id: true, updatedAt: true, isPublished: true } });
  if (!current) return fail("not_found", "Destination not found.");
  if (!input.expectedUpdatedAt || current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return STALE("destination");

  const done = await prisma.$transaction(async (tx) => {
    const updated = await tx.destination.updateMany({ where: { id: current.id, updatedAt: current.updatedAt }, data: parsed.data });
    if (updated.count !== 1) return false;
    await recordAdminAction(tx, {
      adminId: actor.id,
      action: "destination.updated",
      targetType: "Destination",
      targetId: current.id,
      metadata: { fields: Object.keys(parsed.data), ...(current.isPublished !== parsed.data.isPublished ? { published: parsed.data.isPublished } : {}) },
    });
    return true;
  });
  return done ? ok(undefined) : STALE("destination");
}
