import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/feedback";
import { requirePermission } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Host portal", robots: { index: false } };

export default async function HostPortalPage() {
  // Server-side role check — HOST only. Customers and admins receive a 403.
  const user = await requirePermission("host:portal", "/host");

  return (
    <div className="container-page py-10">
      <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">Host portal</p>
      <h1 className="mt-1 text-4xl">Welcome, {user.name.split(" ")[0]}</h1>
      <EmptyState
        className="mt-8"
        icon="home"
        title="Your host dashboard is on its way"
        description="Listings, bookings, earnings and the onboarding workflow arrive in the host-portal phase."
      />
    </div>
  );
}
