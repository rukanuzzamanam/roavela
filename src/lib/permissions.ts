import type { Role } from "@/generated/prisma/enums";

/**
 * Capability-based authorisation. Roles are always read from the database on the server —
 * never from anything the browser sends.
 *
 * A HOST can also travel as a guest; ADMIN is a separate operational role and does not
 * inherit host tooling.
 */
export const PERMISSIONS = {
  "account:manage": ["CUSTOMER", "HOST", "ADMIN"],
  "favourite:manage": ["CUSTOMER", "HOST"],
  "booking:create": ["CUSTOMER", "HOST"],
  "review:create": ["CUSTOMER", "HOST"],
  /** Travellers can upgrade their own account to a host account. Admins cannot. */
  "host:become": ["CUSTOMER"],
  "host:portal": ["HOST"],
  "property:create": ["HOST"],
  "property:manage": ["HOST"],
  "admin:portal": ["ADMIN"],
  "admin:properties:moderate": ["ADMIN"],
  "admin:users:manage": ["ADMIN"],
  "admin:compliance:review": ["ADMIN"],
  "admin:config:manage": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export interface Actor {
  id: string;
  role: Role;
}

/** A host may only manage properties attached to their own host profile. */
export function canManageProperty(actor: Actor | null | undefined, property: { hostUserId: string }): boolean {
  if (!actor || !can(actor.role, "host:portal")) return false;
  return actor.id === property.hostUserId;
}
