import type { Metadata } from "next";
import { ConfirmAction } from "@/components/admin/admin-forms";
import { AdminHeader, dateTime, DemoBadge, FilterTabs, InlineLink, Notice, ResultCount, SearchForm, StatusPill } from "@/components/admin/admin-ui";
import { Card, EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { ADMIN_PAGE_SIZE, listHref, oneOf, pageCount, parsePage, parseQuery, type RawParams } from "@/lib/admin/query";
import { moderateReviewAction } from "@/server/actions/admin-listings";
import { requireAdmin } from "@/server/auth/admin-guard";
import { moderationTransition, type ModerationDecision } from "@/lib/admin/moderation";
import { listAdminReviews, REVIEW_FILTERS } from "@/server/services/admin/reviews";

export const metadata: Metadata = { title: "Reviews" };

const LABELS: Record<(typeof REVIEW_FILTERS)[number], string> = { flagged: "Flagged", published: "Published", hidden: "Hidden", removed: "Removed", all: "All" };
const DECISIONS: { decision: ModerationDecision; label: string; tone: "outline" | "danger" }[] = [
  { decision: "keep", label: "Keep (publish)", tone: "outline" },
  { decision: "restore", label: "Restore", tone: "outline" },
  { decision: "hide", label: "Hide", tone: "outline" },
  { decision: "remove", label: "Remove (policy violation)", tone: "danger" },
];

export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  await requireAdmin("admin:reviews:moderate", "/admin/reviews");
  const sp = await searchParams;
  const filter = oneOf(sp, "filter", REVIEW_FILTERS) ?? "flagged";
  const q = parseQuery(sp);
  const page = parsePage(sp);
  const { total, rows } = await listAdminReviews({ filter, q, page });

  return (
    <>
      <AdminHeader eyebrow="Admin" title="Review moderation" />
      <div className="mb-4">
        <Notice>Reviews can only be written by guests with a completed booking. Admins can keep, hide or remove a review — never edit its text or ratings, or create one. The original is always preserved.</Notice>
      </div>
      <FilterTabs label="Review status" items={REVIEW_FILTERS.map((f) => ({ href: listHref("/admin/reviews", { q }, { filter: f }), label: LABELS[f], active: f === filter }))} />
      <SearchForm action="/admin/reviews" q={q} placeholder="Property, author or review text" hidden={{ filter }} />
      <ResultCount total={total} page={page} pageSize={ADMIN_PAGE_SIZE} noun="reviews" />
      {rows.length === 0 ? (
        <EmptyState icon="star" title={filter === "flagged" ? "No reviews are flagged for moderation" : "No reviews match"} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    <InlineLink href={`/admin/properties/${r.property.id}`}>{r.property.title}</InlineLink> · {r.overallRating}/5 by {r.author.name}
                  </p>
                  <span className="flex items-center gap-2">
                    <StatusPill tone={r.status === "PUBLISHED" ? "success" : r.status === "FLAGGED" ? "warning" : "demo"}>{r.status.toLowerCase()}</StatusPill>
                    {r.isDemo && <DemoBadge />}
                  </span>
                </div>
                <blockquote className="border-l-4 border-sand-200 pl-3 whitespace-pre-line text-ink-soft">{r.body}</blockquote>
                <p className="text-xs text-mist">
                  Booking <InlineLink href={`/admin/bookings/${r.booking.reference}`}>{r.booking.reference}</InlineLink> ({r.booking.status.toLowerCase()}) · {dateTime(r.createdAt)}
                </p>
                {r.moderatedAt && (
                  <p className="text-xs text-mist">
                    Last moderated {dateTime(r.moderatedAt)} by {r.moderatedBy?.name ?? "—"}: {r.moderationReason}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {DECISIONS.filter((d) => moderationTransition(d.decision, r.status)).map((d) => (
                    <ConfirmAction
                      key={d.decision}
                      action={moderateReviewAction}
                      hidden={{ reviewId: r.id, decision: d.decision, version: r.updatedAt.toISOString() }}
                      tone={d.tone}
                      label={d.label}
                      title={`${d.label}?`}
                      description="Only the review's visibility changes. Its text and ratings are never edited."
                      confirmLabel={d.label}
                      fields={[{ type: "textarea", name: "reason", label: "Moderation reason (internal)", required: true, rows: 2 }]}
                    />
                  ))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination className="mt-6" page={page} totalPages={pageCount(total)} hrefFor={(n) => listHref("/admin/reviews", { filter, q }, { page: n })} />
    </>
  );
}
