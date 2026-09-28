"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { toggleFavourite } from "@/server/actions/favourites";

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
  const router = useRouter();
  const pathname = usePathname();

  function onClick(e: React.MouseEvent) {
    // The button sits on top of a card link.
    e.preventDefault();
    e.stopPropagation();
    const optimistic = !saved;
    setSaved(optimistic);
    startTransition(async () => {
      const result = await toggleFavourite({ propertyId });
      if (result.ok) {
        setSaved(result.saved);
        setMessage(result.saved ? `Saved ${propertyTitle}` : `Removed ${propertyTitle} from saved`);
        return;
      }
      setSaved(!optimistic);
      if (result.error === "unauthenticated") {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
      } else {
        setMessage("Couldn't update saved stays. Please try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${propertyTitle} from saved` : `Save ${propertyTitle}`}
        className={cn(
          "grid size-10 place-items-center rounded-full bg-white/90 shadow-card backdrop-blur transition hover:scale-105",
          className,
        )}
      >
        <Icon name="heart" size={20} className={cn("transition-colors", saved ? "fill-ochre-500 text-ochre-500" : "text-ink")} />
      </button>
      <span className="sr-only" role="status">
        {message}
      </span>
    </>
  );
}
