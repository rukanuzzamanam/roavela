import type { Metadata } from "next";
import { PropertyCard } from "@/components/property/property-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/feedback";
import { parseSearchParams } from "@/lib/validation/search";
import { requirePermission } from "@/server/auth/guards";
import { prisma } from "@/server/db";
import { searchProperties } from "@/server/services/search";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const ROLE_LABEL = { CUSTOMER: "Traveller", HOST: "Host", ADMIN: "Administrator" } as const;

export default async function AccountPage() {
  const user = await requirePermission("account:manage", "/account");

  const [profile, favouriteIds] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { createdAt: true } }),
    prisma.favourite.findMany({ where: { userId: user.id }, select: { propertyId: true } }),
  ]);

  // Reuse the search pipeline so saved cards render identically to results (drive times, prices).
  const saved =
    favouriteIds.length > 0
      ? (
          await searchProperties(parseSearchParams({ adults: "1" }), {
            userId: user.id,
            propertyIds: favouriteIds.map((f) => f.propertyId),
          })
        ).results
      : [];

  return (
    <div className="container-page py-10">
      <h1 className="text-4xl">Hi, {user.name.split(" ")[0]}</h1>

      <Card className="mt-6 grid gap-4 p-6 sm:grid-cols-3">
        <div>
          <p className="text-sm text-mist">Email</p>
          <p className="font-semibold break-all">{user.email}</p>
        </div>
        <div>
          <p className="text-sm text-mist">Account type</p>
          <p className="font-semibold">{ROLE_LABEL[user.role]}</p>
        </div>
        <div>
          <p className="text-sm text-mist">Member since</p>
          <p className="font-semibold">{new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(profile.createdAt)}</p>
        </div>
      </Card>

      <section aria-labelledby="saved" className="mt-12">
        <h2 id="saved" className="mb-6 text-3xl">
          Saved stays
        </h2>
        {saved.length === 0 ? (
          <EmptyState
            icon="heart"
            title="Nothing saved yet"
            description="Tap the heart on any stay to keep it here for later."
            action={<ButtonLink href="/search">Find a stay</ButtonLink>}
          />
        ) : (
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((p) => (
              <li key={p.id}>
                <PropertyCard property={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="trips" className="mt-12">
        <h2 id="trips" className="mb-6 text-3xl">
          Your trips
        </h2>
        <EmptyState icon="calendar" title="No trips booked yet" description="Bookings you make will appear here." />
      </section>
    </div>
  );
}
