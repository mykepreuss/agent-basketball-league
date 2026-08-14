import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/acceptance/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
