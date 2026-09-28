import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { can } from "@/lib/permissions";
import { signOut } from "@/server/actions/auth";
import { getCurrentUser } from "@/server/auth/session";
import { MobileMenu, type NavLink } from "./mobile-menu";

export async function Navbar() {
  // Navigation degrades to a signed-out view if the session can't be resolved (e.g. DB offline).
  const user = await getCurrentUser().catch(() => null);

  const links: NavLink[] = [{ href: "/search", label: "Find a stay" }];
  if (user && can(user.role, "host:portal")) links.push({ href: "/host", label: "Host portal" });
  if (user && can(user.role, "admin:portal")) links.push({ href: "/admin", label: "Admin" });

  return (
    <header className="sticky top-0 z-40 border-b border-ink/8 bg-sand-50/85 backdrop-blur-md">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow-card"
      >
        Skip to content
      </a>
      <nav aria-label="Main" className="container-page flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="Roavela home" className="rounded-full">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
              {l.label}
            </Link>
          ))}
          <span className="mx-2 h-5 w-px bg-ink/15" aria-hidden />
          {user ? (
            <>
              <Link href="/account" className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                {user.name.split(" ")[0]}
              </Link>
              <form action={signOut}>
                <button type="submit" className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                Log in
              </Link>
              <Link href="/signup" className="rounded-full bg-eucalypt-700 px-4 py-2 text-sm font-semibold text-white hover:bg-eucalypt-800">
                Sign up
              </Link>
            </>
          )}
        </div>

        <MobileMenu links={links} user={user ? { name: user.name } : null} signOutAction={signOut} />
      </nav>
    </header>
  );
}
