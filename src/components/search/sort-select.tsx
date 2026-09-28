"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { SORT_OPTIONS } from "@/config/search";

export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="relative">
      <label htmlFor="sort" className="sr-only">
        Sort results
      </label>
      <select
        id="sort"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(searchParams);
          if (e.target.value === "recommended") next.delete("sort");
          else next.set("sort", e.target.value);
          router.push(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="h-12 appearance-none rounded-full border border-ink/10 bg-white pr-10 pl-4 text-sm font-semibold hover:border-ink/30"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-mist" />
    </div>
  );
}
