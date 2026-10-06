"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Admin sections. Only sections backed by real functionality are listed. */
const NAV: { href: string; label: string; icon: string }[] = [
  { href: "/admin", label: "Overview", icon: "home" },
  { href: "/admin/properties", label: "Properties", icon: "list" },
  { href: "/admin/compliance", label: "Compliance", icon: "shield" },
  { href: "/admin/bookings", label: "Bookings", icon: "calendar" },
  { href: "/admin/payments", label: "Payments", icon: "check" },
  { href: "/admin/refunds", label: "Refunds", icon: "arrowRight" },
  { href: "/admin/hosts", label: "Hosts", icon: "user" },
  { href: "/admin/customers", label: "Customers", icon: "users" },
  { href: "/admin/reviews", label: "Reviews", icon: "star" },
  { href: "/admin/destinations", label: "Destinations", icon: "map" },
  { href: "/admin/commission", label: "Commission", icon: "filter" },
  { href: "/admin/audit", label: "Audit log", icon: "clock" },
  { href: "/admin/settings", label: "Settings", icon: "desk" },
];

export function AdminNav() {
  const pathname = usePathname();
  const isCurrent = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Admin">
      <ul className="scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        {NAV.map((n) => (
          <li key={n.href} className="shrink-0">
            <Link
              href={n.href}
              aria-current={isCurrent(n.href) ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-full px-3.5 text-sm font-semibold transition-colors lg:rounded-xl",
                isCurrent(n.href) ? "bg-eucalypt-700 text-white" : "text-ink-soft hover:bg-ink/5",
              )}
            >
              <Icon name={n.icon} size={16} />
              {n.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
