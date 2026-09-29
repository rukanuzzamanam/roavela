"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Display only — the server enforces the hold. When it reaches zero the page refreshes and the
 * server shows the expired state.
 */
export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const end = new Date(expiresAt).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = end - Date.now();
      setLeft(Math.max(0, ms));
      if (ms <= 0) router.refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [end, router]);

  if (left === null) return null;
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <p className="text-sm text-ink-soft">
      Dates held for{" "}
      <strong className="tabular-nums" aria-live={left < 60_000 ? "polite" : "off"}>
        {m}:{String(s).padStart(2, "0")}
      </strong>
    </p>
  );
}
