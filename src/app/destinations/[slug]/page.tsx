import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { DEFAULT_ORIGIN_SLUG } from "@/config/search";
import { formatDistance, formatDriveTime } from "@/lib/geo";
import { prisma } from "@/server/db";

/**
 * Destination placeholder. Links from property pages land here; the full destination guide
 * (things to do, best time to visit, FAQs, structured data) is a later phase. Kept out of search
 * indexes until that content exists.
 */
const getDestination = cache((slug: string) =>
  prisma.destination.findFirst({
    where: { slug, isPublished: true },
    select: {
      slug: true,
      name: true,
      adminArea: true,
      tagline: true,
      summary: true,
      heroImageUrl: true,
      estimatesTo: {
        where: { origin: { slug: DEFAULT_ORIGIN_SLUG } },
        take: 1,
        select: { durationMinutes: true, distanceMeters: true, origin: { select: { name: true } } },
      },
    },
  }),
);

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const destination = await getDestination((await params).slug).catch(() => null);
  if (!destination) return { title: "Destination not found", robots: { index: false } };
  return {
    title: `${destination.name} stays`,
    description: destination.summary ?? undefined,
    alternates: { canonical: `/destinations/${destination.slug}` },
    robots: { index: false, follow: true },
  };
}

export default async function DestinationPage({ params }: PageProps) {
  const destination = await getDestination((await params).slug);
  if (!destination) notFound();
  const drive = destination.estimatesTo[0];

  return (
    <div className="container-page py-10">
      <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">{destination.adminArea}</p>
          <h1 className="mt-1 text-5xl">{destination.name}</h1>
          {destination.tagline && <p className="mt-3 text-xl text-ink-soft">{destination.tagline}</p>}
          {destination.summary && <p className="mt-4 max-w-prose text-ink-soft">{destination.summary}</p>}
          {drive && (
            <p className="mt-5 flex items-center gap-2 font-semibold">
              <Icon name="car" size={18} className="text-eucalypt-600" />
              About {formatDriveTime(drive.durationMinutes)} ({formatDistance(drive.distanceMeters)}) from {drive.origin.name}
              <span className="font-normal text-mist">— estimated</span>
            </p>
          )}
          <ButtonLink href={`/search?destination=${destination.slug}`} size="lg" className="mt-8">
            Browse stays in {destination.name}
          </ButtonLink>
          <p className="mt-6 text-sm text-mist">A full {destination.name} guide — things to do, when to visit and local tips — is on its way.</p>
        </div>
        <PropertyImage src={destination.heroImageUrl} alt="" priority sizes="(min-width: 1024px) 50vw, 100vw" className="aspect-[4/3] rounded-[1.75rem]" />
      </div>
    </div>
  );
}
