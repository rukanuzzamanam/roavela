import { Icon } from "@/components/ui/icons";

/** Shown wherever money is involved: Roavela only runs payments in Stripe TEST MODE. */
export function TestModeBanner({ provider }: { provider?: "stripe" | "mock" }) {
  return (
    <div role="note" className="flex gap-3 rounded-2xl border-2 border-dashed border-ochre-400 bg-ochre-50 p-4 text-ink">
      <span className="h-fit shrink-0 rounded-md bg-ochre-500 px-2 py-0.5 text-xs font-bold tracking-wider text-white">TEST MODE</span>
      <p className="text-sm">
        <strong>No real money will be charged.</strong>{" "}
        {provider === "mock"
          ? "Stripe isn't configured on this server, so payments are simulated for development."
          : "Payments run in Stripe test mode — use a Stripe test card such as 4242 4242 4242 4242. Real cards are not accepted."}
      </p>
      <Icon name="shield" size={20} className="ml-auto hidden shrink-0 text-ochre-600 sm:block" />
    </div>
  );
}
