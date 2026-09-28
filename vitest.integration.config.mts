import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";

// Integration tests need a real PostgreSQL database (DATABASE_URL from .env).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
