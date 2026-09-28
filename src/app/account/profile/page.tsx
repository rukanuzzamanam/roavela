import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/account/profile-form";
import { Card } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { requirePermission } from "@/server/auth/guards";
import { prisma } from "@/server/db";

export const metadata: Metadata = { title: "Edit profile", robots: { index: false } };

export default async function ProfilePage() {
  const session = await requirePermission("account:manage", "/account/profile");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true } });

  return (
    <div className="container-page max-w-2xl py-10">
      <Link href="/account" className="inline-flex min-h-10 items-center gap-1 pr-3 text-sm font-semibold text-ink-soft hover:text-ink">
        <Icon name="chevronRight" size={16} className="rotate-180" />
        Account
      </Link>
      <h1 className="mt-2 text-4xl">Edit profile</h1>
      <Card className="mt-8 p-6 sm:p-8">
        <ProfileForm initial={{ name: user.name, phone: user.phone ?? "", email: user.email }} />
      </Card>
      <p className="mt-6 text-sm text-mist">Profile photos will be available once image uploads launch.</p>
    </div>
  );
}
