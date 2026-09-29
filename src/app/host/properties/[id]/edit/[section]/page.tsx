import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityManager } from "@/components/host/availability-manager";
import { ComplianceFileForm } from "@/components/host/host-forms";
import { SectionStepper, StatusBadge } from "@/components/host/host-ui";
import { PhotoManager } from "@/components/host/photo-manager";
import { AmenitiesSection, BasicsSection, ComplianceSection, ConfirmSection, DetailsSection, LocationSection, PricingSection, RulesSection, type ComplianceValues } from "@/components/host/section-fields";
import { Icon } from "@/components/ui/icons";
import { jurisdictionFor } from "@/config/jurisdictions";
import { toIsoDate, todayInTimeZone } from "@/lib/dates";
import { isSectionKey, SECTION_COPY } from "@/lib/host-sections";
import { canHostEdit, STATUS_LABELS } from "@/lib/listing-lifecycle";
import { requireHost } from "@/server/auth/host-guard";
import { prisma } from "@/server/db";
import { getActiveFeeSchedule } from "@/server/services/fees";
import { getManagedProperty } from "@/server/services/host-properties";

export const metadata: Metadata = { title: "Edit listing", robots: { index: false } };

type PageProps = { params: Promise<{ id: string; section: string }> };

export default async function EditSectionPage({ params }: PageProps) {
  const { id, section } = await params;
  if (!isSectionKey(section)) notFound();
  const user = await requireHost(`/host/properties/${id}/edit/${section}`);
  const managed = await getManagedProperty(user.id, id);
  if (!managed) notFound();
  const { property: p, checklist } = managed;
  const editable = canHostEdit(p.status);
  const copy = SECTION_COPY[section];

  return (
    <div className="container-page py-8">
      <Link href={`/host/properties/${p.id}`} className="inline-flex min-h-10 items-center gap-1 pr-3 text-sm font-semibold text-ink-soft hover:text-ink">
        <Icon name="chevronRight" size={16} className="rotate-180" />
        {p.title}
      </Link>
      <div className="mt-4 grid gap-8 lg:grid-cols-[15rem_1fr]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SectionStepper propertyId={p.id} sections={checklist.sections} current={section} />
        </div>
        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl sm:text-4xl">{copy.title}</h1>
            <StatusBadge status={p.status} percent={checklist.percent} />
          </div>
          <p className="mb-6 max-w-2xl text-ink-soft">{copy.intro}</p>
          {!editable && (
            <p role="status" className="mb-6 rounded-2xl bg-ochre-50 p-4 text-sm text-ochre-700">
              {STATUS_LABELS[p.status].help} Changes can&apos;t be saved right now.
            </p>
          )}
          <fieldset disabled={!editable} className="min-w-0">
            <SectionBody section={section} managed={managed} userId={user.id} editable={editable} />
          </fieldset>
        </div>
      </div>
    </div>
  );
}

async function SectionBody({
  section,
  managed,
  editable,
}: {
  section: string;
  managed: NonNullable<Awaited<ReturnType<typeof getManagedProperty>>>;
  userId: string;
  editable: boolean;
}) {
  const p = managed.property;
  switch (section) {
    case "basics":
      return <BasicsSection propertyId={p.id} values={{ title: p.title, type: p.type, maxGuests: p.maxGuests, bedrooms: p.bedrooms, beds: p.beds, bathrooms: p.bathrooms }} />;
    case "location": {
      const destinations = await prisma.destination.findMany({ where: { isPublished: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      return <LocationSection propertyId={p.id} values={p} destinations={destinations} />;
    }
    case "details":
      return <DetailsSection propertyId={p.id} values={p} />;
    case "amenities":
      return <AmenitiesSection propertyId={p.id} selected={p.amenities.map((a) => a.amenity.key)} />;
    case "photos":
      return (
        <div className="space-y-8">
          <PhotoManager propertyId={p.id} photos={p.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt }))} editable={editable} />
          <ConfirmSection propertyId={p.id} section="photos" note="Photos save as soon as they upload. Continue when you're done." />
        </div>
      );
    case "pricing": {
      const fees = await getActiveFeeSchedule(p.countryCode);
      return <PricingSection propertyId={p.id} values={p} currency={p.currency} fees={{ guestServiceFeeBps: fees.guestServiceFeeBps, hostCommissionBps: fees.hostCommissionBps }} />;
    }
    case "availability": {
      const today = todayInTimeZone(p.timezone);
      const booked = await prisma.booking.findMany({
        where: { propertyId: p.id, status: { in: ["PENDING", "CONFIRMED"] }, checkOut: { gt: today } },
        select: { checkIn: true, checkOut: true },
      });
      return (
        <div className="space-y-8">
          <AvailabilityManager
            propertyId={p.id}
            today={toIsoDate(today)}
            editable={editable}
            blocked={p.blockedDates.map((b) => ({ start: toIsoDate(b.startDate), end: toIsoDate(b.endDate) }))}
            booked={booked.map((b) => ({ start: toIsoDate(b.checkIn), end: toIsoDate(b.checkOut) }))}
          />
          <p className="text-sm text-mist">
            Minimum ({p.minNights} {p.minNights === 1 ? "night" : "nights"}) and maximum stays are set in{" "}
            <Link href={`/host/properties/${p.id}/edit/pricing`} className="font-semibold text-eucalypt-700 hover:underline">
              Pricing
            </Link>
            .
          </p>
          <ConfirmSection propertyId={p.id} section="availability" note="Your property is open for all dates you haven't blocked. Save to confirm your calendar." />
        </div>
      );
    }
    case "rules":
      return <RulesSection propertyId={p.id} values={p} />;
    case "compliance": {
      const byType = Object.fromEntries(p.compliance.map((c) => [c.type, c]));
      const data = (t: string) => (byType[t]?.data ?? {}) as Record<string, unknown>;
      const reg = byType.SHORT_TERM_RENTAL_REGISTRATION;
      const values: ComplianceValues = {
        registrationNumber: reg?.referenceNumber ?? null,
        registrationExpiry: reg?.expiresAt ? toIsoDate(reg.expiresAt) : null,
        exemptionDeclared: data("SHORT_TERM_RENTAL_REGISTRATION").exemptionDeclared === true,
        exemptionReason: (data("SHORT_TERM_RENTAL_REGISTRATION").exemptionReason as string | null) ?? null,
        ownershipStatus: (data("AUTHORITY_TO_LIST").ownershipStatus as string | null) ?? null,
        authorityConfirmed: data("AUTHORITY_TO_LIST").confirmed === true,
        insuranceConfirmed: data("INSURANCE").confirmed === true,
        insurerName: (data("INSURANCE").insurerName as string | null) ?? null,
        obligationsAcknowledged: data("LOCAL_COMPLIANCE_ACKNOWLEDGEMENT").obligationsAcknowledged === true,
        planningAcknowledged: data("LOCAL_COMPLIANCE_ACKNOWLEDGEMENT").planningAcknowledged === true,
        strataScheme: (data("LOCAL_COMPLIANCE_ACKNOWLEDGEMENT").strataScheme as string | null) ?? null,
        strataPermissionConfirmed: data("LOCAL_COMPLIANCE_ACKNOWLEDGEMENT").strataPermissionConfirmed === true,
      };
      const statusOf = (t: string) => byType[t]?.status;
      return (
        <div className="space-y-10">
          {p.compliance.length > 0 && (
            <p className="rounded-2xl bg-sand-100 p-4 text-sm text-ink-soft">
              Status: <strong>{statusOf("LOCAL_COMPLIANCE_ACKNOWLEDGEMENT") === "APPROVED" ? "Reviewed by Roavela" : "Submitted — awaiting review"}</strong>. Editing these details sends them back for review.
            </p>
          )}
          <ComplianceSection propertyId={p.id} values={values} jurisdiction={jurisdictionFor(p.countryCode, p.adminArea)} />
          {p.compliance.length > 0 && editable && (
            <section aria-labelledby="documents" className="space-y-3">
              <h2 id="documents" className="text-2xl">
                Supporting documents (optional)
              </h2>
              <p className="text-sm text-mist">Stored privately and only visible to you and Roavela&apos;s review team. PDF or image, up to 10 MB.</p>
              {byType.SHORT_TERM_RENTAL_REGISTRATION && <ComplianceFileForm propertyId={p.id} type="SHORT_TERM_RENTAL_REGISTRATION" label="Registration certificate" hasFile={Boolean(byType.SHORT_TERM_RENTAL_REGISTRATION.fileKey)} />}
              <ComplianceFileForm propertyId={p.id} type="INSURANCE" label="Insurance certificate" hasFile={Boolean(byType.INSURANCE?.fileKey)} />
              <ComplianceFileForm propertyId={p.id} type="AUTHORITY_TO_LIST" label="Owner's authority to list" hasFile={Boolean(byType.AUTHORITY_TO_LIST?.fileKey)} />
            </section>
          )}
        </div>
      );
    }
    default:
      notFound();
  }
}
