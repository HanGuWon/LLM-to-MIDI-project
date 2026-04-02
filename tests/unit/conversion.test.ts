import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli, runConvertCommand } from "../../apps/cli/src/cli.js";

const conversionDir = path.resolve(process.cwd(), "tests/fixtures/conversion");
const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");
const fakeToolPath = path.resolve(process.cwd(), "tests/helpers/fake-abc2midi.mjs");
const tempDirs: string[] = [];

async function loadFixture(directory: string, name: string): Promise<string> {
  return readFile(path.join(directory, name), "utf8");
}

async function createExportDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "llm-midi-test-"));
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

describe("convert command", () => {
  it("converts the supported fixture set through the external tool boundary", async () => {
    const fixtureNames = [
      "melody.abc",
      "rests-lengths.abc",
      "tuplets.abc",
      "repeats-endings.abc",
      "block-chords.abc",
      "quoted-chords.abc",
    ];

    for (const fixtureName of fixtureNames) {
      const exportDir = await createExportDir();
      const fixture = await loadFixture(conversionDir, fixtureName);
      const { result, exitCode } = await runConvertCommand(
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

      expect(exitCode).toBe(0);
      expect(result.ok).toBe(true);
      expect(result.midiPath).toBeDefined();
      await expect(stat(result.midiPath ?? "")).resolves.toBeTruthy();
    }
  });

  it("uses a deterministic export file name for the same normalized content", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(conversionDir, "melody.abc");

    const first = await runConvertCommand(
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
    const second = await runConvertCommand(
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

    expect(first.result.midiPath).toBe(second.result.midiPath);
  });

  it("surfaces abc2midi stdout and stderr as diagnostics", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(conversionDir, "melody.abc");
    const { result } = await runConvertCommand(
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

    expect(result.toolStdout).toContain("converted");
    expect(result.toolStderr).toContain("simulated abc2midi warning");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "abc2midi-stdout")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "abc2midi-stderr")).toBe(true);
  });

  it("returns a non-zero exit code when conversion is blocked by validation", async () => {
    const exportDir = await createExportDir();
    const fixture = await loadFixture(validationDir, "unsupported-voice.abc");
    const output = await runCli(
      [
        "convert",
        "--text",
        fixture,
        "--export-dir",
        exportDir,
        "--abc2midi-path",
        fakeToolPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
      },
    );

    expect(output.exitCode).toBe(1);
    const parsed = JSON.parse(output.stdout) as { ok: boolean };
    expect(parsed.ok).toBe(false);
  });
});
