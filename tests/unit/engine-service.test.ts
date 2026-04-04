import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runConvertCommand } from "../../apps/cli/src/cli.js";
import {
  buildDeterministicExportPlan,
  convertAbcText,
  inspectAbcText,
  validateAbcText,
} from "../../packages/engine-service/src/index.js";

const conversionDir = path.resolve(process.cwd(), "tests/fixtures/conversion");
const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");
const fakeToolPath = path.resolve(process.cwd(), "tests/helpers/fake-abc2midi.mjs");

async function loadFixture(directory: string, name: string): Promise<string> {
  return readFile(path.join(directory, name), "utf8");
}

describe("engine-service", () => {
  it("validateAbcText mirrors the existing validation behavior", async () => {
    const fixture = await loadFixture(validationDir, "markdown-fenced.txt");
    const result = validateAbcText(fixture);

    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "markdown-fence-stripped")).toBe(true);
  });

  it("inspectAbcText mirrors the current inspect behavior for supported fixtures", async () => {
    const fixture = await loadFixture(conversionDir, "tuplets.abc");
    const result = inspectAbcText(fixture);

    expect(result.ok).toBe(true);
    expect(result.score?.notes.length).toBeGreaterThan(0);
    expect(result.normalizedAbc).toContain("K:none");
  });

  it("convertAbcText returns internal MIDI bytes and export metadata", async () => {
    const fixture = await loadFixture(conversionDir, "block-chords.abc");
    const result = await convertAbcText(fixture, {
      engine: "internal",
      includeCanonicalScore: true,
    });

    expect(result.ok).toBe(true);
    expect(result.engineUsed).toBe("internal");
    expect(result.exportPlan?.suggestedFileName.endsWith(".mid")).toBe(true);
    expect(result.midiBuffer?.length).toBeGreaterThan(0);
    expect(result.canonicalScore?.notes.length).toBeGreaterThan(0);
  });

  it("convertAbcText preserves fallback metadata in auto mode", async () => {
    const fixture = await loadFixture(conversionDir, "quintuplet.abc");
    const result = await convertAbcText(fixture, {
      engine: "auto",
      abc2midiPath: fakeToolPath,
      env: process.env,
    });

    expect(result.ok).toBe(true);
    expect(result.engineUsed).toBe("abc2midi");
    expect(result.fallback?.attempted).toBe("internal");
    expect(result.fallback?.diagnostics.some((diagnostic) => diagnostic.code === "internal-unsupported-general-tuplet")).toBe(true);
  });

  it("buildDeterministicExportPlan matches the current CLI naming convention exactly", async () => {
    const exportDir = await mkdtemp(path.join(os.tmpdir(), "llm-midi-engine-service-"));

    try {
      const fixture = await loadFixture(conversionDir, "melody.abc");
      const converted = await convertAbcText(fixture, {
        engine: "abc2midi",
        abc2midiPath: fakeToolPath,
        env: process.env,
      });
      const cliResult = await runConvertCommand(
        {
          command: "convert",
          text: fixture,
          exportDir,
          abc2midiPath: fakeToolPath,
        },
        {
          cwd: process.cwd(),
          env: process.env,
        },
      );

      expect(converted.ok).toBe(true);
      expect(path.basename(cliResult.result.midiPath ?? "")).toBe(converted.exportPlan?.suggestedFileName);
      expect(buildDeterministicExportPlan(converted.normalizedAbc).suggestedFileName).toBe(converted.exportPlan?.suggestedFileName);
    } finally {
      await rm(exportDir, { recursive: true, force: true });
    }
  });
});
