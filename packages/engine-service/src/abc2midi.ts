import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Diagnostic } from "@llm-midi/abc-core";

export interface Abc2MidiRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  diagnostics: Diagnostic[];
  midiBuffer?: Buffer;
}

export async function runAbc2Midi(normalizedAbc: string, toolPath: string): Promise<Abc2MidiRunResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-midi-"));
  const inputPath = path.join(tempDir, "input.abc");
  const midiTempPath = path.join(tempDir, "output.mid");

  try {
    await fs.writeFile(inputPath, normalizedAbc, "utf8");

    const { command, args } = resolveToolInvocation(toolPath);
    const childArgs = [...args, inputPath, "-o", midiTempPath];
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn(command, childArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(String(chunk));
      });

      child.stderr.on("data", (chunk) => {
        stderrChunks.push(String(chunk));
      });

      child.on("error", () => {
        resolve(-1);
      });

      child.on("close", (code) => {
        resolve(code ?? 0);
      });
    });

    const stdout = stdoutChunks.join("").trim();
    const stderr = stderrChunks.join("").trim();
    const diagnostics: Diagnostic[] = [];

    if (stdout) {
      diagnostics.push({
        code: "abc2midi-stdout",
        severity: "info",
        message: `abc2midi stdout: ${stdout}`,
        blocked: false,
      });
    }

    if (stderr) {
      diagnostics.push({
        code: "abc2midi-stderr",
        severity: exitCode === 0 ? "warning" : "error",
        message: `abc2midi stderr: ${stderr}`,
        blocked: exitCode !== 0,
      });
    }

    if (exitCode === -1) {
      return {
        ok: false,
        stdout,
        stderr,
        diagnostics: [
          ...diagnostics,
          {
            code: "abc2midi-not-found",
            severity: "error",
            message: `Unable to launch abc2midi from \`${toolPath}\`.`,
            blocked: true,
          },
        ],
      };
    }

    if (exitCode !== 0) {
      return {
        ok: false,
        stdout,
        stderr,
        diagnostics: [
          ...diagnostics,
          {
            code: "abc2midi-failed",
            severity: "error",
            message: `abc2midi exited with code ${exitCode}.`,
            blocked: true,
          },
        ],
      };
    }

    try {
      await fs.access(midiTempPath);
    } catch {
      return {
        ok: false,
        stdout,
        stderr,
        diagnostics: [
          ...diagnostics,
          {
            code: "missing-midi-output",
            severity: "error",
            message: "abc2midi completed without producing the expected MIDI file.",
            blocked: true,
          },
        ],
      };
    }

    return {
      ok: true,
      stdout,
      stderr,
      midiBuffer: await fs.readFile(midiTempPath),
      diagnostics,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function resolveToolInvocation(toolPath: string): { command: string; args: string[] } {
  const extension = path.extname(toolPath).toLowerCase();

  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      args: [toolPath],
    };
  }

  return {
    command: toolPath,
    args: [],
  };
}
