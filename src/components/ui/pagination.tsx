import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

/** Page numbers to show: first, last, and a window around the current page, with gaps as null. */
export function pageWindow(page: number, totalPages: number, radius = 1): (number | null)[] {
  const pages = new Set<number>([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push(null);
    out.push(p);
  });
  return out;
}

/**
 * Link-based pagination: works without JavaScript, is crawlable, and keeps every filter because
 * `hrefFor` rebuilds the full query string for each page.
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  className,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const item = "grid h-11 min-w-11 place-items-center rounded-full px-3 text-sm font-semibold transition-colors";
  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-1", className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(item, "hover:bg-ink/5")} aria-label="Previous page">
          <Icon name="chevronRight" size={18} className="rotate-180" />
        </Link>
      ) : (
        <span className={cn(item, "opacity-30")} aria-hidden>
          <Icon name="chevronRight" size={18} className="rotate-180" />
        </span>
      )}
      <ol className="flex items-center gap-1">
        {pageWindow(page, totalPages).map((p, i) =>
          p === null ? (
            <li key={`gap-${i}`} className="px-1 text-mist" aria-hidden>
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                href={hrefFor(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                className={cn(item, p === page ? "bg-eucalypt-700 text-white" : "hover:bg-ink/5")}
              >
                {p}
              </Link>
            </li>
          ),
        )}
      </ol>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={cn(item, "hover:bg-ink/5")} aria-label="Next page">
          <Icon name="chevronRight" size={18} />
        </Link>
      ) : (
        <span className={cn(item, "opacity-30")} aria-hidden>
          <Icon name="chevronRight" size={18} />
        </span>
      )}
    </nav>
  );
}
