"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icons";
import { simulatePayment, startPayment } from "@/server/actions/bookings";
import type { PreparePaymentResult } from "@/server/services/checkout";

const stripePromises = new Map<string, Promise<Stripe | null>>();
function getStripe(publishableKey: string) {
  if (!stripePromises.has(publishableKey)) stripePromises.set(publishableKey, loadStripe(publishableKey));
  return stripePromises.get(publishableKey)!;
}

/**
 * Payment step. The amount is fixed server-side on the PaymentIntent; this component only collects
 * card details inside Stripe's own iframe (Roavela never sees them). A successful confirmation here
 * does NOT confirm the booking — the status page waits for the verified webhook.
 */
export function CheckoutPayment({ reference, totalLabel }: { reference: string; totalLabel: string }) {
  const [prepared, setPrepared] = useState<PreparePaymentResult | null>(null);
  const router = useRouter();
  const statusUrl = `/checkout/${reference}/complete`;

  useEffect(() => {
    let live = true;
    startPayment(reference)
      .then((r) => {
        if (!live) return;
        if (!r.ok && r.state === "processing") router.replace(statusUrl);
        setPrepared(r);
      })
      .catch(() => live && setPrepared({ ok: false, state: "config", error: "We couldn't start the payment. Please refresh and try again." }));
    return () => {
      live = false;
    };
  }, [reference, router, statusUrl]);

  if (!prepared) {
    return (
      <div aria-busy="true" aria-label="Loading secure payment form" className="space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-13 rounded-full" />
      </div>
    );
  }
  if (!prepared.ok) return <ErrorNote>{prepared.error}</ErrorNote>;
  if (prepared.provider === "mock") return <MockPayment reference={reference} totalLabel={totalLabel} statusUrl={statusUrl} />;

  return (
    <Elements
      stripe={getStripe(prepared.publishableKey)}
      options={{ clientSecret: prepared.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#2f5d50", borderRadius: "12px" } } }}
    >
      <StripeForm totalLabel={totalLabel} statusUrl={statusUrl} />
    </Elements>
  );
}

function StripeForm({ totalLabel, statusUrl }: { totalLabel: string; statusUrl: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: new URL(statusUrl, window.location.origin).toString() },
      redirect: "if_required",
    });
    if (stripeError) {
      // e.g. a declined test card. Nothing is booked; the guest can try again while the hold lasts.
      setError(stripeError.message ?? "Your payment didn't go through. Please try again.");
      setBusy(false);
      return;
    }
    // The browser's word isn't proof of payment — the status page waits for the server's webhook.
    router.push(statusUrl);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button type="submit" variant="accent" size="lg" className="w-full" disabled={!stripe || !ready || busy} aria-busy={busy}>
        <Icon name="shield" size={18} />
        {busy ? "Processing…" : `Pay securely · ${totalLabel}`}
      </Button>
    </form>
  );
}

function MockPayment({ reference, totalLabel, statusUrl }: { reference: string; totalLabel: string; statusUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "succeeded" | "failed">(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(outcome: "succeeded" | "failed") {
    setBusy(outcome);
    setMessage(null);
    const r = await simulatePayment(reference, outcome).catch(() => ({ ok: false, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!r.ok) return setMessage(r.error ?? "Something went wrong.");
    if (outcome === "failed") return setMessage("Simulated decline: the payment didn't go through and nothing was booked. You can try again.");
    router.push(statusUrl);
  }

  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-sand-100 p-3 text-sm text-ink-soft">
        <strong>Simulated payment (development).</strong> No card form is shown and no card data is collected. The buttons below send a simulated provider
        event through the same verification and confirmation code as a real Stripe webhook.
      </p>
      {message && <ErrorNote>{message}</ErrorNote>}
      <Button variant="accent" size="lg" className="w-full" disabled={busy !== null} aria-busy={busy === "succeeded"} onClick={() => run("succeeded")}>
        <Icon name="shield" size={18} />
        {busy === "succeeded" ? "Processing…" : `Pay securely · ${totalLabel}`}
      </Button>
      <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => run("failed")}>
        Simulate a declined card
      </Button>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex gap-2 rounded-xl bg-ochre-50 p-3 text-sm text-ochre-700">
      <Icon name="alert" size={18} className="shrink-0" />
      {children}
    </p>
  );
}
