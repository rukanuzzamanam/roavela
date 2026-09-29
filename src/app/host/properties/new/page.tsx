import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewPropertyForm } from "@/components/host/host-forms";
import { HostShell } from "@/components/host/host-ui";
import { Card } from "@/components/ui/feedback";
import { requireUser } from "@/server/auth/guards";
import { track } from "@/server/providers/analytics";
import { getOwnHostProfile } from "@/server/services/host-profile";

export const metadata: Metadata = { title: "Add a property", robots: { index: false } };

export default async function NewPropertyPage() {
  const user = await requireUser("/host/properties/new");
  const profile = user.role === "HOST" ? await getOwnHostProfile(user.id) : null;
  // No host profile yet (or not a host): onboarding step 1 comes first.
  if (!profile) redirect(user.role === "CUSTOMER" ? "/host/onboarding" : "/host/start");

  track({ name: "property_creation_started", properties: {}, userId: user.id });

  return (
    <HostShell current="/host/properties" eyebrow="Step 2 · Property basics" title="Add a property">
      <Card className="max-w-2xl p-6 sm:p-8">
        <p className="mb-6 text-mist">Start with the basics. We&apos;ll save a private draft, and you can complete the rest at your own pace.</p>
        <NewPropertyForm />
      </Card>
    </HostShell>
  );
}
