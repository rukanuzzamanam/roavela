"use client";

import Form from "next/form";
import { useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { AMENITY_BY_KEY, FILTER_AMENITY_KEYS } from "@/config/amenities";
import { PROPERTY_TYPE_LABELS } from "@/config/search";
import type { PropertyType } from "@/generated/prisma/enums";

export interface FilterValues {
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  bathrooms?: number;
  type: PropertyType[];
  amenities: string[];
}

const TYPE_OPTIONS: PropertyType[] = ["CABIN", "COTTAGE", "BEACH_HOUSE", "APARTMENT", "FARM_STAY", "TINY_HOME", "FAMILY_HOUSE", "VILLA"];

/**
 * Search filters. A sidebar on desktop; a bottom sheet on mobile.
 * `preserved` carries the non-filter search state (origin, dates, guests, sort, view) through submission.
 */
export function FiltersPanel({
  values,
  preserved,
  activeCount,
  clearHref,
}: {
  values: FilterValues;
  preserved: Record<string, string>;
  activeCount: number;
  clearHref: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="lg:hidden">
        <Button variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <Icon name="filter" size={18} />
          Filters
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-eucalypt-700 text-xs text-white">{activeCount}</span>
          )}
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Filters" variant="sheet">
          <FilterForm id="filters-mobile" values={values} preserved={preserved} onSubmitted={() => setOpen(false)}>
            <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-ink/10 bg-white px-5 py-4">
              <ButtonLink href={clearHref} variant="ghost" className="flex-1">
                Clear all
              </ButtonLink>
              <Button type="submit" className="flex-1">
                Show stays
              </Button>
            </div>
          </FilterForm>
        </Modal>
      </div>

      <aside aria-label="Filters" className="hidden lg:block">
        <FilterForm id="filters-desktop" values={values} preserved={preserved}>
          <div className="flex gap-3 pt-2">
            <Button type="submit" className="flex-1">
              Apply filters
            </Button>
            {activeCount > 0 && (
              <ButtonLink href={clearHref} variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </FilterForm>
      </aside>
    </>
  );
}

function FilterForm({
  id,
  values,
  preserved,
  children,
  onSubmitted,
}: {
  id: string;
  values: FilterValues;
  preserved: Record<string, string>;
  children: ReactNode;
  onSubmitted?: () => void;
}) {
  return (
    <Form action="/search" id={id} className="space-y-7" onSubmit={() => onSubmitted?.()}>
      {Object.entries(preserved).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      <Section title="Nightly price (AUD)">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Minimum" name="minPrice" type="number" inputMode="numeric" min={0} step={10} placeholder="$0" defaultValue={values.minPrice} />
          <Input label="Maximum" name="maxPrice" type="number" inputMode="numeric" min={0} step={10} placeholder="Any" defaultValue={values.maxPrice} />
        </div>
      </Section>

      <Section title="Rooms">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Bedrooms" name="bedrooms" defaultValue={values.bedrooms?.toString() ?? ""}>
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </Select>
          <Select label="Bathrooms" name="bathrooms" defaultValue={values.bathrooms?.toString() ?? ""}>
            <option value="">Any</option>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </Select>
        </div>
      </Section>

      <Section title="Property type">
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => (
            <Chip key={t} name="type" value={t} label={PROPERTY_TYPE_LABELS[t]} defaultChecked={values.type.includes(t)} />
          ))}
        </div>
      </Section>

      <Section title="Features & setting">
        <div className="flex flex-wrap gap-2">
          {FILTER_AMENITY_KEYS.map((key) => {
            const a = AMENITY_BY_KEY.get(key);
            if (!a) return null;
            return <Chip key={key} name="amenities" value={key} label={a.label} icon={a.icon} defaultChecked={values.amenities.includes(key)} />;
          })}
        </div>
      </Section>

      {children}
    </Form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-3 font-sans text-base font-bold">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Checkbox styled as a toggle chip — remains a real checkbox for keyboard and screen readers. */
function Chip({ name, value, label, icon, defaultChecked }: { name: string; value: string; label: string; icon?: string; defaultChecked: boolean }) {
  return (
    <label className="relative cursor-pointer">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="flex items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3.5 py-2 text-sm font-medium transition-colors peer-checked:border-eucalypt-700 peer-checked:bg-eucalypt-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-eucalypt-500 hover:border-ink/40">
        {icon && <Icon name={icon} size={16} />}
        {label}
      </span>
    </label>
  );
}
