import "server-only";

/**
 * PostgreSQL error code behind a Prisma error. With the pg driver adapter, constraint violations
 * that Prisma doesn't model (e.g. exclusion constraints) arrive as driverAdapterError.cause.
 */
export function postgresErrorCode(e: unknown): string | undefined {
  const err = e as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string; code?: string } } } };
  const cause = err?.meta?.driverAdapterError?.cause;
  return cause?.originalCode ?? cause?.code;
}

/** The Booking_no_overlap exclusion constraint rejected the write: the dates are taken. */
export function isBookingOverlapError(e: unknown): boolean {
  return postgresErrorCode(e) === "23P01";
}

/** A unique constraint was violated (Prisma P2002, or the raw Postgres 23505). */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === "P2002" || postgresErrorCode(e) === "23505";
}
