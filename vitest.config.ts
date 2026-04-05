import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Process entrypoint: it only wires config to a socket and exits.
      exclude: ["src/server/start.ts", "src/**/index.ts"],
    },
  },
});
