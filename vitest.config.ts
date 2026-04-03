import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@llm-midi/abc-core": resolve(__dirname, "packages/abc-core/src/index.ts"),
      "@llm-midi/midi-smf": resolve(__dirname, "packages/midi-smf/src/index.ts"),
      "@llm-midi/score-model": resolve(__dirname, "packages/score-model/src/index.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
