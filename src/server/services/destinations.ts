import "server-only";
import { prisma } from "@/server/db";
import { demoListingsVisible } from "@/server/env";
import type { DestinationSummary } from "@/types/marketplace";

/** Published destinations reachable from an origin, ordered by drive time, with live stay counts. */
export async function listDestinationsFrom(originSlug: string, maxMinutes?: number): Promise<DestinationSummary[]> {
  const origin = await prisma.destination.findFirst({
    where: { slug: originSlug, isOrigin: true },
    select: { id: true, name: true },
  });
  if (!origin) return [];

  const estimates = await prisma.driveEstimate.findMany({
    where: {
      originId: origin.id,
      durationMinutes: maxMinutes ? { lte: maxMinutes } : undefined,
      destination: { isPublished: true },
    },
    orderBy: { durationMinutes: "asc" },
    select: {
      durationMinutes: true,
      distanceMeters: true,
      destination: {
        select: {
          slug: true,
          name: true,
          tagline: true,
          heroImageUrl: true,
          _count: {
            select: {
              properties: { where: { status: "PUBLISHED", ...(demoListingsVisible() ? {} : { isDemo: false }) } },
            },
          },
        },
      },
    },
  });

  return estimates.map((e) => ({
    slug: e.destination.slug,
    name: e.destination.name,
    tagline: e.destination.tagline,
    heroImageUrl: e.destination.heroImageUrl,
    stayCount: e.destination._count.properties,
    drive: {
      originName: origin.name,
      durationMinutes: e.durationMinutes,
      distanceMeters: e.distanceMeters,
      approximate: true,
    },
  }));
}
