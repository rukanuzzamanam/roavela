import type { Metadata } from "next";
import Link from "next/link";
import { HostShell, StatusBadge } from "@/components/host/host-ui";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { formatStayDate } from "@/lib/dates";
import { pluralize } from "@/lib/utils";
import { requireHost } from "@/server/auth/host-guard";
import { getHostDashboard, listHostProperties } from "@/server/services/host-properties";

export const metadata: Metadata = { title: "Host dashboard", robots: { index: false } };

export default async function HostDashboardPage() {
  const user = await requireHost("/host");
  const [dashboard, properties] = await Promise.all([getHostDashboard(user.id), listHostProperties(user.id)]);
  const s = dashboard.byStatus;

  const metrics = [
    { label: "Properties", value: dashboard.total },
    { label: "Drafts", value: (s.DRAFT ?? 0) + (s.CHANGES_REQUESTED ?? 0) },
    { label: "Under review", value: s.PENDING_REVIEW ?? 0 },
    { label: "Live", value: s.PUBLISHED ?? 0 },
  ];
  const tasks = properties.flatMap((p) => {
    if (p.status === "CHANGES_REQUESTED") return [{ id: p.id, text: `${p.title}: a reviewer requested changes`, href: `/host/properties/${p.id}` }];
    if (p.status === "DRAFT" && p.readyToSubmit) return [{ id: p.id, text: `${p.title} is ready to submit for review`, href: `/host/properties/${p.id}` }];
    if (p.status === "DRAFT") return [{ id: p.id, text: `Finish ${p.title} (${p.percent}% complete)`, href: `/host/properties/${p.id}` }];
    return [];
  });

  return (
    <HostShell current="/host" eyebrow="Host portal" title={`Welcome, ${user.name.split(" ")[0]}`} actions={<ButtonLink href="/host/properties/new">Add a property</ButtonLink>}>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label} className="p-5">
            <dt className="text-sm text-mist">{m.label}</dt>
            <dd className="mt-1 font-display text-4xl">{m.value}</dd>
          </Card>
        ))}
      </dl>

      {tasks.length > 0 && (
        <section aria-labelledby="tasks" className="mt-10">
          <h2 id="tasks" className="mb-4 text-2xl">
            Needs your attention
          </h2>
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 font-semibold hover:border-eucalypt-600">
                  {t.text}
                  <Icon name="chevronRight" size={18} className="shrink-0 text-mist" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="your-properties" className="mt-10">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="your-properties" className="text-2xl">
            Your properties
          </h2>
          {properties.length > 0 && (
            <Link href="/host/properties" className="text-sm font-semibold text-eucalypt-700 hover:underline">
              Manage all
            </Link>
          )}
        </div>
        {properties.length === 0 ? (
          <EmptyState icon="home" title="No properties yet" description="Create your first listing — you can save your progress and finish it later." action={<ButtonLink href="/host/properties/new">Add a property</ButtonLink>} />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {properties.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link href={`/host/properties/${p.id}`} className="block overflow-hidden rounded-2xl border border-ink/10 bg-white hover:border-eucalypt-600">
                  <PropertyImage src={p.images[0]?.url ?? null} alt="" className="aspect-[16/9]" sizes="(min-width: 1024px) 30vw, 90vw" />
                  <div className="space-y-2 p-4">
                    <p className="font-display text-xl leading-tight">{p.title}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={p.status} percent={p.percent} />
                      {p.isDemo && <Badge tone="demo">Demo</Badge>}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="upcoming">
          <h2 id="upcoming" className="mb-4 text-2xl">
            Upcoming bookings
          </h2>
          {dashboard.upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="No upcoming bookings" description="Online booking is coming soon. Confirmed stays will appear here." />
          ) : (
            <Card className="divide-y divide-ink/10">
              {dashboard.upcoming.map((b) => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <p className="font-semibold">{b.property.title}</p>
                    <p className="text-sm text-mist">
                      {formatStayDate(b.checkIn)} → {formatStayDate(b.checkOut)} · {pluralize(b.adults + b.children, "guest")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Badge tone={b.status === "CONFIRMED" ? "success" : "neutral"}>{b.status === "CONFIRMED" ? "Confirmed" : "Pending"}</Badge>
                    {b.isDemo && <Badge tone="demo">Demo data</Badge>}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
        <section aria-labelledby="earnings">
          <h2 id="earnings" className="mb-4 text-2xl">
            Earnings
          </h2>
          <EmptyState icon="shield" title="Earnings reporting is on its way" description="Payouts and earnings reports arrive with online payments. Use the pricing step to see an estimate per stay." />
        </section>
      </div>
    </HostShell>
  );
}
