import "server-only";
import { checkImage, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, stripImageMetadata } from "@/lib/image-files";
import { MAX_PHOTOS, MIN_PHOTOS } from "@/lib/listing-checklist";
import { REVIEWED_STATUSES } from "@/lib/listing-lifecycle";
import { prisma } from "@/server/db";
import { getStorage } from "@/server/storage";
import { loadEditableProperty, noteEdit, notFound, withSection, type HostResult } from "./host-access";
import { uploadErrorMessage } from "./host-profile";

/**
 * Property photos. Every operation re-checks that the photo's property belongs to the session
 * user and is editable. Position 0 is the cover photo.
 */

export async function uploadPropertyPhoto(userId: string, propertyId: string, file: File, alt = ""): Promise<HostResult<{ id: string; url: string }>> {
  const loaded = await loadEditableProperty(userId, propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;

  const count = await prisma.propertyImage.count({ where: { propertyId: p.id } });
  if (count >= MAX_PHOTOS) return { ok: false, error: "limit", message: `A listing can have up to ${MAX_PHOTOS} photos.` };

  // Size is checked before reading the whole body into a buffer we keep.
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "invalid", message: uploadErrorMessage("too_large", 10) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImage(bytes);
  if (!check.ok) return { ok: false, error: "invalid", message: uploadErrorMessage(check.error, 10) };

  const storage = getStorage();
  const stored = await storage.put({
    visibility: "public",
    folder: `properties/${p.id}`,
    extension: IMAGE_EXTENSIONS[check.type],
    bytes: stripImageMetadata(bytes, check.type),
  });

  try {
    const image = await prisma.propertyImage.create({
      data: { propertyId: p.id, url: stored.url!, storageKey: stored.key, alt: alt.trim().slice(0, 160), position: count },
      select: { id: true, url: true },
    });
    await prisma.property.update({ where: { id: p.id }, data: { completedSections: withSection(p.completedSections, "photos") } });
    await noteEdit(userId, p, "photos");
    return { ok: true, value: image };
  } catch (e) {
    await storage.delete(stored.key).catch(() => {}); // don't leave orphaned files
    throw e;
  }
}

async function loadOwnedPhoto(userId: string, imageId: string) {
  return prisma.propertyImage.findFirst({
    where: { id: imageId, property: { host: { userId } } },
    select: { id: true, propertyId: true, storageKey: true, position: true },
  });
}

export async function updatePhotoAlt(userId: string, imageId: string, alt: string): Promise<HostResult> {
  const image = await loadOwnedPhoto(userId, imageId);
  if (!image) return notFound();
  const loaded = await loadEditableProperty(userId, image.propertyId);
  if (!loaded.ok) return loaded;
  await prisma.propertyImage.update({ where: { id: image.id }, data: { alt } });
  await noteEdit(userId, loaded.value, "photos");
  return { ok: true, value: undefined };
}

export async function deletePropertyPhoto(userId: string, imageId: string): Promise<HostResult> {
  const image = await loadOwnedPhoto(userId, imageId);
  if (!image) return notFound();
  const loaded = await loadEditableProperty(userId, image.propertyId);
  if (!loaded.ok) return loaded;
  const p = loaded.value;

  const count = await prisma.propertyImage.count({ where: { propertyId: p.id } });
  if (REVIEWED_STATUSES.includes(p.status) && count <= MIN_PHOTOS) {
    return { ok: false, error: "conflict", message: `Live listings need at least ${MIN_PHOTOS} photos. Upload another before deleting this one.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.propertyImage.delete({ where: { id: image.id } });
    await renumber(tx, p.id);
  });
  if (image.storageKey) await getStorage().delete(image.storageKey).catch(() => {});
  await noteEdit(userId, p, "photos");
  return { ok: true, value: undefined };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function renumber(tx: Tx, propertyId: string, order?: string[]) {
  const images = await tx.propertyImage.findMany({ where: { propertyId }, orderBy: { position: "asc" }, select: { id: true } });
  const ids = order ?? images.map((i) => i.id);
  for (const [position, id] of ids.entries()) {
    await tx.propertyImage.update({ where: { id }, data: { position } });
  }
}

export async function movePhoto(userId: string, imageId: string, direction: "up" | "down" | "cover"): Promise<HostResult> {
  const image = await loadOwnedPhoto(userId, imageId);
  if (!image) return notFound();
  const loaded = await loadEditableProperty(userId, image.propertyId);
  if (!loaded.ok) return loaded;

  await prisma.$transaction(async (tx) => {
    const ids = (await tx.propertyImage.findMany({ where: { propertyId: image.propertyId }, orderBy: { position: "asc" }, select: { id: true } })).map((i) => i.id);
    const i = ids.indexOf(image.id);
    if (direction === "cover") {
      ids.splice(i, 1);
      ids.unshift(image.id);
    } else {
      const j = direction === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    await renumber(tx, image.propertyId, ids);
  });
  await noteEdit(userId, loaded.value, "photos");
  return { ok: true, value: undefined };
}
