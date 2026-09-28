import type { Metadata } from "next";
import { Card } from "@/components/ui/feedback";
import { requirePermission } from "@/server/auth/guards";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default async function AdminPage() {
  // Server-side role check — ADMIN only.
  await requirePermission("admin:portal", "/admin");

  const [users, hosts, published, pending] = await Promise.all([
    prisma.user.count(),
    prisma.hostProfile.count(),
    prisma.property.count({ where: { status: "PUBLISHED" } }),
    prisma.property.count({ where: { status: "PENDING_REVIEW" } }),
  ]);

  const metrics = [
    { label: "Users", value: users },
    { label: "Hosts", value: hosts },
    { label: "Published properties", value: published },
    { label: "Pending review", value: pending },
  ];

  return (
    <div className="container-page py-10">
      <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">Admin</p>
      <h1 className="mt-1 text-4xl">Platform overview</h1>
      <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label} className="p-5">
            <dt className="text-sm text-mist">{m.label}</dt>
            <dd className="mt-1 font-display text-4xl">{m.value}</dd>
          </Card>
        ))}
      </dl>
      <p className="mt-8 text-mist">Moderation, compliance review and management tools arrive in the admin-portal phase. Counts include demo data.</p>
    </div>
  );
}
