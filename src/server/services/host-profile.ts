import "server-only";
import type { z } from "zod";
import type { Role } from "@/generated/prisma/enums";
import { checkImage, IMAGE_EXTENSIONS, stripImageMetadata } from "@/lib/image-files";
import type { hostProfileSchema } from "@/lib/validation/host";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { getStorage } from "@/server/storage";
import type { HostResult } from "./host-access";

type HostProfileInput = z.infer<typeof hostProfileSchema>;

/**
 * Become a host / update the host profile. Upgrades the SAME user account (CUSTOMER → HOST); no
 * second account is created. Admins cannot become hosts. The role change happens only here, on the
 * server — nothing from the client can set a role.
 */
export async function saveHostProfile(user: { id: string; role: Role }, input: HostProfileInput): Promise<HostResult<{ created: boolean }>> {
  if (user.role === "ADMIN") {
    return { ok: false, error: "not_editable", message: "Administrator accounts can't host. Use a separate traveller account." };
  }

  const data = {
    displayName: input.displayName,
    bio: input.bio,
    hostType: input.hostType,
    legalName: input.legalName,
    businessName: input.hostType === "BUSINESS" ? input.businessName : null,
    abn: input.abn,
    phone: input.phone,
    onboardingStatus: "COMPLETE" as const,
  };

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.hostProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    await tx.hostProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
    if (user.role === "CUSTOMER") await tx.user.update({ where: { id: user.id }, data: { role: "HOST" } });
    return !existing;
  });

  await audit(user.id, created ? "host_profile.created" : "host_profile.updated", "HostProfile", user.id, { hostType: input.hostType });
  return { ok: true, value: { created } };
}

export async function getOwnHostProfile(userId: string) {
  return prisma.hostProfile.findUnique({
    where: { userId },
    select: { id: true, displayName: true, bio: true, avatarUrl: true, hostType: true, legalName: true, businessName: true, abn: true, phone: true, createdAt: true },
  });
}

/** A host profile is complete when the private contact/identity fields Roavela needs are present. */
export function isHostProfileComplete(p: { legalName: string | null; phone: string | null; displayName: string } | null): boolean {
  return Boolean(p && p.displayName && p.legalName && p.phone);
}

export async function uploadHostAvatar(userId: string, file: File): Promise<HostResult<{ url: string }>> {
  const profile = await prisma.hostProfile.findUnique({ where: { userId }, select: { id: true, avatarKey: true } });
  if (!profile) return { ok: false, error: "not_found", message: "Create your host profile first." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkImage(bytes, 5 * 1024 * 1024);
  if (!check.ok) return { ok: false, error: "invalid", message: uploadErrorMessage(check.error, 5) };

  const storage = getStorage();
  const stored = await storage.put({ visibility: "public", folder: "avatars", extension: IMAGE_EXTENSIONS[check.type], bytes: stripImageMetadata(bytes, check.type) });
  await prisma.hostProfile.update({ where: { id: profile.id }, data: { avatarUrl: stored.url, avatarKey: stored.key } });
  if (profile.avatarKey) await storage.delete(profile.avatarKey).catch(() => {});
  return { ok: true, value: { url: stored.url! } };
}

export function uploadErrorMessage(error: "empty" | "too_large" | "unsupported_type", maxMb: number): string {
  switch (error) {
    case "empty":
      return "That file is empty.";
    case "too_large":
      return `That file is larger than ${maxMb} MB.`;
    case "unsupported_type":
      return "Upload a JPEG, PNG or WebP image.";
  }
}
