import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountActions } from "@/components/admin/account-actions";
import { AdminHeader, AdminTable, dateTime, day, DemoBadge, Facts, InlineLink, money, Notice, Section, StatusPill } from "@/components/admin/admin-ui";
import { HistoryAndNotes } from "@/components/admin/history-and-notes";
import { Card } from "@/components/ui/feedback";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS } from "@/lib/admin/compliance";
import { STATUS_LABELS } from "@/lib/listing-lifecycle";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAdminHost } from "@/server/services/admin/users";

export const metadata: Metadata = { title: "Host" };

export default async function AdminHostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin("admin:users:manage", `/admin/hosts/${id}`);
  const data = await getAdminHost(id);
  if (!data) notFound();
  const { user: u, bookingCounts, upcoming, issues, history, notes } = data;
  const hp = u.hostProfile;

  return (
    <>
      <AdminHeader
        eyebrow="Host"
        title={hp?.displayName ?? u.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={u.status === "ACTIVE" ? "success" : "demo"}>Account {u.status.toLowerCase()}</StatusPill>
            {u.isDemo && <DemoBadge />}
          </span>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-10">
          {issues.length > 0 && (
            <Notice tone="warning">
              <strong>Needs review</strong>
              <ul className="mt-1 list-disc pl-5">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </Notice>
          )}

          <Section id="listings" title="Listings">
            <AdminTable
              caption="Host listings"
              columns={[{ label: "Listing" }, { label: "Status" }, { label: "Updated" }]}
              rows={(hp?.properties ?? []).map((p) => ({
                key: p.id,
                cells: [
                  <div key="t">
                    <InlineLink href={`/admin/properties/${p.id}`}>{p.title}</InlineLink>
                    {p.isDemo && <DemoBadge />}
                  </div>,
                  <StatusPill key="s" tone={STATUS_LABELS[p.status].tone}>
                    {STATUS_LABELS[p.status].label}
                  </StatusPill>,
                  <span key="u">{dateTime(p.updatedAt)}</span>,
                ],
              }))}
              empty={<p className="text-sm text-mist">No listings yet.</p>}
            />
          </Section>

          <Section id="compliance" title="Compliance records">
            {(hp?.complianceDocuments.length ?? 0) === 0 ? (
              <p className="text-sm text-mist">No compliance information submitted.</p>
            ) : (
              <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white text-sm">
                {hp!.complianceDocuments.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>
                      {COMPLIANCE_TYPE_LABELS[d.type]}
                      {d.expiresAt && <span className="text-mist"> · expires {day(d.expiresAt)}</span>}
                    </span>
                    <StatusPill tone={COMPLIANCE_STATUS_LABELS[d.status].tone}>{COMPLIANCE_STATUS_LABELS[d.status].label}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="bookings" title="Bookings">
            <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {Object.entries(bookingCounts).map(([s, n]) => (
                <div key={s}>
                  <dt className="inline text-mist">{s.replaceAll("_", " ").toLowerCase()}: </dt>
                  <dd className="inline font-semibold">{n}</dd>
                </div>
              ))}
              {Object.keys(bookingCounts).length === 0 && <p className="text-mist">No bookings yet.</p>}
            </dl>
            {upcoming.length > 0 && (
              <>
                <h3 className="mb-2 font-sans text-sm font-bold">Upcoming confirmed stays</h3>
                <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white text-sm">
                  {upcoming.map((b) => (
                    <li key={b.reference} className="flex flex-wrap justify-between gap-2 p-3">
                      <span>
                        <InlineLink href={`/admin/bookings/${b.reference}`}>{b.reference}</InlineLink> · {b.property.title}
                      </span>
                      <span className="text-mist">
                        {day(b.checkIn)} → {day(b.checkOut)} · {money(b.totalCents, b.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <HistoryAndNotes history={history} notes={notes} targetType="User" targetId={u.id} path={`/admin/hosts/${u.id}`} />
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Profile</h2>
            <Facts
              className="mt-2 sm:grid-cols-1"
              items={[
                ["Name", u.name],
                ["Email", <span key="e" className="break-all">{u.email}</span>],
                ["Phone", u.phone ?? hp?.phone ?? "—"],
                ["Host type", hp?.hostType.toLowerCase() ?? "—"],
                ["Legal / business name", hp?.businessName ?? hp?.legalName ?? "—"],
                ["ABN", hp?.abn ?? "—"],
                ["Onboarding", hp?.onboardingStatus.replaceAll("_", " ").toLowerCase() ?? "not started"],
                ["Payouts", "Not enabled (estimates only)"],
                ["Joined", day(u.createdAt)],
                ["Last login", dateTime(u.lastLoginAt)],
              ]}
            />
          </Card>
          <Card className="space-y-3 p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Account status</h2>
            <AccountActions userId={u.id} status={u.status} version={u.updatedAt.toISOString()} kind="host" />
          </Card>
        </aside>
      </div>
    </>
  );
}
