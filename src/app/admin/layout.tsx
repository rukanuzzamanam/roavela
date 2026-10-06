import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/server/auth/admin-guard";
import { env } from "@/server/env";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin · Roavela" }, robots: { index: false, follow: false } };

/**
 * Admin shell. The layout checks admin access, but it is NOT the security boundary on its own:
 * every admin page, Server Action and route handler checks the specific capability it needs.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin("admin:portal", "/admin");
  const environment = env().NODE_ENV;
  return (
    <div className="container-page py-6 lg:py-8">
      {environment !== "production" && (
        <p role="note" className="mb-4 rounded-xl bg-ink/85 px-4 py-2 text-xs font-semibold text-white">
          {environment.toUpperCase()} ENVIRONMENT · figures include only real (non-demo) bookings unless stated · Stripe TEST MODE only
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2 hidden text-xs font-bold tracking-wider text-mist uppercase lg:block">Operations</p>
          <AdminNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
