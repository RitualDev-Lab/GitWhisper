import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@gitwhisper/git": path.resolve(__dirname, "packages/git/src/index.ts"),
      "@gitwhisper/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@gitwhisper/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@gitwhisper/ai": path.resolve(__dirname, "packages/ai/src/index.ts"),
      "@gitwhisper/editor": path.resolve(__dirname, "packages/editor/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/types.ts", "**/*.d.ts", "**/index.ts", "tests/**"],
      thresholds: {
        lines: 70,
        statements: 70,
        branches: 70,
        functions: 75,
      },
    },
  },
});
