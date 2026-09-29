import type { Metadata } from "next";
import { forbidden, redirect } from "next/navigation";
import { HostProfileForm } from "@/components/host/host-forms";
import { Card } from "@/components/ui/feedback";
import { requireUser } from "@/server/auth/guards";
import { track } from "@/server/providers/analytics";
import { getOwnHostProfile, isHostProfileComplete } from "@/server/services/host-profile";

export const metadata: Metadata = { title: "Start hosting", robots: { index: false } };

/** Step 1 of onboarding: the host profile. Creates the profile and upgrades the account to HOST. */
export default async function HostOnboardingPage() {
  const user = await requireUser("/host/onboarding");
  if (user.role === "ADMIN") forbidden();
  const profile = await getOwnHostProfile(user.id);
  if (user.role === "HOST" && isHostProfileComplete(profile)) redirect("/host/properties/new");

  track({ name: "host_onboarding_started", properties: {}, userId: user.id });

  return (
    <div className="container-page max-w-2xl py-10">
      <p className="text-sm font-bold tracking-wider text-ochre-600 uppercase">Step 1 · Host details</p>
      <h1 className="mt-1 text-4xl">Tell us about you</h1>
      <p className="mt-2 text-mist">Next you&apos;ll create your first listing. Your progress saves as you go, so you can finish later.</p>
      <Card className="mt-8 p-6 sm:p-8">
        <HostProfileForm
          values={{ displayName: profile?.displayName ?? user.name.split(" ")[0], bio: profile?.bio, hostType: profile?.hostType, legalName: profile?.legalName ?? user.name, businessName: profile?.businessName, abn: profile?.abn, phone: profile?.phone }}
          submitLabel="Save & create your listing"
          then="new-property"
        />
      </Card>
    </div>
  );
}
