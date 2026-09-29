import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Object-storage abstraction for uploaded files (property photos, host avatars, compliance
 * documents). Files never live in PostgreSQL — only their keys and public URLs do.
 *
 * Keys are generated server-side ("public/…" or "private/…"); clients never choose paths.
 * - public/*  → served to anyone via /media/… (photos, avatars)
 * - private/* → only readable through authorised route handlers (compliance documents)
 *
 * Implementations: LocalDiskStorage (development). A Cloudinary/S3 adapter implements the same
 * interface; credentials stay server-side and are never sent to the browser.
 */
export type Visibility = "public" | "private";

export interface StoredObject {
  key: string;
  /** Browser URL for public objects; null for private objects. */
  url: string | null;
}

export interface StorageProvider {
  readonly name: string;
  put(input: { visibility: Visibility; folder: string; extension: string; bytes: Uint8Array }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^(public|private)\/[a-z0-9/_-]+\/[a-z0-9_-]+\.(jpg|png|webp|pdf)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !key.includes("..");
}

export class LocalDiskStorage implements StorageProvider {
  readonly name = "local";
  constructor(private root: string) {}

  private resolve(key: string) {
    if (!isValidStorageKey(key)) throw new Error("Invalid storage key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put({ visibility, folder, extension, bytes }: { visibility: Visibility; folder: string; extension: string; bytes: Uint8Array }) {
    const safeFolder = folder.toLowerCase().replace(/[^a-z0-9/_-]/g, "");
    const key = `${visibility}/${safeFolder}/${randomBytes(12).toString("hex")}.${extension}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return { key, url: visibility === "public" ? `/media/${key.slice("public/".length)}` : null };
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  const e = env();
  if (e.STORAGE_PROVIDER !== "local") {
    throw new Error(`STORAGE_PROVIDER="${e.STORAGE_PROVIDER}" is not implemented yet. Use "local" for development.`);
  }
  if (e.NODE_ENV === "production" && !e.STORAGE_LOCAL_ALLOW_PRODUCTION) {
    // Local disk is lost on redeploys and isn't shared between instances.
    throw new Error("Local file storage is disabled in production. Configure a storage provider.");
  }
  // Runtime data directory — must not be traced into the server bundle.
  provider = new LocalDiskStorage(path.resolve(/*turbopackIgnore: true*/ process.cwd(), e.STORAGE_LOCAL_DIR));
  return provider;
}

/** Test hook: use a specific provider (e.g. a temp directory). */
export function setStorageForTests(p: StorageProvider | undefined) {
  provider = p;
}
