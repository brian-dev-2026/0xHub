import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "shared/**/*.test.ts", "worker/**/*.test.ts"], environment: "node", testTimeout: 20000 },
});
