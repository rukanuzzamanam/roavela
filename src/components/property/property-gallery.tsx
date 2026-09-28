"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { PropertyImage } from "./property-image";

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

/**
 * Property gallery.
 * - Mobile: swipeable, snap-scrolling strip.
 * - Desktop: mosaic of up to five images.
 * - "Show all photos" opens an accessible dialog (focus-trapped, Escape closes) with the full set;
 *   selecting a photo opens a viewer navigable with ← / → keys. Dialog images mount only when
 *   opened, so large galleries aren't loaded up-front.
 */
export function PropertyGallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  const close = () => {
    setOpen(false);
    setActive(null);
  };
  const openAt = (i: number | null) => {
    setActive(i);
    setOpen(true);
  };

  if (images.length === 0) {
    return <PropertyImage src={null} alt="" className="aspect-[16/9] rounded-[1.75rem]" />;
  }

  const [cover, ...rest] = images;
  return (
    <section aria-label="Photos" className="relative">
      {/* Mobile strip */}
      <ul className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:hidden">
        {images.map((img, i) => (
          <li key={img.id} className="w-[88vw] shrink-0 snap-center">
            <button type="button" onClick={() => openAt(i)} className="block w-full rounded-2xl" aria-label={`Open photo ${i + 1} of ${images.length}: ${img.alt}`}>
              <PropertyImage src={img.url} alt={img.alt} priority={i === 0} sizes="88vw" className="aspect-[4/3] rounded-2xl" />
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop mosaic */}
      <div className={cn("hidden h-[28rem] gap-2 overflow-hidden rounded-[1.75rem] sm:grid lg:h-[32rem]", rest.length > 0 ? "grid-cols-4 grid-rows-2" : "grid-cols-1")}>
        {cover && (
          <button type="button" onClick={() => openAt(0)} className={cn("relative block", rest.length > 0 && "col-span-2 row-span-2")} aria-label={`Open photo 1 of ${images.length}: ${cover.alt}`}>
            <PropertyImage src={cover.url} alt={cover.alt} priority sizes="50vw" className="size-full transition hover:brightness-95" />
          </button>
        )}
        {rest.slice(0, 4).map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => openAt(i + 1)}
            className={cn("relative block", rest.length < 3 && "row-span-2")}
            aria-label={`Open photo ${i + 2} of ${images.length}: ${img.alt}`}
          >
            <PropertyImage src={img.url} alt={img.alt} sizes="25vw" className="size-full transition hover:brightness-95" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => openAt(null)}
        className="absolute right-4 bottom-4 inline-flex min-h-10 items-center gap-2 rounded-full border border-ink/15 bg-white/95 px-4 text-sm font-semibold shadow-card backdrop-blur hover:bg-white"
      >
        <Icon name="images" size={16} />
        Show all {images.length} photos
      </button>

      <Modal open={open} onClose={close} title={active === null ? `Photos of ${title}` : `Photo ${active + 1} of ${images.length}`} size="full">
        {open && (active === null ? <PhotoGrid images={images} onSelect={setActive} /> : <PhotoViewer images={images} index={active} onChange={setActive} onBack={() => setActive(null)} />)}
      </Modal>
    </section>
  );
}

function PhotoGrid({ images, onSelect }: { images: GalleryImage[]; onSelect: (i: number) => void }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {images.map((img, i) => (
        <li key={img.id} className={cn(i % 3 === 0 && "sm:col-span-2")}>
          <button type="button" onClick={() => onSelect(i)} className="block w-full overflow-hidden rounded-2xl" aria-label={`View photo ${i + 1}: ${img.alt}`}>
            <div className={cn("relative bg-sand-200", i % 3 === 0 ? "aspect-[16/9]" : "aspect-[4/3]")}>
              <Image src={img.url} alt={img.alt} fill sizes="(min-width: 640px) 60vw, 100vw" unoptimized={img.url.endsWith(".svg")} className="object-cover" />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PhotoViewer({
  images,
  index,
  onChange,
  onBack,
}: {
  images: GalleryImage[];
  index: number;
  onChange: (i: number) => void;
  onBack: () => void;
}) {
  const img = images[index]!;
  const prev = useCallback(() => onChange((index - 1 + images.length) % images.length), [index, images.length, onChange]);
  const next = useCallback(() => onChange((index + 1) % images.length), [index, images.length, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next]);

  const navBtn = "grid size-12 shrink-0 place-items-center rounded-full border border-ink/15 bg-white hover:bg-sand-100";
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-10 items-center gap-1 self-start rounded-full px-3 text-sm font-semibold hover:bg-ink/5">
        <Icon name="chevronRight" size={16} className="rotate-180" />
        All photos
      </button>
      <figure>
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-sand-200 sm:aspect-[16/10]">
          <Image src={img.url} alt={img.alt} fill sizes="90vw" unoptimized={img.url.endsWith(".svg")} className="object-contain" />
        </div>
        <figcaption className="mt-2 text-sm text-mist">{img.alt}</figcaption>
      </figure>
      <div className="flex items-center justify-between gap-4">
        <button type="button" onClick={prev} className={navBtn} aria-label="Previous photo">
          <Icon name="chevronRight" size={20} className="rotate-180" />
        </button>
        <p className="text-sm font-semibold tabular-nums" aria-live="polite">
          {index + 1} / {images.length}
        </p>
        <button type="button" onClick={next} className={navBtn} aria-label="Next photo">
          <Icon name="chevronRight" size={20} />
        </button>
      </div>
      <p className="text-center text-xs text-mist">Tip: use the ← and → keys to browse.</p>
    </div>
  );
}
