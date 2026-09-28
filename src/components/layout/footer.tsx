import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { siteConfig } from "@/config/site";

export function Footer() {
  return (
    <footer className="mt-24 bg-eucalypt-900 text-eucalypt-100">
      <div className="container-page grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo inverted />
          <p className="max-w-sm font-display text-2xl leading-snug text-white">{siteConfig.tagline}</p>
          <div className="road-line w-40 text-ochre-300" aria-hidden />
        </div>
        <FooterColumn
          title="Travel"
          links={[
            { href: "/search", label: "Find a stay" },
            { href: "/search?drive=2", label: "Under 2 hours away" },
            { href: "/search?collection=pet-friendly", label: "Pet-friendly stays" },
          ]}
        />
        <FooterColumn
          title="Roavela"
          links={[
            { href: "/signup", label: "Create an account" },
            { href: "/login", label: "Log in" },
          ]}
        />
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-2 py-6 text-sm text-eucalypt-200 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Roavela. Drive times are estimates — always check conditions before you travel.</p>
          <p>Made in Australia</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-4 font-sans text-sm font-bold tracking-wider text-eucalypt-300 uppercase">{title}</h2>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="hover:text-white hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
