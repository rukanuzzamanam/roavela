"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { setFavouriteAction } from "@/server/actions/favourites";

/**
 * Save / unsave a stay. The heart updates optimistically and rolls back if the server rejects the
 * change; the server is always the source of truth. Signed-out users get a login prompt that
 * returns them to exactly where they were (path + query).
 */
export function FavouriteButton({
  propertyId,
  propertyTitle,
  initialSaved,
  className,
}: {
  propertyId: string;
  propertyTitle: string;
  initialSaved: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [returnTo, setReturnTo] = useState("/");

  function onClick(e: React.MouseEvent) {
    // The button sits on top of a card link.
    e.preventDefault();
    e.stopPropagation();
    const target = !saved;
    setSaved(target);
    startTransition(async () => {
      const result = await setFavouriteAction({ propertyId, saved: target }).catch(() => null);
      if (result?.ok) {
        setSaved(result.saved);
        setMessage(result.saved ? `Saved ${propertyTitle}` : `Removed ${propertyTitle} from saved stays`);
        return;
      }
      setSaved(!target);
      if (result?.error === "unauthenticated") {
        setReturnTo(window.location.pathname + window.location.search);
        setPromptOpen(true);
      } else if (result?.error === "not_found") {
        setMessage("This stay is no longer available to save.");
      } else {
        setMessage("Couldn't update saved stays. Please try again.");
      }
    });
  }

  const next = encodeURIComponent(returnTo);
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${propertyTitle} from saved stays` : `Save ${propertyTitle}`}
        className={cn(
          "grid size-11 place-items-center rounded-full bg-white/90 shadow-card backdrop-blur transition hover:scale-105 disabled:cursor-wait",
          className,
        )}
      >
        <Icon name="heart" size={20} className={cn("transition-colors", saved ? "fill-ochre-500 text-ochre-500" : "text-ink")} />
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
      <Modal open={promptOpen} onClose={() => setPromptOpen(false)} title="Log in to save stays">
        <div className="space-y-5">
          <p className="text-ink-soft">Create a free account or log in to save {propertyTitle} and keep all your favourite stays in one place.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href={`/login?next=${next}`} className={buttonClasses({ className: "w-full" })}>
              Log in
            </Link>
            <Link href={`/signup?next=${next}`} className={buttonClasses({ variant: "outline", className: "w-full" })}>
              Create account
            </Link>
          </div>
        </div>
      </Modal>
    </>
  );
}
