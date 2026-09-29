"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { saveSectionAction, type HostFormState } from "@/server/actions/host";
import { FormMessage } from "./host-ui";

/**
 * Wraps a listing section's fields. Saving is deliberate (no request per keystroke):
 *  - "Unsaved changes" appears as soon as a field changes, and leaving the page warns first.
 *  - "Saving…" while the request runs, then "Saved" or the error.
 */
export function SectionForm({
  propertyId,
  section,
  children,
  isLast = false,
}: {
  propertyId: string;
  section: string;
  /** Render prop so fields can show their own errors. Used from client section components. */
  children: (state: HostFormState) => ReactNode;
  isLast?: boolean;
}) {
  const [state, action, pending] = useActionState<HostFormState, FormData>(saveSectionAction, {});
  const [dirty, setDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | undefined>(undefined);

  // A new successful save clears the dirty flag (derived from the action result, not an effect).
  if (state.savedAt && state.savedAt !== lastSaved) {
    setLastSaved(state.savedAt);
    setDirty(false);
  }

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const status = pending ? "Saving…" : dirty ? "Unsaved changes" : state.ok && lastSaved ? "Saved" : state.message ? "Not saved" : "";

  return (
    <form action={action} onChange={() => setDirty(true)} className="space-y-6" noValidate>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="section" value={section} />
      <FormMessage state={state} />
      {children(state)}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-ink/10 bg-sand-50/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0">
        <Button type="submit" name="then" value="continue" disabled={pending}>
          {isLast ? "Save & preview" : "Save & continue"}
          <Icon name="arrowRight" size={16} />
        </Button>
        <Button type="submit" variant="outline" disabled={pending}>
          Save
        </Button>
        <p role="status" aria-live="polite" className={status === "Saved" ? "text-sm font-semibold text-eucalypt-700" : status === "Not saved" ? "text-sm font-semibold text-ochre-700" : "text-sm text-mist"}>
          {status === "Saved" && <Icon name="check" size={14} className="mr-1 inline" />}
          {status}
        </p>
      </div>
    </form>
  );
}
