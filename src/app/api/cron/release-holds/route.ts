import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { releaseExpiredHolds } from "@/server/services/checkout";

/**
 * Scheduled job: mark lapsed checkout holds EXPIRED and cancel their unpaid payments.
 * Requires `Authorization: Bearer $CRON_SECRET`; disabled (404) when CRON_SECRET isn't set.
 * Holds are also expired on read and before overlapping inserts, so this is housekeeping only.
 */
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await releaseExpiredHolds());
}
