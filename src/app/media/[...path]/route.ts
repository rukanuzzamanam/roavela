import { isValidStorageKey, getStorage } from "@/server/storage";

/**
 * Serves PUBLIC uploaded images (property photos, host avatars) from the storage provider.
 * Private objects (compliance documents) are never reachable here: the key is always prefixed
 * with "public/". Responses are locked down so an uploaded file can never execute as a page.
 */
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = `public/${path.join("/")}`;
  const ext = key.split(".").pop() ?? "";
  if (!isValidStorageKey(key) || !TYPES[ext]) return new Response("Not found", { status: 404 });

  const bytes = await getStorage().get(key);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": TYPES[ext],
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
