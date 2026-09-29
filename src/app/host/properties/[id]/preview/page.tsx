import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingActions } from "@/components/host/host-forms";
import { Checklist, SectionStepper } from "@/components/host/host-ui";
import { PropertyDetailView } from "@/components/property/property-detail-view";
import { Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { formatMoney } from "@/lib/money";
import { availableHostIntents } from "@/lib/listing-lifecycle";
import { requireHost } from "@/server/auth/host-guard";
import { track } from "@/server/providers/analytics";
import { getManagedProperty } from "@/server/services/host-properties";
import { getHostPropertyPreview, PUBLIC_AREA_RADIUS_METERS } from "@/server/services/properties";

export const metadata: Metadata = { title: "Preview listing", robots: { index: false, follow: false } };

type PageProps = { params: Promise<{ id: string }> };

export default async function PreviewPage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireHost(`/host/properties/${id}/preview`);
  const [managed, preview] = await Promise.all([getManagedProperty(user.id, id), getHostPropertyPreview(id, user.id)]);
  if (!managed || !preview) notFound();
  const { property: p, checklist } = managed;
  track({ name: "property_previewed", properties: { propertyId: p.id }, userId: user.id });

  return (
    <div className="pb-16">
      <div role="status" className="sticky top-16 z-30 border-b border-ochre-200 bg-ochre-50">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 py-3">
          <p className="flex items-center gap-2 font-bold text-ochre-700">
            <Icon name="eye" size={18} />
            PREVIEW — NOT LIVE
          </p>
          <Link href={`/host/properties/${p.id}`} className="text-sm font-semibold text-eucalypt-700 hover:underline">
            Back to listing
          </Link>
        </div>
      </div>

      <div className="container-page pt-6">
        <div className="mb-8">
          <SectionStepper propertyId={p.id} sections={checklist.sections} current="preview" />
        </div>
        <PropertyDetailView
          property={preview}
          mode="preview"
          radiusMeters={PUBLIC_AREA_RADIUS_METERS}
          aside={
            <Card className="space-y-5 p-6">
              <p className="text-2xl font-bold">
                {preview.nightlyPriceCents !== null ? formatMoney(preview.nightlyPriceCents, preview.currency) : "No price yet"}
                <span className="text-base font-normal text-mist"> / night</span>
              </p>
              <p className="text-sm text-mist">Guests will choose dates and see an estimated total here.</p>
              <div className="border-t border-ink/10 pt-5">
                <p className="mb-3 font-semibold">Ready to submit?</p>
                <Checklist sections={checklist.sections.filter((s) => !s.complete)} hostIssues={checklist.hostIssues} propertyId={p.id} />
                {checklist.complete && <p className="text-sm text-eucalypt-700">Everything&apos;s complete.</p>}
                <div className="mt-4">
                  <ListingActions propertyId={p.id} intents={availableHostIntents(p.status)} canSubmit={checklist.complete} />
                </div>
              </div>
            </Card>
          }
        />
      </div>
    </div>
  );
}
