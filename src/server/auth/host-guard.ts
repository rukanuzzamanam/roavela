import "server-only";
import { forbidden, redirect } from "next/navigation";
import { requireUser } from "./guards";
import type { SessionUser } from "./session";

/**
 * Host-portal pages: signed-in HOSTs only. Travellers are sent to the "become a host" page;
 * admins get a 403 (admin accounts don't host). Every host Server Action and service also
 * re-checks authorisation and ownership — this guard is not the only line of defence.
 */
export async function requireHost(returnTo: string): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  if (user.role === "CUSTOMER") redirect("/host/start");
  if (user.role !== "HOST") forbidden();
  return user;
}
