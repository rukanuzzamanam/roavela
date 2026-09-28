import "server-only";
import { cache } from "react";
import type { FeeRates } from "@/lib/pricing";
import { prisma } from "@/server/db";

export interface ActiveFeeSchedule extends FeeRates {
  id: string;
  name: string;
}

/**
 * The fee schedule currently in force: country-specific if one exists, otherwise the global
 * default (countryCode = null). Admin-managed; nothing in the app hard-codes percentages.
 */
export const getActiveFeeSchedule = cache(async (countryCode = "AU"): Promise<ActiveFeeSchedule> => {
  const now = new Date();
  const schedule = await prisma.platformFeeSchedule.findFirst({
    where: { effectiveFrom: { lte: now }, OR: [{ countryCode }, { countryCode: null }] },
    // Country-specific rows sort before the global default (NULLS LAST), then newest first.
    orderBy: [{ countryCode: { sort: "asc", nulls: "last" } }, { effectiveFrom: "desc" }],
    select: { id: true, name: true, guestServiceFeeBps: true, hostCommissionBps: true },
  });
  if (!schedule) {
    throw new Error("No active PlatformFeeSchedule is configured. Run the seed or create one in the admin area.");
  }
  return schedule;
});
