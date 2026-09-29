"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { MAX_PHOTOS, MIN_PHOTOS } from "@/lib/listing-checklist";
import { cn } from "@/lib/utils";
import { photoAction, uploadPhotoAction, type HostFormState } from "@/server/actions/host";

interface Photo {
  id: string;
  url: string;
  alt: string;
}

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_MB = 10;

/**
 * Photo management: multi-file upload (sent one at a time, with per-file status), descriptions,
 * reorder, choose cover and delete. The server re-validates type, size, count and ownership.
 */
export function PhotoManager({ propertyId, photos, editable }: { propertyId: string; photos: Photo[]; editable: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<{ name: string; status: "uploading" | "done" | "error"; message?: string }[]>([]);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function upload(files: FileList) {
    const list = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    setQueue(list.map((f) => ({ name: f.name, status: "uploading" })));
    for (const [i, file] of list.entries()) {
      let status: "done" | "error" = "done";
      let msg: string | undefined;
      // Quick client-side checks for fast feedback; the server checks again (by file contents).
      if (!ACCEPT.split(",").includes(file.type)) [status, msg] = ["error", "Only JPEG, PNG or WebP images."];
      else if (file.size > MAX_MB * 1024 * 1024) [status, msg] = ["error", `Larger than ${MAX_MB} MB.`];
      else {
        const fd = new FormData();
        fd.set("propertyId", propertyId);
        fd.set("photo", file);
        const r: HostFormState = await uploadPhotoAction({}, fd).catch(() => ({ ok: false, message: "Upload failed — check your connection." }));
        if (!r.ok) [status, msg] = ["error", r.message];
      }
      setQueue((q) => q.map((item, j) => (j === i ? { ...item, status, message: msg } : item)));
    }
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  function run(op: string, imageId: string, extra?: Record<string, string>) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("op", op);
      fd.set("imageId", imageId);
      for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
      const r = await photoAction({}, fd).catch(() => ({ ok: false, message: "Something went wrong — check your connection." }) as HostFormState);
      setMessage(r.ok ? (op === "alt" ? "Description saved." : null) : (r.message ?? "Couldn't update the photo."));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {editable && (
        <div className="rounded-2xl border-2 border-dashed border-ink/15 bg-white p-6 text-center">
          <Icon name="images" size={28} className="mx-auto text-eucalypt-600" />
          <p className="mt-2 font-semibold">Add photos</p>
          <p className="text-sm text-mist">
            JPEG, PNG or WebP, up to {MAX_MB} MB each. At least {MIN_PHOTOS}, up to {MAX_PHOTOS}. Location data in photos is removed automatically.
          </p>
          <input ref={inputRef} id="photo-upload" type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => e.target.files && upload(e.target.files)} disabled={photos.length >= MAX_PHOTOS} />
          <label
            htmlFor="photo-upload"
            className={cn("mt-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-eucalypt-700 px-5 font-semibold text-white hover:bg-eucalypt-800", photos.length >= MAX_PHOTOS && "pointer-events-none opacity-50")}
          >
            <Icon name="plus" size={16} />
            Choose photos
          </label>
          {queue.length > 0 && (
            <ul className="mt-4 space-y-1 text-left text-sm" aria-live="polite">
              {queue.map((q, i) => (
                <li key={i} className="flex items-center gap-2">
                  {q.status === "uploading" && <span className="size-3 animate-pulse rounded-full bg-ochre-400" aria-hidden />}
                  {q.status === "done" && <Icon name="check" size={14} className="text-eucalypt-600" />}
                  {q.status === "error" && <Icon name="alert" size={14} className="text-ochre-600" />}
                  <span className="truncate">{q.name}</span>
                  <span className="text-mist">{q.status === "uploading" ? "Uploading…" : q.status === "done" ? "Uploaded" : q.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {message && (
        <p role="status" className="text-sm font-semibold text-ink-soft">
          {message}
        </p>
      )}

      {photos.length === 0 ? (
        <p className="text-mist">No photos yet.</p>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy={busy}>
          {photos.map((p, i) => (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
              <div className="relative aspect-[4/3] bg-sand-200">
                <Image src={p.url} alt={p.alt || `Photo ${i + 1}`} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw" unoptimized={p.url.endsWith(".svg")} className="object-cover" />
                {i === 0 && <span className="absolute top-2 left-2 rounded-full bg-ink/80 px-2.5 py-1 text-xs font-semibold text-white">Cover photo</span>}
              </div>
              <div className="space-y-3 p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run("alt", p.id, { alt: String(new FormData(e.currentTarget).get("alt") ?? "") });
                  }}
                  className="flex gap-2"
                >
                  <label className="sr-only" htmlFor={`alt-${p.id}`}>
                    Describe photo {i + 1}
                  </label>
                  <input
                    id={`alt-${p.id}`}
                    name="alt"
                    defaultValue={p.alt}
                    placeholder="Describe this photo"
                    maxLength={160}
                    disabled={!editable}
                    className={cn("h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm", p.alt ? "border-ink/15" : "border-ochre-300 bg-ochre-50")}
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={!editable || busy}>
                    Save
                  </Button>
                </form>
                {editable && (
                  <div className="flex flex-wrap gap-1">
                    <IconButton label={`Move photo ${i + 1} earlier`} icon="chevronRight" rotate onClick={() => run("up", p.id)} disabled={busy || i === 0} />
                    <IconButton label={`Move photo ${i + 1} later`} icon="chevronRight" onClick={() => run("down", p.id)} disabled={busy || i === photos.length - 1} />
                    {i !== 0 && (
                      <Button size="sm" variant="ghost" onClick={() => run("cover", p.id)} disabled={busy}>
                        Make cover
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-ochre-700"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this photo? This can't be undone.")) run("delete", p.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function IconButton({ label, icon, onClick, disabled, rotate }: { label: string; icon: string; onClick: () => void; disabled?: boolean; rotate?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="grid size-9 place-items-center rounded-full border border-ink/15 hover:bg-sand-100 disabled:opacity-30">
      <Icon name={icon} size={16} className={rotate ? "rotate-180" : undefined} />
    </button>
  );
}
