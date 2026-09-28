"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";

export interface NavLink {
  href: string;
  label: string;
}

export function MobileMenu({
  links,
  user,
  signOutAction,
}: {
  links: NavLink[];
  user: { name: string } | null;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // Close the menu when a link is followed.
  const close = () => setOpen(false);

  const item = "flex items-center justify-between rounded-2xl px-4 py-3.5 text-base font-semibold hover:bg-sand-100";

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-full border border-ink/10 bg-white"
        aria-label="Open menu"
        aria-haspopup="dialog"
      >
        <Icon name="menu" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Menu" variant="sheet">
        <ul className="space-y-1">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className={item} onClick={close}>
                {l.label}
                <Icon name="chevronRight" size={18} className="text-mist" />
              </Link>
            </li>
          ))}
          {user && (
            <li>
              <Link href="/account" className={item} onClick={close}>
                Account
                <Icon name="chevronRight" size={18} className="text-mist" />
              </Link>
            </li>
          )}
        </ul>
        <div className="mt-6 grid gap-3">
          {user ? (
            <form action={signOutAction}>
              <button type="submit" className={buttonClasses({ variant: "outline", className: "w-full" })}>
                Log out
              </button>
            </form>
          ) : (
            <>
              <Link href="/signup" className={buttonClasses({ className: "w-full" })} onClick={close}>
                Sign up
              </Link>
              <Link href="/login" className={buttonClasses({ variant: "outline", className: "w-full" })} onClick={close}>
                Log in
              </Link>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
