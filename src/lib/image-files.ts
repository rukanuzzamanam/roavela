/**
 * Image upload safety, independent of any storage provider.
 *
 * - The type is detected from the file's bytes ("magic numbers"), never from its name or the
 *   browser-supplied MIME type, so an .html or .svg renamed to .jpg is rejected.
 * - Only raster JPEG, PNG and WebP are accepted. SVG is refused (it can carry script).
 * - Metadata (EXIF/XMP, including GPS coordinates that could reveal a host's home) is stripped
 *   before storage.
 */

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

export const IMAGE_EXTENSIONS: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

/** PDF documents (for compliance uploads) and images. */
export type DocumentType = ImageType | "application/pdf";

export function detectDocumentType(bytes: Uint8Array): DocumentType | null {
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return detectImageType(bytes);
}

export type ImageCheck = { ok: true; type: ImageType } | { ok: false; error: "empty" | "too_large" | "unsupported_type" };

export function checkImage(bytes: Uint8Array, maxBytes = MAX_IMAGE_BYTES): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > maxBytes) return { ok: false, error: "too_large" };
  const type = detectImageType(bytes);
  return type ? { ok: true, type } : { ok: false, error: "unsupported_type" };
}

// ── Metadata stripping ──────────────────────────────────────────────────────

/** JPEG: drop APP1 (EXIF / XMP) and COM segments; keep everything else untouched. */
function stripJpeg(b: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break; // malformed — stop and keep the rest verbatim
    const marker = b[i + 1]!;
    if (marker === 0xda) {
      // Start of scan: the rest is compressed image data.
      out.push(...b.subarray(i));
      return Uint8Array.from(out);
    }
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    const segEnd = i + 2 + len;
    if (segEnd > b.length) break;
    const drop = marker === 0xe1 || marker === 0xfe;
    if (!drop) out.push(...b.subarray(i, segEnd));
    i = segEnd;
  }
  out.push(...b.subarray(i));
  return Uint8Array.from(out);
}

/** PNG: drop eXIf, tEXt, zTXt, iTXt and tIME chunks. */
function stripPng(b: Uint8Array): Uint8Array {
  const DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) break;
    if (!DROP.has(type)) parts.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

/** WebP: drop EXIF and XMP chunks, clear their VP8X flags and fix the RIFF size. */
function stripWebp(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const id = ascii(b, i, 4);
    const size = b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | ((b[i + 7]! << 24) >>> 0);
    const end = i + 8 + size + (size % 2);
    if (end > b.length + 1) break;
    const chunk = Uint8Array.from(b.subarray(i, Math.min(end, b.length)));
    if (id === "VP8X" && chunk.length > 8) chunk[8] = chunk[8]! & ~(0x08 | 0x04);
    if (id !== "EXIF" && id !== "XMP ") parts.push(chunk);
    i = end;
  }
  const body = concat(parts);
  const riff = new Uint8Array(12 + body.length);
  riff.set(b.subarray(0, 12));
  const riffSize = 4 + body.length;
  riff[4] = riffSize & 0xff;
  riff[5] = (riffSize >> 8) & 0xff;
  riff[6] = (riffSize >> 16) & 0xff;
  riff[7] = (riffSize >>> 24) & 0xff;
  riff.set(body, 12);
  return riff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
  switch (type) {
    case "image/jpeg":
      return stripJpeg(bytes);
    case "image/png":
      return stripPng(bytes);
    case "image/webp":
      return stripWebp(bytes);
  }
}
