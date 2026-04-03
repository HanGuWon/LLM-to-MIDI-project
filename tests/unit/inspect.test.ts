import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../../apps/cli/src/cli.js";

const conversionDir = path.resolve(process.cwd(), "tests/fixtures/conversion");
const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");
const fakeToolPath = path.resolve(process.cwd(), "tests/helpers/fake-abc2midi.mjs");
const tempDirs: string[] = [];

async function loadFixture(directory: string, name: string): Promise<string> {
  return readFile(path.join(directory, name), "utf8");
}

async function createExportDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "llm-midi-cli-test-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();

    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe("inspect and internal/auto engine flows", () => {
  it("prints canonical score JSON for supported inspect input", async () => {
    const fixture = await loadFixture(conversionDir, "melody.abc");
    const output = await runCli(["inspect", "--text", fixture], { cwd: process.cwd(), env: process.env });
    const parsed = JSON.parse(output.stdout) as {
      ok: boolean;
      score?: { notes: Array<{ pitchMidi: number }> };
    };

    expect(output.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.score?.notes.map((note) => note.pitchMidi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it("fails inspect cleanly for unsupported internal-engine constructs", async () => {
    const fixture = await loadFixture(conversionDir, "block-chords.abc");
    const output = await runCli(["inspect", "--text", fixture], { cwd: process.cwd(), env: process.env });
    const parsed = JSON.parse(output.stdout) as {
      ok: boolean;
      diagnostics: Array<{ code: string }>;
    };

    expect(output.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "internal-unsupported-block-chords")).toBe(true);
  });

  it("converts with the internal engine for the supported narrow subset", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(conversionDir, "quoted-chords.abc");
    const output = await runCli(
      ["convert", "--text", fixture, "--engine", "internal", "--export-dir", exportDir],
      { cwd: process.cwd(), env: process.env },
    );
    const parsed = JSON.parse(output.stdout) as {
      ok: boolean;
      midiPath?: string;
      engineUsed?: string;
      toolStdout: string;
      toolStderr: string;
    };

    expect(output.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.engineUsed).toBe("internal");
    expect(parsed.toolStdout).toBe("");
    expect(parsed.toolStderr).toBe("");
    await expect(stat(parsed.midiPath ?? "")).resolves.toBeTruthy();
  });

  it("falls back cleanly in auto mode when the internal engine does not support the input", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(conversionDir, "tuplets.abc");
    const output = await runCli(
      [
        "convert",
        "--text",
        fixture,
        "--engine",
        "auto",
        "--export-dir",
        exportDir,
        "--abc2midi-path",
        fakeToolPath,
      ],
      { cwd: process.cwd(), env: process.env },
    );
    const parsed = JSON.parse(output.stdout) as {
      ok: boolean;
      engineUsed?: string;
      fallback?: { attempted: string; reason: string; diagnostics: Array<{ code: string }> };
    };

    expect(output.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.engineUsed).toBe("abc2midi");
    expect(parsed.fallback?.attempted).toBe("internal");
    expect(parsed.fallback?.reason).toBe("unsupported");
    expect(parsed.fallback?.diagnostics.some((diagnostic) => diagnostic.code === "internal-unsupported-tuplets")).toBe(true);
  });

  it("still fails on validate-time unsupported input before any fallback is attempted", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(validationDir, "unsupported-voice.abc");
    const output = await runCli(
      [
        "convert",
        "--text",
        fixture,
        "--engine",
        "auto",
        "--export-dir",
        exportDir,
        "--abc2midi-path",
        fakeToolPath,
      ],
      { cwd: process.cwd(), env: process.env },
    );
    const parsed = JSON.parse(output.stdout) as { ok: boolean; diagnostics: Array<{ code: string }> };

    expect(output.exitCode).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-voices")).toBe(true);
  });
});
