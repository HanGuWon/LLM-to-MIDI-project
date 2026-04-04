import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateAbc } from "@llm-midi/abc-core";
import { runCli } from "../../apps/cli/src/cli.js";

const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");

async function loadFixture(name: string): Promise<string> {
  return readFile(path.join(validationDir, name), "utf8");
}

describe("validateAbc", () => {
  it("accepts a clean tune and inserts safe defaults", async () => {
    const fixture = await loadFixture("clean-tune.abc");
    const result = validateAbc(fixture);

    expect(result.ok).toBe(true);
    expect(result.classification).toBe("tune");
    expect(result.normalizedAbc).toContain("L:1/8");
    expect(result.normalizedAbc).toContain("Q:1/4=120");
    expect(result.normalizedAbc).toContain("K:C");
  });

  it("wraps a fragment with synthetic headers without inventing a meter", async () => {
    const fixture = await loadFixture("fragment-no-headers.txt");
    const result = validateAbc(fixture);

    expect(result.ok).toBe(true);
    expect(result.classification).toBe("fragment");
    expect(result.normalizedAbc).toContain("X:1");
    expect(result.normalizedAbc).toContain("T:Imported Fragment");
    expect(result.normalizedAbc).toContain("L:1/8");
    expect(result.normalizedAbc).toContain("Q:1/4=120");
    expect(result.normalizedAbc).toContain("K:none");
    expect(result.normalizedAbc).not.toContain("\nM:");
  });

  it("extracts fenced ABC and reports the cleanup", async () => {
    const fixture = await loadFixture("markdown-fenced.txt");
    const result = validateAbc(fixture);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(result.ok).toBe(true);
    expect(codes).toContain("markdown-fence-stripped");
  });

  it("removes surrounding prose and reports it", async () => {
    const fixture = await loadFixture("prose-wrapped.txt");
    const result = validateAbc(fixture);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);

    expect(result.ok).toBe(true);
    expect(codes).toContain("leading-prose-stripped");
    expect(codes).toContain("trailing-prose-stripped");
  });

  it("blocks malformed unmatched chord brackets", async () => {
    const fixture = await loadFixture("malformed-brackets.txt");
    const result = validateAbc(fixture);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unmatched-opening-bracket")).toBe(true);
  });

  it("blocks illegal tie placement", async () => {
    const fixture = await loadFixture("illegal-tie.txt");
    const result = validateAbc(fixture);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "illegal-tie-placement")).toBe(true);
  });

  it("rejects unsupported voice structures", async () => {
    const fixture = await loadFixture("unsupported-voice.abc");
    const result = validateAbc(fixture);

    expect(result.ok).toBe(false);
    expect(result.unsupportedConstructs).toContain("multiple voices");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-voices")).toBe(true);
  });

  it("keeps the validate CLI command working unchanged", async () => {
    const fixturePath = path.join(validationDir, "clean-tune.abc");
    const output = await runCli(["validate", "--input", fixturePath], {
      cwd: process.cwd(),
      env: process.env,
    });
    const parsed = JSON.parse(output.stdout) as { ok: boolean; normalizedAbc: string };

    expect(output.exitCode).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.normalizedAbc).toContain("Q:1/4=120");
  });
});
