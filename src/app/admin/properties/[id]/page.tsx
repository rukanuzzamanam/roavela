import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ConfirmAction, SimpleForm } from "@/components/admin/admin-forms";
import { AdminHeader, day, dateTime, DemoBadge, Facts, InlineLink, money, Notice, Section, StatusPill } from "@/components/admin/admin-ui";
import { HistoryAndNotes } from "@/components/admin/history-and-notes";
import { PropertyImage } from "@/components/property/property-image";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/feedback";
import { CANCELLATION_COPY } from "@/config/policies";
import { COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS, documentFlags } from "@/lib/admin/compliance";
import { ADMIN_TIMEZONE } from "@/lib/admin/ranges";
import { todayInTimeZone } from "@/lib/dates";
import { STATUS_LABELS } from "@/lib/listing-lifecycle";
import { decideListingAction, reviewComplianceAction, startReviewAction } from "@/server/actions/admin-listings";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAdminProperty } from "@/server/services/admin/properties";
import { REVIEW_CATEGORIES } from "@/server/services/listing-review";

export const metadata: Metadata = { title: "Review property" };

const CATEGORY_OPTIONS = Object.entries(REVIEW_CATEGORIES).map(([value, label]) => ({ value, label }));
const yesNo = (v: boolean) => (v ? "Yes" : "No");

export default async function AdminPropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin("admin:properties:moderate", `/admin/properties/${id}`);
  const data = await getAdminProperty(id);
  if (!data) notFound();
  const { property: p, checklist, jurisdiction, jurisdictionRules, complianceFlags, history, notes } = data;
  const path = `/admin/properties/${p.id}`;
  const version = p.updatedAt.toISOString();
  const hidden = { propertyId: p.id, version };
  const hostSuspended = p.host.user.status !== "ACTIVE";
  const today = todayInTimeZone(ADMIN_TIMEZONE);
  const statusLabel = p.status === "PENDING_REVIEW" ? (p.reviewStartedAt ? "Under review" : "Pending review") : STATUS_LABELS[p.status].label;

  return (
    <>
      <AdminHeader
        eyebrow="Property review"
        title={p.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={STATUS_LABELS[p.status].tone}>{statusLabel}</StatusPill>
            {p.isDemo && <DemoBadge />}
            <span className="text-sm text-mist">
              Submitted {dateTime(p.submittedAt)}
              {p.reviewStartedBy && <> · review started by {p.reviewStartedBy.name}</>}
            </span>
          </span>
        }
        actions={p.status === "PUBLISHED" ? <ButtonLink href={`/stays/${p.slug}`} variant="outline">View public page</ButtonLink> : undefined}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-10">
          {/* ── Decision ── */}
          <Card className="space-y-4 p-5">
            <h2 className="text-2xl">Decision</h2>
            {hostSuspended && <Notice tone="warning">The host&apos;s account is suspended. This listing can&apos;t be approved or reinstated until the account is reactivated.</Notice>}
            {p.rejectionReason && (p.status === "CHANGES_REQUESTED" || p.status === "REJECTED") && (
              <p className="rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
                <strong>Message shown to the host:</strong> {p.rejectionReason}
              </p>
            )}
            {p.status === "PENDING_REVIEW" && (
              <>
                {!p.reviewStartedAt && <SimpleForm action={startReviewAction} hidden={{ propertyId: p.id }} fields={[]} submitLabel="Start review (mark as under review)" />}
                {checklist && !checklist.complete && <Notice tone="warning">The listing checklist is no longer complete: {[...checklist.hostIssues, ...checklist.sections.flatMap((s) => s.issues)].slice(0, 3).join("; ")}.</Notice>}
                <div className="flex flex-col gap-3">
                  <ConfirmAction
                    action={decideListingAction}
                    hidden={{ ...hidden, decision: "approve" }}
                    tone="primary"
                    label="Approve and publish"
                    title="Approve this listing?"
                    description="It becomes publicly visible and bookable immediately, and the host is notified."
                    confirmLabel="Approve and publish"
                    disabled={hostSuspended}
                    fields={[
                      { type: "checkbox", name: "complianceReviewed", label: "I have reviewed the listing details, photos and the compliance information provided by the host.", required: true },
                      { type: "textarea", name: "internalNote", label: "Internal note (optional, admins only)", rows: 2 },
                    ]}
                  />
                  <ConfirmAction
                    action={decideListingAction}
                    hidden={{ ...hidden, decision: "request_changes" }}
                    label="Request changes"
                    title="Return the listing to the host"
                    description="The host sees the category and your message, then can update and resubmit."
                    confirmLabel="Send to host"
                    fields={[
                      { type: "select", name: "category", label: "What needs changing", options: CATEGORY_OPTIONS, required: true },
                      { type: "textarea", name: "reason", label: "Message to the host", required: true, hint: "Shown to the host and emailed. Be specific." },
                      { type: "textarea", name: "internalNote", label: "Internal note (optional, admins only)", rows: 2 },
                    ]}
                  />
                  <ConfirmAction
                    action={decideListingAction}
                    hidden={{ ...hidden, decision: "reject" }}
                    tone="danger"
                    label="Reject listing"
                    title="Reject this listing?"
                    description="The listing is kept (never deleted) with its history, but can't be published. The host is notified."
                    confirmLabel="Reject listing"
                    fields={[
                      { type: "select", name: "category", label: "Reason", options: CATEGORY_OPTIONS, required: true },
                      { type: "textarea", name: "reason", label: "Explanation for the host", required: true, hint: "Shown to the host and emailed." },
                      { type: "textarea", name: "internalNote", label: "Internal note (optional, admins only)", rows: 2 },
                    ]}
                  />
                </div>
              </>
            )}
            {(p.status === "PUBLISHED" || p.status === "PAUSED") && (
              <ConfirmAction
                action={decideListingAction}
                hidden={{ ...hidden, decision: "suspend" }}
                tone="danger"
                label="Suspend listing"
                title="Suspend this listing?"
                description="It is hidden from search and can't be booked. Existing confirmed bookings are NOT cancelled — handle them from the booking pages."
                confirmLabel="Suspend listing"
                fields={[
                  { type: "textarea", name: "reason", label: "Reason (sent to the host)", required: true },
                  { type: "textarea", name: "internalNote", label: "Internal note (optional, admins only)", rows: 2 },
                ]}
              />
            )}
            {p.status === "SUSPENDED" && (
              <ConfirmAction
                action={decideListingAction}
                hidden={{ ...hidden, decision: "reinstate" }}
                label="Reinstate listing"
                title="Reinstate this listing?"
                description="It returns as paused; the host decides when to make it live again."
                confirmLabel="Reinstate as paused"
                disabled={hostSuspended}
                fields={[{ type: "textarea", name: "reason", label: "Reason (recorded in the audit log)", required: true }]}
              />
            )}
            {["DRAFT", "CHANGES_REQUESTED", "REJECTED", "ARCHIVED"].includes(p.status) && <p className="text-sm text-mist">No admin decision is available while the listing is {statusLabel.toLowerCase()}.</p>}
          </Card>

          {/* ── Listing ── */}
          <Section id="listing" title="Listing details">
            <Card className="space-y-6 p-5">
              <Facts
                items={[
                  ["Type", p.type.replaceAll("_", " ").toLowerCase()],
                  ["Guests", p.maxGuests],
                  ["Bedrooms / beds", `${p.bedrooms} / ${p.beds}`],
                  ["Bathrooms", p.bathrooms],
                  ["Destination", p.destination?.name ?? "—"],
                  ["Instant book", yesNo(p.instantBook)],
                ]}
              />
              <div>
                <h3 className="font-sans text-sm font-bold">Summary</h3>
                <p className="mt-1 text-ink-soft">{p.summary ?? "—"}</p>
                <h3 className="mt-4 font-sans text-sm font-bold">Description</h3>
                <p className="mt-1 whitespace-pre-line text-ink-soft">{p.description ?? "—"}</p>
              </div>
              <div>
                <h3 className="font-sans text-sm font-bold">Amenities</h3>
                <p className="mt-1 text-ink-soft">{p.amenities.length ? p.amenities.map((a) => a.amenity.label).join(" · ") : "None listed"}</p>
              </div>
            </Card>
          </Section>

          <Section id="photos" title={`Photos (${p.images.length})`}>
            {p.images.length === 0 ? (
              <p className="text-sm text-mist">No photos uploaded.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {p.images.map((img) => (
                  <li key={img.id}>
                    <PropertyImage src={img.url} alt={img.alt} className="aspect-[4/3] rounded-xl" sizes="(min-width: 640px) 30vw, 45vw" />
                    <p className="mt-1 text-xs text-mist">{img.alt}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="pricing" title="Pricing, availability & rules">
            <Card className="space-y-6 p-5">
              <Facts
                items={[
                  ["Nightly price", money(p.nightlyPriceCents, p.currency)],
                  ["Weekend price (Fri/Sat)", money(p.weekendPriceCents, p.currency)],
                  ["Cleaning fee", money(p.cleaningFeeCents, p.currency)],
                  ["Stay length", `${p.minNights}${p.maxNights ? `–${p.maxNights}` : "+"} nights`],
                  ["Check-in / out", `${p.checkInTime} / ${p.checkOutTime}`],
                  ["Smoking · pets · events", `${yesNo(p.smokingAllowed)} · ${yesNo(p.petsAllowed)} · ${yesNo(p.eventsAllowed)}`],
                  ["Quiet hours", p.quietHoursStart && p.quietHoursEnd ? `${p.quietHoursStart}–${p.quietHoursEnd}` : "—"],
                  ["Cancellation policy", `${CANCELLATION_COPY[p.cancellationPolicy].title} — ${CANCELLATION_COPY[p.cancellationPolicy].body}`],
                ]}
              />
              {p.houseRules && (
                <div>
                  <h3 className="font-sans text-sm font-bold">Additional house rules</h3>
                  <p className="mt-1 whitespace-pre-line text-ink-soft">{p.houseRules}</p>
                </div>
              )}
              <div>
                <h3 className="font-sans text-sm font-bold">Blocked dates (next 6 months)</h3>
                <p className="mt-1 text-sm text-ink-soft">{p.blockedDates.length ? p.blockedDates.map((b) => `${day(b.startDate)} → ${day(b.endDate)}`).join(" · ") : "None — all dates open (subject to bookings)."}</p>
              </div>
            </Card>
          </Section>

          <Section id="location" title="Location">
            <Card className="p-5">
              <Facts
                items={[
                  ["Public location", [p.locality, p.adminArea, p.countryCode].filter(Boolean).join(", ") || "—"],
                  ["Coordinates", p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : "Not set — destination centre shown as approximate"],
                  ["Private address (admin only)", [p.addressLine1, p.addressLine2, [p.locality, p.adminArea, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"],
                  ["Timezone", p.timezone],
                ]}
              />
            </Card>
          </Section>

          {/* ── Compliance ── */}
          <Section id="compliance" title="Compliance information" description={`Jurisdiction: ${jurisdictionRules?.name ?? jurisdiction ?? "unknown"}. Reviewing records the information provided by the host — it is not a legal verification by Roavela.`}>
            {complianceFlags.length > 0 && (
              <div className="mb-3">
                <Notice tone="warning">Needs review: {complianceFlags.map((f) => f.label).join(" · ")}</Notice>
              </div>
            )}
            {p.compliance.length === 0 ? (
              <p className="text-sm text-mist">The host hasn&apos;t provided compliance information.</p>
            ) : (
              <ul className="space-y-3">
                {p.compliance.map((doc) => {
                  const d = (doc.data ?? {}) as Record<string, unknown>;
                  const flags = documentFlags(doc, today);
                  const docHidden = { documentId: doc.id, version: doc.updatedAt.toISOString(), path };
                  const facts: [string, ReactNode][] = [["Status", <StatusPill key="s" tone={COMPLIANCE_STATUS_LABELS[doc.status].tone}>{COMPLIANCE_STATUS_LABELS[doc.status].label}</StatusPill>]];
                  if (doc.type === "SHORT_TERM_RENTAL_REGISTRATION") {
                    facts.push(["Registration number", doc.referenceNumber ?? "—"], ["Expiry", doc.expiresAt ? day(doc.expiresAt) : "No expiry recorded"]);
                    if (d.exemptionDeclared === true) facts.push(["Exemption declared", String(d.exemptionReason ?? "Yes")]);
                  }
                  if (doc.type === "INSURANCE") facts.push(["Insurance confirmed", yesNo(d.confirmed === true)], ["Insurer", String(d.insurerName ?? "—")]);
                  if (doc.type === "AUTHORITY_TO_LIST") facts.push(["Authority confirmed", yesNo(d.confirmed === true)], ["Relationship", String(d.ownershipStatus ?? "—").replaceAll("_", " ").toLowerCase()]);
                  if (doc.type === "LOCAL_COMPLIANCE_ACKNOWLEDGEMENT") {
                    facts.push(
                      ["Local obligations acknowledged", yesNo(d.obligationsAcknowledged === true)],
                      ["Planning/local restrictions acknowledged", yesNo(d.planningAcknowledged === true)],
                      ["Strata / body corporate", String(d.strataScheme ?? "—").toLowerCase()],
                    );
                    if (d.strataScheme === "YES") facts.push(["Strata permission confirmed", yesNo(d.strataPermissionConfirmed === true)]);
                  }
                  facts.push(["Submitted", dateTime(doc.submittedAt)]);
                  if (doc.reviewedAt) facts.push(["Last reviewed", `${dateTime(doc.reviewedAt)}${doc.reviewedBy ? ` by ${doc.reviewedBy.name}` : ""}`]);
                  return (
                    <li key={doc.id}>
                      <Card className="space-y-3 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-sans text-base font-bold">{COMPLIANCE_TYPE_LABELS[doc.type]}</h3>
                          {doc.fileKey ? (
                            <a href={`/host/compliance/${doc.id}/file`} className="text-sm font-semibold text-eucalypt-700 hover:underline" rel="noreferrer">
                              Download private document
                            </a>
                          ) : (
                            <span className="text-xs text-mist">No document attached</span>
                          )}
                        </div>
                        <Facts items={facts} />
                        {flags.length > 0 && <p className="text-sm font-semibold text-ochre-700">Needs review: {flags.map((f) => f.label).join(" · ")}</p>}
                        {doc.reviewNote && <p className="text-sm text-ink-soft">Note to host: {doc.reviewNote}</p>}
                        <div className="flex flex-wrap gap-2">
                          {doc.status === "SUBMITTED" && <SimpleForm action={reviewComplianceAction} hidden={{ ...docHidden, decision: "start" }} fields={[]} submitLabel="Start review" />}
                          {(doc.status === "SUBMITTED" || doc.status === "UNDER_REVIEW") && (
                            <>
                              <ConfirmAction
                                action={reviewComplianceAction}
                                hidden={{ ...docHidden, decision: "approve" }}
                                label="Mark information reviewed"
                                title="Mark this compliance information as reviewed?"
                                description="This records that an admin reviewed what the host provided. It is not a legal verification."
                                confirmLabel="Mark reviewed"
                                fields={[{ type: "textarea", name: "note", label: "Note to the host (optional)", rows: 2 }]}
                              />
                              <ConfirmAction
                                action={reviewComplianceAction}
                                hidden={{ ...docHidden, decision: "reject" }}
                                tone="danger"
                                label="Needs correction"
                                title="Return this record to the host?"
                                confirmLabel="Return to host"
                                fields={[{ type: "textarea", name: "note", label: "What needs correcting (shown to the host)", required: true }]}
                              />
                            </>
                          )}
                          {flags.some((f) => f.code === "expired") && doc.status !== "EXPIRED" && (
                            <ConfirmAction action={reviewComplianceAction} hidden={{ ...docHidden, decision: "expire" }} label="Mark expired" title="Mark this record as expired?" confirmLabel="Mark expired" fields={[{ type: "textarea", name: "note", label: "Note to the host (optional)", rows: 2 }]} />
                          )}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <HistoryAndNotes history={history} notes={notes} targetType="Property" targetId={p.id} path={path} />
        </div>

        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Host</h2>
            <p className="mt-2 font-semibold">{p.host.displayName}</p>
            <p className="text-sm text-ink-soft">{p.host.user.name}</p>
            <p className="text-sm break-all text-ink-soft">{p.host.user.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusPill tone={p.host.user.status === "ACTIVE" ? "success" : "demo"}>Account {p.host.user.status.toLowerCase()}</StatusPill>
            </div>
            <Facts
              className="mt-4 sm:grid-cols-1"
              items={[
                ["Host type", p.host.hostType.toLowerCase()],
                ["Legal / business name", p.host.businessName ?? p.host.legalName ?? "—"],
                ["ABN", p.host.abn ?? "—"],
                ["Listings", p.host._count.properties],
                ["Joined", day(p.host.user.createdAt)],
              ]}
            />
            <p className="mt-4">
              <InlineLink href={`/admin/hosts/${p.host.user.id}`}>Open host record</InlineLink>
            </p>
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Activity</h2>
            <Facts
              className="mt-2 sm:grid-cols-1"
              items={[
                ["Confirmed / completed bookings", p._count.bookings],
                ["Created", dateTime(p.createdAt)],
                ["Last reviewed", dateTime(p.reviewedAt)],
                ["Published", dateTime(p.publishedAt)],
              ]}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}
