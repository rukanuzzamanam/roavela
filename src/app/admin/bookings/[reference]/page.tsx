import type { Metadata } from "next";
import type { ReactNode } from "react";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/admin/admin-forms";
import { AdminHeader, dateTime, day, DemoBadge, Facts, InlineLink, money, Notice, Section, StatusPill, TestModeBadge, Timeline } from "@/components/admin/admin-ui";
import { HistoryAndNotes } from "@/components/admin/history-and-notes";
import { Card } from "@/components/ui/feedback";
import { CANCELLATION_COPY } from "@/config/policies";
import { formatBps } from "@/lib/admin/commission";
import { actionLabel } from "@/lib/admin/labels";
import { BOOKING_STATUS_LABELS, houseRulesList, type HouseRulesSnapshot } from "@/lib/booking-lifecycle";
import { cancelBookingAction, declineRefundAction, executeRefundAction } from "@/server/actions/admin-operations";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAdminBooking } from "@/server/services/admin/bookings";

export const metadata: Metadata = { title: "Booking" };

export default async function AdminBookingPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  await requireAdmin("admin:bookings:view", `/admin/bookings/${reference}`);
  const data = await getAdminBooking(reference.toUpperCase());
  if (!data) notFound();
  const { booking: b, webhookEvents, history, notes, reconciliation: r, refund, cancelQuote } = data;
  const c = b.currency;
  const snapshot = (b.pricingSnapshot ?? {}) as { rulesVersion?: string; quotedAt?: string; feeSchedule?: { name?: string }; nightlyRates?: { date: string; cents: number }[] };
  // A fresh one-time key per render: a double-click or resubmitted form reuses it, so it can't refund twice.
  const refundKey = randomUUID();
  const cancelKey = randomUUID();

  const timeline = [
    { id: "created", at: b.createdAt, title: "Checkout hold created", detail: b.expiresAt ? `Hold until ${dateTime(b.expiresAt)}` : undefined },
    ...(b.confirmedAt ? [{ id: "confirmed", at: b.confirmedAt, title: "Payment verified — booking confirmed" }] : []),
    ...(b.cancelledAt ? [{ id: "cancelled", at: b.cancelledAt, title: "Cancelled", detail: b.cancellationReason ?? undefined }] : []),
    ...(b.completedAt ? [{ id: "completed", at: b.completedAt, title: "Stay completed" }] : []),
    ...webhookEvents.map((e) => ({ id: e.id, at: e.receivedAt, title: `${e.provider} event: ${e.eventType}`, detail: `${e.status.toLowerCase()} — ${e.message ?? ""}` })),
    ...b.refunds.map((x) => ({ id: x.id, at: x.createdAt, title: `Refund ${money(x.amountCents, x.currency)} requested (${x.reason.replaceAll("_", " ")})`, detail: `Provider status: ${x.status.toLowerCase()}${x.requestedBy ? ` · by ${x.requestedBy.name}` : ""}` })),
    ...history.filter((h) => h.source === "admin").map((h) => ({ id: h.id, at: h.createdAt, title: actionLabel(h.action), who: h.actorName, detail: h.reason ?? undefined })),
  ].sort((a, b2) => a.at.getTime() - b2.at.getTime());

  return (
    <>
      <AdminHeader
        eyebrow="Booking"
        title={b.reference}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={BOOKING_STATUS_LABELS[b.status].tone}>{BOOKING_STATUS_LABELS[b.status].label}</StatusPill>
            {b.isDemo && <DemoBadge />}
            <TestModeBadge />
          </span>
        }
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-10">
          <Section id="financials" title="Financial breakdown" description="From the booking's immutable price and commission snapshot — never recalculated from current prices or fees.">
            {r.issues.length > 0 ? (
              <div className="mb-3">
                <Notice tone="warning">
                  <strong>Flagged for investigation</strong> (nothing has been changed automatically):
                  <ul className="mt-1 list-disc pl-5">
                    {r.issues.map((i) => (
                      <li key={i.code}>
                        {i.message} {i.severity === "warning" && <em>(warning)</em>}
                      </li>
                    ))}
                  </ul>
                </Notice>
              </div>
            ) : (
              <p className="mb-3 text-sm font-semibold text-eucalypt-700">All financial checks pass for this booking.</p>
            )}
            <Card className="p-5">
              <Facts
                items={[
                  ["Accommodation", `${money(r.accommodationCents, c)} (${b.nights} nights)`],
                  ["Cleaning fee", money(r.cleaningFeeCents, c)],
                  ["Guest service fee", `${money(r.guestServiceFeeCents, c)} (${formatBps(b.guestServiceFeeBps)} of accommodation)`],
                  ["Guest total", money(r.guestTotalCents, c)],
                  ["Host commission", `${money(r.hostCommissionCents, c)} (${formatBps(b.hostCommissionBps)} of accommodation)`],
                  ["Platform gross revenue", `${money(r.platformGrossRevenueCents, c)} — not profit`],
                  ["Estimated host proceeds", `${money(r.estimatedHostProceedsCents, c)} — accrued; no payout made`],
                  ["Paid (captured)", money(r.paidCents, c)],
                  ["Refunded (provider-confirmed)", money(r.providerRefundedCents, c)],
                  ["Refunds in flight", money(r.refundsInFlightCents, c)],
                  ["Payment processing fee", r.processingFeeCents === null ? "Not reported by the provider" : money(r.processingFeeCents, c)],
                  ["Net platform amount", r.netPlatformCents === null ? "Not calculable (processing fee unknown or refunds made)" : money(r.netPlatformCents, c)],
                  ["Commission snapshot", `${snapshot.feeSchedule?.name ?? b.feeSchedule?.name ?? "—"} · rules ${snapshot.rulesVersion ?? "unknown"}`],
                  ["Quoted at", snapshot.quotedAt ? dateTime(new Date(snapshot.quotedAt)) : "—"],
                ]}
              />
              {snapshot.nightlyRates && snapshot.nightlyRates.length > 0 && (
                <p className="mt-4 text-sm text-ink-soft">Nightly rates: {snapshot.nightlyRates.map((n) => `${n.date} ${money(n.cents, c)}`).join(" · ")}</p>
              )}
            </Card>
          </Section>

          <Section id="payments" title="Payments & refunds" actions={<TestModeBadge />}>
            <div className="space-y-3">
              {b.payments.length === 0 && <p className="text-sm text-mist">{b.isDemo ? "Demo booking — no payment was taken." : "No payment has been started."}</p>}
              {b.payments.map((p) => (
                <Card key={p.id} className="p-4">
                  <Facts
                    items={[
                      ["Provider", `${p.provider}${p.provider === "mock" ? " (development simulator)" : " (test mode)"}`],
                      ["Provider payment id", <code key="id" className="text-xs break-all">{p.providerPaymentId ?? "—"}</code>],
                      ["Status", p.status.replaceAll("_", " ").toLowerCase()],
                      ["Amount", `${money(p.amountCents, p.currency)} ${p.currency}`],
                      ["Refunded", money(p.refundedCents, p.currency)],
                      ["Failure code", p.failureCode ?? "—"],
                      ["Created / updated", `${dateTime(p.createdAt)} / ${dateTime(p.updatedAt)}`],
                    ]}
                  />
                </Card>
              ))}
              {b.refunds.length > 0 && (
                <ul className="divide-y divide-ink/8 rounded-2xl border border-ink/10 bg-white text-sm">
                  {b.refunds.map((x) => (
                    <li key={x.id} className="flex flex-wrap justify-between gap-2 p-3">
                      <span>
                        <strong>{money(x.amountCents, x.currency)}</strong> · {x.reason.replaceAll("_", " ")} · {dateTime(x.createdAt)}
                        {x.requestedBy && <> · by {x.requestedBy.name}</>}
                      </span>
                      <span className="flex items-center gap-2">
                        <StatusPill tone={x.status === "SUCCEEDED" ? "success" : x.status === "PENDING" ? "warning" : "demo"}>Refund {x.status.toLowerCase()}</StatusPill>
                        {x.providerRefundId && <code className="text-xs">{x.providerRefundId}</code>}
                        {x.failureCode && <span className="text-xs text-red-800">{x.failureCode}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section id="timeline" title="Timeline">
            <Timeline entries={timeline} />
          </Section>

          <Section id="policy" title="Cancellation & house rules (as agreed)">
            <Card className="space-y-3 p-5 text-sm">
              <p>
                <strong>{b.cancellationPolicy ? CANCELLATION_COPY[b.cancellationPolicy].title : "No policy snapshot"}</strong>
                {b.cancellationPolicy && <> — {CANCELLATION_COPY[b.cancellationPolicy].body}</>}
              </p>
              {b.cancelledAt && (
                <Facts
                  items={[
                    ["Cancelled", dateTime(b.cancelledAt)],
                    ["Who / why", b.cancellationReason ?? "—"],
                    ["Refund due under the policy", money(b.refundDueCents, c)],
                    ["Actually refunded", money(r.providerRefundedCents, c)],
                  ]}
                />
              )}
              <p className="text-ink-soft">{houseRulesList(b.houseRulesSnapshot as HouseRulesSnapshot | null).join(" · ")}</p>
            </Card>
          </Section>

          <HistoryAndNotes history={history} notes={notes} targetType="Booking" targetId={b.id} path={`/admin/bookings/${b.reference}`} />
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Stay</h2>
            <Facts
              className="mt-2 sm:grid-cols-1"
              items={[
                ["Property", <InlineLink key="p" href={`/admin/properties/${b.property.id}`}>{b.property.title}</InlineLink>],
                ["Host", <InlineLink key="h" href={`/admin/hosts/${b.property.host.user.id}`}>{b.property.host.displayName}</InlineLink>],
                ["Customer", <InlineLink key="c" href={`/admin/customers/${b.guest.id}`}>{b.guest.name}</InlineLink>],
                ["Dates", `${day(b.checkIn)} → ${day(b.checkOut)} (${b.nights} nights)`],
                ["Guests", `${b.adults} adults, ${b.children} children`],
                ["Created", dateTime(b.createdAt)],
              ]}
            />
            {(b.guest.status !== "ACTIVE" || b.property.host.user.status !== "ACTIVE") && (
              <p className="mt-3 text-sm font-semibold text-red-800">{b.property.host.user.status !== "ACTIVE" ? "Host account suspended — " : "Customer account suspended — "}this booking may need handling.</p>
            )}
          </Card>

          {refund && (
            <Card className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 font-sans text-sm font-bold tracking-wider text-mist uppercase">
                Refunds <TestModeBadge />
              </h2>
              <Facts
                className="sm:grid-cols-1"
                items={[
                  ["Amount paid", money(refund.paidCents, c)],
                  ["Previously refunded", money(refund.providerRefundedCents, c)],
                  ["Refunds in flight", money(refund.inFlightCents, c)],
                  ["Maximum refundable now", <strong key="m">{money(refund.maxRefundableCents, c)}</strong>],
                  ...(b.status === "REFUND_PENDING" ? ([["Policy refund still owed", <strong key="o">{money(refund.outstandingPolicyCents, c)}</strong>]] as [string, ReactNode][]) : []),
                ]}
              />
              {refund.outstandingPolicyCents > 0 && (
                <ConfirmAction
                  action={executeRefundAction}
                  hidden={{ reference: b.reference, mode: "policy", requestKey: refundKey }}
                  tone="primary"
                  label={`Refund ${money(refund.outstandingPolicyCents, c)} owed`}
                  title={`Send a TEST refund of ${money(refund.outstandingPolicyCents, c)}?`}
                  description="The amount is recalculated on the server from the policy snapshot when you confirm. The booking shows as refunded only once the provider confirms."
                  confirmLabel="Confirm TEST refund"
                  fields={[{ type: "textarea", name: "reason", label: "Reason (recorded in the audit log)", required: true, rows: 2 }]}
                />
              )}
              {refund.maxRefundableCents > 0 && (
                <ConfirmAction
                  action={executeRefundAction}
                  hidden={{ reference: b.reference, mode: "custom", requestKey: refundKey }}
                  label="Issue another refund"
                  title="Issue a TEST refund"
                  description={`At most ${money(refund.maxRefundableCents, c)} (amount paid minus refunds already made or in flight). Checked again on the server.`}
                  confirmLabel="Confirm TEST refund"
                  fields={[
                    { type: "text", name: "amount", label: `Amount (${c})`, required: true, inputMode: "decimal", placeholder: "e.g. 120.50", maxLength: 12 },
                    { type: "textarea", name: "reason", label: "Reason (recorded in the audit log)", required: true, rows: 2 },
                  ]}
                />
              )}
              {b.status !== "REFUND_PENDING" && (
                <ConfirmAction
                  action={declineRefundAction}
                  hidden={{ reference: b.reference }}
                  label="Decline a refund request"
                  title="Record a declined refund request"
                  description="No money moves and the booking doesn't change — the decision and reason are recorded."
                  confirmLabel="Record decision"
                  fields={[{ type: "textarea", name: "reason", label: "Why the request is declined", required: true, rows: 2 }]}
                />
              )}
            </Card>
          )}

          {b.status === "CONFIRMED" && (
            <Card className="space-y-3 p-5">
              <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Cancel booking</h2>
              <p className="text-sm text-ink-soft">
                Under the policy snapshot, cancelling now refunds {cancelQuote ? money(cancelQuote.refundCents, c) : "nothing (the stay has started)"}.
              </p>
              <ConfirmAction
                action={cancelBookingAction}
                hidden={{ reference: b.reference, requestKey: cancelKey, version: b.updatedAt.toISOString() }}
                tone="danger"
                label="Cancel as Roavela"
                title="Cancel this booking?"
                description="The guest is notified. Any refund runs as a TEST refund and is only marked complete once the provider confirms."
                confirmLabel="Cancel booking"
                fields={[
                  {
                    type: "select",
                    name: "refundMode",
                    label: "Refund",
                    required: true,
                    options: [
                      { value: "full", label: "Full refund of the amount paid (Roavela-initiated)" },
                      { value: "policy", label: "Refund under the cancellation policy" },
                      { value: "none", label: "No refund" },
                    ],
                  },
                  { type: "textarea", name: "reason", label: "Reason (recorded and included in the cancellation)", required: true, rows: 2 },
                ]}
              />
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
