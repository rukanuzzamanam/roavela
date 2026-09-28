import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

function createClient() {
  const { DATABASE_URL, DATABASE_POOL_MAX, DATABASE_IDLE_TIMEOUT_MS } = env();
  // Pool settings are optional; driver defaults apply when unset. Lightweight local servers such as
  // `prisma dev` drop idle connections, so they need a very short idle timeout (see .env.example).
  const adapter = new PrismaPg({
    connectionString: DATABASE_URL,
    ...(DATABASE_POOL_MAX !== undefined && { max: DATABASE_POOL_MAX }),
    ...(DATABASE_IDLE_TIMEOUT_MS !== undefined && { idleTimeoutMillis: DATABASE_IDLE_TIMEOUT_MS }),
  });
  return new PrismaClient({
    adapter,
    log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: ReturnType<typeof createClient> };

export const prisma = globalForPrisma.prisma ?? createClient();

if (env().NODE_ENV !== "production") globalForPrisma.prisma = prisma;
