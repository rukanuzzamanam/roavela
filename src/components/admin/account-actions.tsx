import type { UserStatus } from "@/generated/prisma/enums";
import { reactivateAccountAction, suspendAccountAction } from "@/server/actions/admin-operations";
import { ConfirmAction } from "./admin-forms";

/** Suspend / reactivate controls for a host or customer account (two-step, reason required). */
export function AccountActions({ userId, status, version, kind }: { userId: string; status: UserStatus; version: string; kind: "host" | "customer" }) {
  const hidden = { userId, version };
  if (status === "ACTIVE") {
    return (
      <ConfirmAction
        action={suspendAccountAction}
        hidden={hidden}
        tone="danger"
        label={`Suspend ${kind}`}
        title={`Suspend this ${kind} account?`}
        description={
          kind === "host" ? (
            <ul className="list-disc space-y-1 pl-5">
              <li>The host is signed out everywhere and can&apos;t log in, submit or edit listings.</li>
              <li>Every live or paused listing is suspended (hidden and unbookable).</li>
              <li>Existing confirmed bookings are kept — they are NOT cancelled or refunded automatically. Handle them from each booking.</li>
              <li>Nothing is deleted.</li>
            </ul>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              <li>The customer is signed out everywhere and can&apos;t log in or make bookings.</li>
              <li>Existing bookings, payments and reviews are kept unchanged.</li>
              <li>Nothing is deleted.</li>
            </ul>
          )
        }
        confirmLabel="Suspend account"
        fields={[{ type: "textarea", name: "reason", label: "Reason (included in the email to the account holder and the audit log)", required: true }]}
      />
    );
  }
  return (
    <ConfirmAction
      action={reactivateAccountAction}
      hidden={hidden}
      label="Reactivate account"
      title="Reactivate this account?"
      description={kind === "host" ? "The host can log in again. Listings suspended by the account suspension return as paused; listings suspended individually stay suspended." : "The customer can log in and book again."}
      confirmLabel="Reactivate"
      fields={[{ type: "textarea", name: "reason", label: "Reason (recorded in the audit log)", required: true, rows: 2 }]}
    />
  );
}
