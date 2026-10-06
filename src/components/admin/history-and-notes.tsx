import { actionLabel } from "@/lib/admin/labels";
import { addNoteAction } from "@/server/actions/admin-listings";
import type { HistoryEntry } from "@/server/services/admin/history";
import { SimpleForm } from "./admin-forms";
import { dateTime, Section, Timeline } from "./admin-ui";

/** Audit history (read-only) and INTERNAL notes for an admin detail page. */
export function HistoryAndNotes({
  history,
  notes,
  targetType,
  targetId,
  path,
}: {
  history: HistoryEntry[];
  notes: { id: string; body: string; createdAt: Date; author: { name: string } }[];
  targetType: "Property" | "User" | "Booking";
  targetId: string;
  path: string;
}) {
  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <Section id="history" title="Audit history" description="Append-only. Admin decisions and account activity.">
        <Timeline
          entries={history.map((h) => ({
            id: h.id,
            at: h.createdAt,
            who: `${h.actorName}${h.source === "admin" ? " (admin)" : ""}`,
            title: actionLabel(h.action),
            detail: h.reason ? <>Reason: {h.reason}</> : undefined,
          }))}
        />
      </Section>
      <Section id="notes" title="Internal notes" description="Visible to Roavela admins only — never shown to hosts or guests.">
        <div className="rounded-2xl border border-dashed border-ink/20 bg-white p-4">
          <p className="mb-3 inline-block rounded-md bg-ink px-2 py-0.5 text-xs font-bold tracking-wider text-white">INTERNAL NOTE</p>
          <SimpleForm action={addNoteAction} hidden={{ targetType, targetId, path }} fields={[{ type: "textarea", name: "body", label: "Add a note", required: true, rows: 3, maxLength: 4000 }]} submitLabel="Add note" />
          {notes.length > 0 && (
            <ul className="mt-4 space-y-3 border-t border-ink/10 pt-4">
              {notes.map((n) => (
                <li key={n.id}>
                  <p className="text-sm whitespace-pre-line">{n.body}</p>
                  <p className="mt-0.5 text-xs text-mist">
                    {n.author.name} · {dateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}
