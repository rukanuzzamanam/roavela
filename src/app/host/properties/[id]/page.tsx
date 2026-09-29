import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingActions } from "@/components/host/host-forms";
import { Checklist, HostShell, StatusBadge } from "@/components/host/host-ui";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { availableHostIntents, STATUS_LABELS } from "@/lib/listing-lifecycle";
import { requireHost } from "@/server/auth/host-guard";
import { getManagedProperty } from "@/server/services/host-properties";

export const metadata: Metadata = { title: "Manage listing", robots: { index: false } };

type PageProps = { params: Promise<{ id: string }> };

export default async function ManagePropertyPage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireHost(`/host/properties/${id}`);
  // Ownership is part of the query: another host's property id is simply "not found".
  const managed = await getManagedProperty(user.id, id);
  if (!managed) notFound();
  const { property: p, checklist } = managed;
  const status = STATUS_LABELS[p.status];
  const intents = availableHostIntents(p.status);

  return (
    <HostShell
      current="/host/properties"
      eyebrow="Manage listing"
      title={p.title}
      actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/host/properties/${p.id}/preview`} variant="outline">
            <Icon name="eye" size={16} /> Preview
          </ButtonLink>
          {p.status === "PUBLISHED" && (
            <ButtonLink href={`/stays/${p.slug}`} variant="ghost">
              View live page
            </ButtonLink>
          )}
        </div>
      }
    >
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <Card className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} percent={checklist.percent} />
              {p.isDemo && <Badge tone="demo">Demo listing</Badge>}
            </div>
            <p className="mt-3 text-ink-soft">{status.help}</p>
            {p.rejectionReason && (p.status === "CHANGES_REQUESTED" || p.status === "REJECTED") && (
              <p className="mt-3 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
                <strong>Reviewer notes:</strong> {p.rejectionReason}
              </p>
            )}
            {p.status === "PUBLISHED" && <p className="mt-3 text-sm text-mist">Edits to a live listing are recorded for our review team.</p>}
            <div className="mt-5">
              <ListingActions propertyId={p.id} intents={intents} canSubmit={checklist.complete} />
            </div>
          </Card>

          <section aria-labelledby="checklist">
            <h2 id="checklist" className="mb-4 text-2xl">
              {p.status === "DRAFT" || p.status === "CHANGES_REQUESTED" ? "Before you submit" : "Listing details"}
            </h2>
            <Checklist sections={checklist.sections} hostIssues={checklist.hostIssues} propertyId={p.id} />
          </section>
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <p className="text-sm font-bold tracking-wider text-mist uppercase">Private address</p>
            <p className="mt-2">
              {p.addressLine1 ? (
                <>
                  {p.addressLine1}
                  {p.addressLine2 && <>, {p.addressLine2}</>}
                  <br />
                  {[p.locality, p.adminArea, p.postcode].filter(Boolean).join(" ")}
                </>
              ) : (
                <Link href={`/host/properties/${p.id}/edit/location`} className="font-semibold text-eucalypt-700 hover:underline">
                  Add the address
                </Link>
              )}
            </p>
            <p className="mt-2 text-xs text-mist">Only you and Roavela can see this. Guests see the suburb and an approximate area.</p>
          </Card>
          <Card className="p-5 text-sm text-ink-soft">
            <p className="font-semibold text-ink">What happens after you submit?</p>
            <p className="mt-1">Our team reviews every new listing, including the compliance details you provide. Your listing isn&apos;t visible to guests until it&apos;s approved.</p>
          </Card>
        </aside>
      </div>
    </HostShell>
  );
}
