import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads DATABASE_URL from the schema; it is supplied here.
// `prisma generate` does not need a database, so a placeholder keeps installs working without one.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
});
