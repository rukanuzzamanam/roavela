import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

// Integration tests need a real PostgreSQL database (DATABASE_URL from .env).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    // `prisma dev` (the local PGlite-based server) garbles messages when several pooled connections
    // query at once ("bind message supplies N parameters…"). One connection keeps it reliable; the
    // concurrency tests still race at the application level (check-then-insert), and the database
    // exclusion constraint decides. Against a real PostgreSQL, set TEST_DATABASE_POOL_MAX to test
    // with parallel sessions too. (dotenv never overrides a variable that is already set.)
    env: { DATABASE_POOL_MAX: process.env.TEST_DATABASE_POOL_MAX ?? "1" },
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
