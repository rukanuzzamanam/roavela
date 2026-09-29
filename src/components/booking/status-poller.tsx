"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-reads the server's booking state every few seconds while a payment is being verified. */
export function StatusPoller({ intervalMs = 2500, maxMs = 90_000 }: { intervalMs?: number; maxMs?: number }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started > maxMs) {
        clearInterval(id);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxMs, router]);
  return gaveUp ? (
    <p className="text-sm text-ink-soft">This is taking longer than usual. We&apos;ll email you as soon as the payment is confirmed — you can safely leave this page.</p>
  ) : null;
}
