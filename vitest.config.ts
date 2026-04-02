import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@llm-midi/abc-core": resolve(__dirname, "packages/abc-core/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
