"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";

/**
 * Route-level error boundary. In production Next.js strips server error messages, so users only
 * ever see this generic copy; the digest lets support correlate with server logs.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error.digest ? `Error digest: ${error.digest}` : "Unexpected client error");
  }, [error]);

  return (
    <div className="container-page py-16">
      <ErrorState
        title="Something went wrong"
        description={
          <>
            We hit an unexpected problem loading this page. Please try again.
            {error.digest && <span className="mt-2 block text-xs text-mist">Reference: {error.digest}</span>}
          </>
        }
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>Try again</Button>
            <ButtonLink href="/" variant="outline">
              Go home
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
