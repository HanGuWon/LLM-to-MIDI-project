import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseNormalizedAbcToCanonicalScore, validateAbc } from "@llm-midi/abc-core";

const conversionDir = path.resolve(process.cwd(), "tests/fixtures/conversion");
const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");

async function loadFixture(directory: string, name: string): Promise<string> {
  return readFile(path.join(directory, name), "utf8");
}

async function parseFixture(name: string) {
  const raw = await loadFixture(conversionDir, name);
  const validation = validateAbc(raw);
  expect(validation.ok).toBe(true);
  return parseNormalizedAbcToCanonicalScore(
    validation.normalizedAbc,
    validation.classification,
    validation.diagnostics,
  );
}

describe("internal normalized ABC engine", () => {
  it("parses the narrow supported melody fixture", async () => {
    const parsed = await parseFixture("melody.abc");

    expect(parsed.ok).toBe(true);
    expect(parsed.score?.notes).toHaveLength(8);
    expect(parsed.score?.notes.map((note) => note.pitchMidi)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(parsed.score?.notes[0]?.startWhole).toEqual({ num: 0, den: 1 });
    expect(parsed.score?.notes[0]?.durationWhole).toEqual({ num: 1, den: 8 });
    expect(parsed.score?.notes[7]?.startWhole).toEqual({ num: 7, den: 8 });
  });

  it("parses rests and explicit lengths into deterministic rational timing", async () => {
    const parsed = await parseFixture("rests-lengths.abc");

    expect(parsed.ok).toBe(true);
    expect(parsed.score?.notes.map((note) => note.pitchMidi)).toEqual([60, 64, 65, 67]);
    expect(parsed.score?.notes.map((note) => note.startWhole)).toEqual([
      { num: 0, den: 1 },
      { num: 1, den: 2 },
      { num: 9, den: 16 },
      { num: 5, den: 8 },
    ]);
    expect(parsed.score?.notes.map((note) => note.durationWhole)).toEqual([
      { num: 1, den: 4 },
      { num: 1, den: 16 },
      { num: 1, den: 16 },
      { num: 1, den: 2 },
    ]);
  });

  it("ignores quoted chord symbols as playback metadata", async () => {
    const parsed = await parseFixture("quoted-chords.abc");

    expect(parsed.ok).toBe(true);
    expect(parsed.score?.notes).toHaveLength(4);
    expect(parsed.score?.notes.map((note) => note.pitchMidi)).toEqual([60, 62, 64, 65]);
  });

  it("merges ties between identical pitches", async () => {
    const parsed = await parseFixture("tied-notes.abc");

    expect(parsed.ok).toBe(true);
    expect(parsed.score?.notes).toHaveLength(2);
    expect(parsed.score?.notes[0]?.durationWhole).toEqual({ num: 1, den: 2 });
  });

  it("applies common key signatures within bars", async () => {
    const raw = await loadFixture(conversionDir, "key-signature.abc");
    const validation = validateAbc(raw);
    const parsed = parseNormalizedAbcToCanonicalScore(
      validation.normalizedAbc,
      validation.classification,
      validation.diagnostics,
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.score?.key?.tonic).toBe("G");
    expect(parsed.score?.notes[0]?.pitchMidi).toBe(66);
    expect(parsed.score?.notes[4]?.pitchMidi).toBe(66);
  });

  it("returns structured unsupported diagnostics for internal-engine tuplets", async () => {
    const parsed = await parseFixture("tuplets.abc");

    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "internal-unsupported-tuplets")).toBe(true);
  });

  it("blocks validation-level unsupported voices before the internal engine runs", async () => {
    const raw = await loadFixture(validationDir, "unsupported-voice.abc");
    const validation = validateAbc(raw);

    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-voices")).toBe(true);
  });
});
