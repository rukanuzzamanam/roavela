import type { Metadata } from "next";
import { z } from "zod";
import { PropertyCard } from "@/components/property/property-card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { pluralize } from "@/lib/utils";
import { parseSearchParams } from "@/lib/validation/search";
import { requirePermission } from "@/server/auth/guards";
import { listFavouritePage } from "@/server/services/favourites";
import { searchProperties } from "@/server/services/search";

export const metadata: Metadata = { title: "Saved stays", robots: { index: false } };

const PAGE_SIZE = 12;

export default async function SavedPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requirePermission("favourite:manage", "/saved");
  const page = z.coerce.number().int().min(1).max(500).catch(1).parse((await searchParams).page ?? 1);

  const { total, totalPages, propertyIds } = await listFavouritePage(user.id, page, PAGE_SIZE);
  // Reuse the search pipeline so cards match search results exactly (drive time, prices, demo
  // flags). Only publicly visible stays render; saved stays that were unpublished drop out.
  const cards = propertyIds.length
    ? (await searchProperties(parseSearchParams({ adults: "1" }), { userId: user.id, propertyIds, pageSize: PAGE_SIZE })).results
    : [];
  const order = new Map(propertyIds.map((id, i) => [id, i]));
  cards.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const unavailable = propertyIds.length - cards.length;

  return (
    <div className="container-page py-10">
      <h1 className="text-4xl">Saved stays</h1>
      <p className="mt-2 text-mist">{total > 0 ? `${pluralize(total, "stay")} saved` : "Keep track of places you'd like to go."}</p>

      {total === 0 ? (
        <EmptyState
          className="mt-8"
          icon="heart"
          title="No saved stays yet"
          description="Tap the heart on any stay to save it here for later."
          action={<ButtonLink href="/search">Find a stay</ButtonLink>}
        />
      ) : (
        <>
          <ul className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((p) => (
              <li key={p.id}>
                <PropertyCard property={p} />
              </li>
            ))}
          </ul>
          {unavailable > 0 && (
            <p className="mt-8 rounded-2xl bg-sand-100 p-4 text-sm text-ink-soft">
              {pluralize(unavailable, "saved stay")} on this page {unavailable === 1 ? "is" : "are"} no longer available.
            </p>
          )}
          <Pagination className="mt-12" page={Math.min(page, totalPages)} totalPages={totalPages} hrefFor={(p) => (p > 1 ? `/saved?page=${p}` : "/saved")} />
        </>
      )}
    </div>
  );
}
