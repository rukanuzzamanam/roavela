import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { getCurrentUser } from "@/server/auth/session";
import { getActiveFeeSchedule } from "@/server/services/fees";

export const metadata: Metadata = {
  title: "List your property",
  description: "Reach travellers looking for memorable Australian escapes. List your cabin, cottage, farm stay or beach house on Roavela.",
};

export default async function HostStartPage() {
  const user = await getCurrentUser();
  const fees = await getActiveFeeSchedule("AU").catch(() => null);
  const cta =
    user?.role === "HOST"
      ? { href: "/host", label: "Go to your host dashboard" }
      : user?.role === "ADMIN"
        ? null
        : user
          ? { href: "/host/onboarding", label: "Start hosting" }
          : { href: "/signup?next=/host/onboarding", label: "Start hosting" };

  const benefits = [
    { icon: "car", title: "Reach weekend travellers", body: "Guests on Roavela search by how far they want to drive — perfect for getaways within reach of the city." },
    { icon: "calendar", title: "Manage your availability", body: "Block the dates you need. Your calendar stays in your control." },
    { icon: "flame", title: "You set the price", body: "Nightly and weekend rates, cleaning fees and minimum stays — all yours to decide." },
    { icon: "images", title: "Showcase your property", body: "Large photography and a page designed to show off what makes your place worth the drive." },
    { icon: "check", title: "No upfront listing fee during launch", body: "It's free to create and publish a listing while we launch." },
    { icon: "shield", title: "Fees only when you're booked", body: fees ? `A ${fees.hostCommissionBps / 100}% host fee applies only to completed bookings, once online booking launches.` : "A host fee applies only to bookings, once online booking launches." },
  ];

  return (
    <div>
      <section className="bg-eucalypt-900 text-white">
        <div className="container-page py-16 sm:py-24">
          <p className="text-sm font-bold tracking-wider text-ochre-200 uppercase">Host on Roavela</p>
          <h1 className="mt-3 max-w-3xl text-5xl leading-tight sm:text-6xl">List your property on Roavela</h1>
          <p className="mt-5 max-w-xl text-xl text-eucalypt-50/90">Reach travellers looking for memorable Australian escapes.</p>
          {cta ? (
            <ButtonLink href={cta.href} variant="accent" size="lg" className="mt-8">
              {cta.label}
              <Icon name="arrowRight" size={18} />
            </ButtonLink>
          ) : (
            <p className="mt-8 max-w-md rounded-2xl bg-white/10 p-4 text-sm">Administrator accounts can&apos;t host. Use a separate traveller account to list a property.</p>
          )}
          {!user && <p className="mt-3 text-sm text-eucalypt-100">Already have an account? Log in and you&apos;ll come straight back here.</p>}
        </div>
      </section>

      <section className="container-page mt-16" aria-labelledby="why">
        <h2 id="why" className="text-3xl sm:text-4xl">
          Why host with Roavela
        </h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {benefits.map((b) => (
            <li key={b.title} className="rounded-2xl border border-ink/10 bg-white p-6">
              <Icon name={b.icon} size={26} className="text-eucalypt-600" />
              <h3 className="mt-4 font-sans text-lg font-bold">{b.title}</h3>
              <p className="mt-2 text-ink-soft">{b.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="container-page mt-16" aria-labelledby="how">
        <h2 id="how" className="text-3xl sm:text-4xl">
          How it works
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {["Create your host profile", "Build your listing at your own pace — progress saves as you go", "Tell us about registrations and permissions", "Submit for review — we check every listing before it goes live"].map((step, i) => (
            <li key={step} className="rounded-2xl bg-sand-100 p-5">
              <span className="font-display text-3xl text-eucalypt-600">{i + 1}</span>
              <p className="mt-2 font-semibold">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 max-w-2xl text-sm text-mist">
          Roavela doesn&apos;t guarantee bookings or income. Online booking and payments are coming soon; until then, approved listings can be discovered and saved by travellers.
        </p>
      </section>
    </div>
  );
}
