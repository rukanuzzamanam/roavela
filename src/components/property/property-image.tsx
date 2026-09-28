import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Property/destination image with a branded fallback. SVG demo illustrations are served
 * unoptimised; photos from the image-storage provider go through next/image optimisation.
 */
export function PropertyImage({
  src,
  alt,
  className,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (!src) {
    return (
      <div className={cn("grid place-items-center bg-gradient-to-br from-eucalypt-100 to-sand-200 text-eucalypt-600", className)}>
        <span className="text-sm font-semibold">Photo coming soon</span>
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden bg-sand-200", className)}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={src.endsWith(".svg")}
        className="object-cover"
      />
    </div>
  );
}
