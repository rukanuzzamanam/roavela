import type { Metadata } from "next";
import Link from "next/link";
import { PropertyCard } from "@/components/property/property-card";
import { ButtonLink } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/feedback";
import { BOOKING_STATUS_LABELS } from "@/lib/booking-lifecycle";
import { formatStayDate } from "@/lib/dates";
import { pluralize } from "@/lib/utils";
import { parseSearchParams } from "@/lib/validation/search";
import { requirePermission } from "@/server/auth/guards";
import { prisma } from "@/server/db";
import { listFavouritePage } from "@/server/services/favourites";
import { searchProperties } from "@/server/services/search";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const ROLE_LABEL = { CUSTOMER: "Traveller", HOST: "Host", ADMIN: "Administrator" } as const;

export default async function AccountPage() {
  const session = await requirePermission("account:manage", "/account");

  const [profile, saved, trips] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true, createdAt: true } }),
    listFavouritePage(session.id, 1, 3),
    prisma.booking.findMany({
      where: { guestId: session.id },
      orderBy: { checkIn: "desc" },
      take: 5,
      select: { id: true, reference: true, status: true, checkIn: true, checkOut: true, isDemo: true, property: { select: { title: true, slug: true } } },
    }),
  ]);
  const savedCards = saved.propertyIds.length
    ? (await searchProperties(parseSearchParams({ adults: "1" }), { userId: session.id, propertyIds: saved.propertyIds, pageSize: 3 })).results
    : [];

  return (
    <div className="container-page py-10">
      <h1 className="text-4xl">Hi, {profile.name.split(" ")[0]}</h1>

      <section aria-labelledby="profile-heading" className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="profile-heading" className="text-2xl">
            Profile
          </h2>
          <ButtonLink href="/account/profile" variant="outline" size="sm">
            Edit profile
          </ButtonLink>
        </div>
        <Card className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name" value={profile.name} />
          <Field label="Email" value={profile.email} />
          <Field label="Phone" value={profile.phone ?? "Not added"} muted={!profile.phone} />
          <Field label="Member since" value={`${new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(profile.createdAt)} · ${ROLE_LABEL[session.role]}`} />
        </Card>
        <p className="mt-3 text-sm text-mist">
          Forgotten your password? You can{" "}
          <Link href="/forgot-password" className="font-semibold text-eucalypt-700 hover:underline">
            reset it by email
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="saved-heading" className="mt-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 id="saved-heading" className="text-2xl">
            Saved stays {saved.total > 0 && <span className="font-sans text-base text-mist">({saved.total})</span>}
          </h2>
          {saved.total > 0 && (
            <ButtonLink href="/saved" variant="ghost" size="sm">
              View all
            </ButtonLink>
          )}
        </div>
        {savedCards.length === 0 ? (
          <EmptyState icon="heart" title="Nothing saved yet" description="Tap the heart on any stay to keep it for later." action={<ButtonLink href="/search">Find a stay</ButtonLink>} />
        ) : (
          <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {savedCards.map((p) => (
              <li key={p.id}>
                <PropertyCard property={p} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="trips-heading" className="mt-12">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h2 id="trips-heading" className="text-2xl">
            Your trips
          </h2>
          <ButtonLink href="/account/bookings" variant="ghost" size="sm">
            View all
          </ButtonLink>
        </div>
        {trips.length === 0 ? (
          <EmptyState icon="calendar" title="You haven't booked a stay yet" description="Your trips will appear here once you book." action={<ButtonLink href="/search">Find a stay</ButtonLink>} />
        ) : (
          <Card className="divide-y divide-ink/10">
            {trips.map((t) => (
              <Link
                key={t.id}
                href={t.status === "PENDING" ? `/checkout/${t.reference}` : `/account/bookings/${t.reference}`}
                className="flex flex-wrap items-center justify-between gap-3 p-5 hover:bg-sand-50"
              >
                <div>
                  <p className="font-semibold">{t.property.title}</p>
                  <p className="text-sm text-mist">
                    {formatStayDate(t.checkIn)} → {formatStayDate(t.checkOut)} · Ref {t.reference}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge tone={BOOKING_STATUS_LABELS[t.status].tone}>{BOOKING_STATUS_LABELS[t.status].label}</Badge>
                  {t.isDemo && <Badge tone="demo">Demo data</Badge>}
                </div>
              </Link>
            ))}
            <p className="p-5 text-sm text-mist">Showing your {pluralize(trips.length, "most recent trip", "most recent trips")}.</p>
          </Card>
        )}
      </section>
    </div>
  );
}

function Field({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-mist">{label}</p>
      <p className={muted ? "font-semibold text-mist" : "font-semibold break-words"}>{value}</p>
    </div>
  );
}
