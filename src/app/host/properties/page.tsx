import type { Metadata } from "next";
import Link from "next/link";
import { HostShell, StatusBadge } from "@/components/host/host-ui";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { formatMoney } from "@/lib/money";
import { requireHost } from "@/server/auth/host-guard";
import { listHostProperties } from "@/server/services/host-properties";

export const metadata: Metadata = { title: "Your properties", robots: { index: false } };

export default async function HostPropertiesPage() {
  const user = await requireHost("/host/properties");
  const properties = await listHostProperties(user.id);
  return (
    <HostShell current="/host/properties" eyebrow="Host portal" title="Your properties" actions={<ButtonLink href="/host/properties/new">Add a property</ButtonLink>}>
      {properties.length === 0 ? (
        <EmptyState icon="home" title="No properties yet" description="Create your first listing. You can save it as a draft and come back any time." action={<ButtonLink href="/host/properties/new">Add a property</ButtonLink>} />
      ) : (
        // Cards on every screen size — no cramped tables on mobile.
        <ul className="space-y-4">
          {properties.map((p) => (
            <li key={p.id}>
              <Link href={`/host/properties/${p.id}`} className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white hover:border-eucalypt-600 sm:flex-row">
                <PropertyImage src={p.images[0]?.url ?? null} alt="" className="aspect-[16/9] sm:aspect-auto sm:w-56 sm:shrink-0" sizes="(min-width: 640px) 14rem, 90vw" />
                <div className="flex flex-1 flex-col gap-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-display text-xl leading-tight">{p.title}</p>
                    <div className="flex gap-2">
                      <StatusBadge status={p.status} percent={p.percent} />
                      {p.isDemo && <Badge tone="demo">Demo</Badge>}
                    </div>
                  </div>
                  <p className="text-sm text-mist">
                    {PROPERTY_TYPE_LABELS[p.type]}
                    {p.locality && ` · ${p.locality}`}
                    {p.nightlyPriceCents !== null && ` · ${formatMoney(p.nightlyPriceCents, p.currency)} / night`}
                  </p>
                  {p.status === "DRAFT" && (
                    <div className="mt-auto">
                      <div className="h-1.5 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuenow={p.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Listing completion">
                        <div className="h-full rounded-full bg-eucalypt-600" style={{ width: `${p.percent}%` }} />
                      </div>
                    </div>
                  )}
                  {p.rejectionReason && (p.status === "CHANGES_REQUESTED" || p.status === "REJECTED") && <p className="text-sm text-ochre-700">Reviewer: {p.rejectionReason}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HostShell>
  );
}
