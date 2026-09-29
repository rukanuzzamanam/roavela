import type { Metadata } from "next";
import { AvatarForm, HostProfileForm } from "@/components/host/host-forms";
import { HostShell } from "@/components/host/host-ui";
import { Card } from "@/components/ui/feedback";
import { requireHost } from "@/server/auth/host-guard";
import { getOwnHostProfile } from "@/server/services/host-profile";

export const metadata: Metadata = { title: "Host profile", robots: { index: false } };

export default async function HostProfilePage() {
  const user = await requireHost("/host/profile");
  const profile = await getOwnHostProfile(user.id);
  return (
    <HostShell current="/host/profile" eyebrow="Host portal" title="Host profile">
      <div className="max-w-2xl space-y-6">
        {profile && (
          <Card className="p-6">
            <AvatarForm current={profile.avatarUrl} />
          </Card>
        )}
        <Card className="p-6 sm:p-8">
          <HostProfileForm
            values={{ displayName: profile?.displayName ?? user.name, bio: profile?.bio, hostType: profile?.hostType, legalName: profile?.legalName, businessName: profile?.businessName, abn: profile?.abn, phone: profile?.phone }}
            submitLabel="Save profile"
          />
        </Card>
      </div>
    </HostShell>
  );
}
