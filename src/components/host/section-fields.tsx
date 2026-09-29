"use client";

import { useState, type ReactNode } from "react";
import { Input, Select, controlClasses } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { AMENITIES, AMENITY_CATEGORY_LABELS, AMENITY_CATEGORY_ORDER } from "@/config/amenities";
import { AU_STATES, type JurisdictionRequirements } from "@/config/jurisdictions";
import { CANCELLATION_COPY } from "@/config/policies";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import { formatMoney } from "@/lib/money";
import { calculateFees, type FeeRates } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { HOST_PROPERTY_TYPES, parseMoneyToCents } from "@/lib/validation/host";
import { SectionForm } from "./section-form";

const cents = (c: number | null | undefined) => (c === null || c === undefined ? "" : (c / 100).toFixed(c % 100 === 0 ? 0 : 2));

function Textarea({ label, name, defaultValue, error, hint, rows = 5, maxLength }: { label: string; name: string; defaultValue?: string | null; error?: string; hint?: string; rows?: number; maxLength?: number }) {
  const id = `f-${name}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-ink-soft">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue ?? ""}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(controlClasses, "py-3 leading-relaxed")}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-mist">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function Check({ name, label, defaultChecked, hint, error }: { name: string; label: ReactNode; defaultChecked?: boolean; hint?: string; error?: string }) {
  return (
    <div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white p-4 hover:border-ink/25">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-5 shrink-0 accent-eucalypt-700" aria-invalid={error ? true : undefined} />
        <span>
          <span className="font-semibold">{label}</span>
          {hint && <span className="block text-sm text-mist">{hint}</span>}
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Basics ──
export interface BasicsValues {
  title: string;
  type: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
}

export function BasicsFields({ values, errors }: { values?: Partial<BasicsValues>; errors?: Record<string, string> }) {
  return (
    <>
      <Input label="Listing title" name="title" required maxLength={80} defaultValue={values?.title} error={errors?.title} hint="8–80 characters, e.g. “Vineyard cottage with verandah views”" />
      <Select label="Property type" name="type" defaultValue={values?.type ?? ""} error={errors?.type}>
        <option value="" disabled>
          Choose a type
        </option>
        {HOST_PROPERTY_TYPES.map((t) => (
          <option key={t} value={t}>
            {PROPERTY_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Input label="Max guests" name="maxGuests" type="number" inputMode="numeric" min={1} max={16} defaultValue={values?.maxGuests ?? 2} error={errors?.maxGuests} />
        <Input label="Bedrooms" name="bedrooms" type="number" inputMode="numeric" min={0} max={20} defaultValue={values?.bedrooms ?? 1} error={errors?.bedrooms} />
        <Input label="Beds" name="beds" type="number" inputMode="numeric" min={1} max={40} defaultValue={values?.beds ?? 1} error={errors?.beds} />
        <Input label="Bathrooms" name="bathrooms" type="number" inputMode="decimal" min={0.5} max={20} step={0.5} defaultValue={values?.bathrooms ?? 1} error={errors?.bathrooms} />
      </div>
    </>
  );
}

export function BasicsSection({ propertyId, values }: { propertyId: string; values: BasicsValues }) {
  return <SectionForm propertyId={propertyId} section="basics">{(s) => <BasicsFields values={values} errors={s.fieldErrors} />}</SectionForm>;
}

// ── Location ──
export function LocationSection({
  propertyId,
  values,
  destinations,
}: {
  propertyId: string;
  values: { addressLine1: string | null; addressLine2: string | null; locality: string | null; adminArea: string | null; postcode: string | null; latitude: number | null; longitude: number | null; destinationId: string | null };
  destinations: { id: string; name: string }[];
}) {
  return (
    <SectionForm propertyId={propertyId} section="location">
      {(s) => (
        <>
          <p className="flex gap-2 rounded-2xl bg-eucalypt-50 p-4 text-sm text-eucalypt-900">
            <Icon name="shield" size={18} className="shrink-0" />
            Your street address is private. Guests see only the suburb and an approximate area on the map.
          </p>
          <Input label="Street address" name="addressLine1" autoComplete="address-line1" defaultValue={values.addressLine1 ?? ""} error={s.fieldErrors?.addressLine1} />
          <Input label="Unit, building (optional)" name="addressLine2" autoComplete="address-line2" defaultValue={values.addressLine2 ?? ""} error={s.fieldErrors?.addressLine2} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Suburb / town" name="locality" autoComplete="address-level2" defaultValue={values.locality ?? ""} error={s.fieldErrors?.locality} />
            <Select label="State / territory" name="adminArea" defaultValue={values.adminArea ?? ""} error={s.fieldErrors?.adminArea}>
              <option value="" disabled>
                Choose
              </option>
              {AU_STATES.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name}
                </option>
              ))}
            </Select>
            <Input label="Postcode" name="postcode" inputMode="numeric" autoComplete="postal-code" maxLength={4} defaultValue={values.postcode ?? ""} error={s.fieldErrors?.postcode} />
          </div>
          <Input label="Country" name="country-display" value="Australia" readOnly disabled hint="Roavela currently lists Australian properties." />
          <Select label="Destination guests search for" name="destinationId" defaultValue={values.destinationId ?? ""} error={s.fieldErrors?.destinationId} hint="Can't see your area? Choose the nearest destination — new destinations are added by the Roavela team.">
            <option value="" disabled>
              Choose a destination
            </option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <fieldset className="rounded-2xl border border-ink/10 p-4">
            <legend className="px-1 text-sm font-semibold text-ink-soft">Map position (optional)</legend>
            <p className="mb-3 text-sm text-mist">
              Coordinates make drive-time estimates more accurate. Leave blank and we&apos;ll use your destination&apos;s centre, shown as approximate. Automatic address lookup arrives when a map provider is connected.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Latitude" name="latitude" inputMode="decimal" placeholder="-32.834" defaultValue={values.latitude ?? ""} error={s.fieldErrors?.latitude} />
              <Input label="Longitude" name="longitude" inputMode="decimal" placeholder="151.356" defaultValue={values.longitude ?? ""} error={s.fieldErrors?.longitude} />
            </div>
          </fieldset>
        </>
      )}
    </SectionForm>
  );
}

// ── Description ──
export function DetailsSection({ propertyId, values }: { propertyId: string; values: { summary: string | null; description: string | null } }) {
  return (
    <SectionForm propertyId={propertyId} section="details">
      {(s) => (
        <>
          <Textarea label="Summary" name="summary" rows={2} maxLength={160} defaultValue={values.summary} error={s.fieldErrors?.summary} hint="One or two sentences shown in search results (20–160 characters)." />
          <Textarea label="Description" name="description" rows={10} maxLength={5000} defaultValue={values.description} error={s.fieldErrors?.description} hint="Describe the space, the setting and what makes it worth the drive (at least 80 characters). Don't include your address or contact details." />
        </>
      )}
    </SectionForm>
  );
}

// ── Amenities ──
export function AmenitiesSection({ propertyId, selected }: { propertyId: string; selected: string[] }) {
  const chosen = new Set(selected);
  return (
    <SectionForm propertyId={propertyId} section="amenities">
      {() => (
        <div className="space-y-6">
          {AMENITY_CATEGORY_ORDER.map((category) => {
            const items = AMENITIES.filter((a) => a.category === category && a.key !== "pet_friendly");
            if (items.length === 0) return null;
            return (
              <fieldset key={category}>
                <legend className="mb-3 font-sans text-base font-bold">{AMENITY_CATEGORY_LABELS[category]}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((a) => (
                    <label key={a.key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 has-checked:border-eucalypt-600 has-checked:bg-eucalypt-50">
                      <input type="checkbox" name="amenities" value={a.key} defaultChecked={chosen.has(a.key)} className="size-5 accent-eucalypt-700" />
                      <Icon name={a.icon} size={18} className="text-eucalypt-600" />
                      {a.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
          <p className="text-sm text-mist">“Pet friendly” is set from your house rules, so it always matches your pet policy.</p>
        </div>
      )}
    </SectionForm>
  );
}

// ── Pricing ──
export function PricingSection({
  propertyId,
  values,
  fees,
  currency,
}: {
  propertyId: string;
  values: { nightlyPriceCents: number | null; weekendPriceCents: number | null; cleaningFeeCents: number; minNights: number; maxNights: number | null };
  fees: FeeRates;
  currency: string;
}) {
  const [nightly, setNightly] = useState(cents(values.nightlyPriceCents));
  const [cleaning, setCleaning] = useState(cents(values.cleaningFeeCents));
  return (
    <SectionForm propertyId={propertyId} section="pricing">
      {(s) => (
        <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Nightly price (AUD)" name="nightlyPrice" inputMode="decimal" placeholder="250" value={nightly} onChange={(e) => setNightly(e.target.value)} error={s.fieldErrors?.nightlyPrice} hint="Sunday to Thursday nights" />
              <Input label="Weekend price (optional)" name="weekendPrice" inputMode="decimal" placeholder="Same as nightly" defaultValue={cents(values.weekendPriceCents)} error={s.fieldErrors?.weekendPrice} hint="Friday and Saturday nights" />
              <Input label="Cleaning fee (AUD)" name="cleaningFee" inputMode="decimal" placeholder="0" value={cleaning} onChange={(e) => setCleaning(e.target.value)} error={s.fieldErrors?.cleaningFee} hint="Charged once per stay" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Minimum stay (nights)" name="minNights" type="number" inputMode="numeric" min={1} max={30} defaultValue={values.minNights} error={s.fieldErrors?.minNights} />
              <Input label="Maximum stay (optional)" name="maxNights" type="number" inputMode="numeric" min={1} max={365} defaultValue={values.maxNights ?? ""} error={s.fieldErrors?.maxNights} />
            </div>
          </div>
          <EarningsPreview nightly={nightly} cleaning={cleaning} fees={fees} currency={currency} />
        </div>
      )}
    </SectionForm>
  );
}

/**
 * Transparent example using the platform's configured fee rates (passed from the server's active
 * fee schedule) and the same fee function the rest of the platform uses. It's an estimate.
 */
function EarningsPreview({ nightly, cleaning, fees, currency }: { nightly: string; cleaning: string; fees: FeeRates; currency: string }) {
  const nightlyCents = parseMoneyToCents(nightly || "0");
  const cleaningCents = parseMoneyToCents(cleaning || "0") ?? 0;
  const nights = 2;
  const money = (v: number) => formatMoney(v, currency, { showCents: v % 100 !== 0 });
  if (!nightlyCents) {
    return (
      <aside className="rounded-2xl bg-sand-100 p-5 text-sm text-ink-soft" aria-label="Estimated earnings">
        Enter a nightly price to see an example of what you&apos;d earn.
      </aside>
    );
  }
  const accommodation = nightlyCents * nights;
  const f = calculateFees(accommodation + cleaningCents, fees);
  return (
    <aside className="h-fit rounded-2xl border border-ink/10 bg-white p-5" aria-label="Estimated earnings" aria-live="polite">
      <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">Example: 2-night weeknight stay</p>
      <dl className="mt-3 space-y-2 text-[0.9375rem]">
        <Row label={`${money(nightlyCents)} × ${nights} nights`} value={money(accommodation)} />
        <Row label="Cleaning fee" value={money(cleaningCents)} />
        <Row label={`Roavela host fee (${fees.hostCommissionBps / 100}%)`} value={`−${money(f.hostCommissionCents)}`} />
        <div className="flex justify-between gap-4 border-t border-ink/10 pt-2 font-bold">
          <dt>Estimated earnings</dt>
          <dd className="tabular-nums">{money(f.hostPayoutCents)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-mist">
        Estimate only, before any payment-processing costs or taxes. Guests also pay a separate service fee ({money(f.guestServiceFeeCents)} on this stay). Weekend rates aren&apos;t included in this example.
      </p>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-ink-soft">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// ── House rules ──
export function RulesSection({
  propertyId,
  values,
}: {
  propertyId: string;
  values: { checkInTime: string; checkOutTime: string; smokingAllowed: boolean; petsAllowed: boolean; eventsAllowed: boolean; quietHoursStart: string | null; quietHoursEnd: string | null; houseRules: string | null; cancellationPolicy: string; maxGuests: number };
}) {
  return (
    <SectionForm propertyId={propertyId} section="rules">
      {(s) => (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Check-in from" name="checkInTime" type="time" defaultValue={values.checkInTime} error={s.fieldErrors?.checkInTime} />
            <Input label="Check-out by" name="checkOutTime" type="time" defaultValue={values.checkOutTime} error={s.fieldErrors?.checkOutTime} />
          </div>
          <div className="grid gap-3">
            <Check name="petsAllowed" label="Pets allowed" defaultChecked={values.petsAllowed} hint="Your listing shows as pet friendly in search." />
            <Check name="smokingAllowed" label="Smoking allowed" defaultChecked={values.smokingAllowed} />
            <Check name="eventsAllowed" label="Parties or events allowed" defaultChecked={values.eventsAllowed} hint="Check your council and strata rules first." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Quiet hours from (optional)" name="quietHoursStart" type="time" defaultValue={values.quietHoursStart ?? ""} error={s.fieldErrors?.quietHoursStart} />
            <Input label="Quiet hours until" name="quietHoursEnd" type="time" defaultValue={values.quietHoursEnd ?? ""} error={s.fieldErrors?.quietHoursEnd} />
          </div>
          <p className="text-sm text-mist">Maximum guests ({values.maxGuests}) is set in Property basics.</p>
          <Textarea label="Additional rules (optional)" name="houseRules" rows={4} maxLength={1500} defaultValue={values.houseRules} error={s.fieldErrors?.houseRules} />
          <fieldset>
            <legend className="mb-3 font-sans text-base font-bold">Cancellation policy</legend>
            <div className="grid gap-3">
              {(["FLEXIBLE", "MODERATE", "STRICT"] as const).map((p) => (
                <label key={p} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-white p-4 has-checked:border-eucalypt-600 has-checked:bg-eucalypt-50">
                  <input type="radio" name="cancellationPolicy" value={p} defaultChecked={values.cancellationPolicy === p} className="mt-1 size-4 accent-eucalypt-700" />
                  <span>
                    <span className="font-semibold">{CANCELLATION_COPY[p].title}</span>
                    <span className="block text-sm text-ink-soft">{CANCELLATION_COPY[p].body}</span>
                  </span>
                </label>
              ))}
            </div>
            {s.fieldErrors?.cancellationPolicy && <p className="mt-1 text-sm text-red-700">{s.fieldErrors.cancellationPolicy}</p>}
            <p className="mt-3 text-xs text-mist">These are plain-language summaries of Roavela&apos;s standard policies. They haven&apos;t been reviewed as legal advice for your situation.</p>
          </fieldset>
        </>
      )}
    </SectionForm>
  );
}

// ── Compliance ──
export interface ComplianceValues {
  registrationNumber: string | null;
  registrationExpiry: string | null;
  exemptionDeclared: boolean;
  exemptionReason: string | null;
  ownershipStatus: string | null;
  authorityConfirmed: boolean;
  insuranceConfirmed: boolean;
  insurerName: string | null;
  obligationsAcknowledged: boolean;
  planningAcknowledged: boolean;
  strataScheme: string | null;
  strataPermissionConfirmed: boolean;
}

export function ComplianceSection({ propertyId, values, jurisdiction }: { propertyId: string; values: ComplianceValues; jurisdiction: JurisdictionRequirements | null }) {
  const [strata, setStrata] = useState(values.strataScheme ?? "");
  const [exempt, setExempt] = useState(values.exemptionDeclared);
  return (
    <SectionForm propertyId={propertyId} section="compliance" isLast>
      {(s) => (
        <>
          <div className="rounded-2xl border border-ink/10 bg-white p-5">
            <p className="font-semibold">{jurisdiction ? jurisdiction.name : "Your state or territory"}</p>
            <p className="mt-1 text-sm text-ink-soft">{jurisdiction?.obligationsSummary ?? "Add your property's location first so we can show the requirements that apply."}</p>
            <p className="mt-3 text-xs text-mist">
              Roavela records what you tell us and our team reviews it before your listing goes live. This isn&apos;t legal advice, and Roavela doesn&apos;t verify registrations with government registers. You remain responsible for complying with the rules that apply to your property.
            </p>
          </div>

          {jurisdiction?.registrationRequired && (
            <fieldset className="space-y-4">
              <legend className="mb-1 font-sans text-base font-bold">{jurisdiction.registrationLabel}</legend>
              <p className="text-sm text-ink-soft">{jurisdiction.registrationHelp}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label={jurisdiction.registrationLabel ?? "Registration number"} name="registrationNumber" defaultValue={values.registrationNumber ?? ""} placeholder={jurisdiction.registrationExample} error={s.fieldErrors?.registrationNumber} />
                <Input label="Registration expiry (if any)" name="registrationExpiry" type="date" defaultValue={values.registrationExpiry ?? ""} error={s.fieldErrors?.registrationExpiry} />
              </div>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="exemptionDeclared" checked={exempt} onChange={(e) => setExempt(e.target.checked)} className="mt-0.5 size-5 accent-eucalypt-700" />
                <span>I believe an exemption applies, so I don&apos;t have a registration number.</span>
              </label>
              {exempt && <Textarea label="Why does an exemption apply?" name="exemptionReason" rows={3} maxLength={500} defaultValue={values.exemptionReason} error={s.fieldErrors?.exemptionReason} />}
            </fieldset>
          )}
          {!jurisdiction?.registrationRequired && (
            <Input label="Registration or permit number (if you have one)" name="registrationNumber" defaultValue={values.registrationNumber ?? ""} error={s.fieldErrors?.registrationNumber} />
          )}

          <fieldset className="space-y-3">
            <legend className="mb-1 font-sans text-base font-bold">Authority to list</legend>
            <Select label="Your relationship to the property" name="ownershipStatus" defaultValue={values.ownershipStatus ?? ""} error={s.fieldErrors?.ownershipStatus}>
              <option value="" disabled>
                Choose
              </option>
              <option value="OWNER">I own it</option>
              <option value="MANAGER">I manage it for the owner</option>
              <option value="TENANT_WITH_PERMISSION">I rent it and have the owner&apos;s written permission</option>
            </Select>
            <Check name="authorityConfirmed" label="I own this property or am authorised to list and manage it." defaultChecked={values.authorityConfirmed} error={s.fieldErrors?.authorityConfirmed} />
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 font-sans text-base font-bold">Insurance</legend>
            <Check name="insuranceConfirmed" label="Appropriate insurance for short-term rental is in place." defaultChecked={values.insuranceConfirmed} error={s.fieldErrors?.insuranceConfirmed} />
            <Input label="Insurer (optional)" name="insurerName" defaultValue={values.insurerName ?? ""} error={s.fieldErrors?.insurerName} />
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 font-sans text-base font-bold">Strata & local rules</legend>
            <Select label="Is the property in a strata scheme or community title?" name="strataScheme" value={strata} onChange={(e) => setStrata(e.target.value)} error={s.fieldErrors?.strataScheme}>
              <option value="" disabled>
                Choose
              </option>
              <option value="NO">No</option>
              <option value="YES">Yes</option>
              <option value="UNSURE">I&apos;m not sure</option>
            </Select>
            {strata === "YES" && (
              <Check name="strataPermissionConfirmed" label="The strata scheme / body corporate by-laws permit short-term rental." defaultChecked={values.strataPermissionConfirmed} error={s.fieldErrors?.strataPermissionConfirmed} />
            )}
            <Check name="obligationsAcknowledged" label="I understand my local short-term rental obligations and will follow them." defaultChecked={values.obligationsAcknowledged} error={s.fieldErrors?.obligationsAcknowledged} />
            <Check name="planningAcknowledged" label="The property may be used for short-term rental under local planning and council rules." defaultChecked={values.planningAcknowledged} error={s.fieldErrors?.planningAcknowledged} />
          </fieldset>
        </>
      )}
    </SectionForm>
  );
}
