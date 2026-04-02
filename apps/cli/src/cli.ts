import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  getNormalizedTitle,
  type ConvertResult,
  type Diagnostic,
  type ValidateResult,
  validateAbc,
} from "@llm-midi/abc-core";

type CommandName = "validate" | "convert";

type ParsedArgs = {
  command?: CommandName;
  text?: string;
  input?: string;
  exportDir?: string;
  abc2midiPath?: string;
};

type CliOutput = {
  exitCode: number;
  stdout: string;
};

type CliContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

type ToolResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  midiBuffer?: Buffer;
  diagnostics: Diagnostic[];
};

export async function runCli(
  argv: string[],
  context: Partial<CliContext> = {},
): Promise<CliOutput> {
  const resolvedContext: CliContext = {
    cwd: context.cwd ?? process.cwd(),
    env: context.env ?? process.env,
  };
  const args = parseArgs(argv);

  if (args.command === "validate") {
    const result = await runValidateCommand(args, resolvedContext.cwd);
    return {
      exitCode: result.ok ? 0 : 1,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
    };
  }

  if (args.command === "convert") {
    const { result, exitCode } = await runConvertCommand(args, resolvedContext);
    return {
      exitCode,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
    };
  }

  return {
    exitCode: 1,
    stdout: `${JSON.stringify(buildUsageError("Missing command. Use `validate` or `convert`."), null, 2)}\n`,
  };
}

export async function runValidateCommand(
  args: ParsedArgs,
  cwd: string,
): Promise<ValidateResult> {
  const abcText = await readInput(args, cwd);

  if (typeof abcText !== "string") {
    return abcText;
  }

  return validateAbc(abcText);
}

export async function runConvertCommand(
  args: ParsedArgs,
  context: CliContext,
): Promise<{ result: ConvertResult; exitCode: number }> {
  const abcText = await readInput(args, context.cwd);

  if (typeof abcText !== "string") {
    return {
      result: {
        ok: false,
        diagnostics: abcText.diagnostics,
        toolStdout: "",
        toolStderr: "",
      },
      exitCode: 1,
    };
  }

  const validation = validateAbc(abcText);

  if (!validation.ok) {
    return {
      result: {
        ok: false,
        diagnostics: validation.diagnostics,
        toolStdout: "",
        toolStderr: "",
      },
      exitCode: 1,
    };
  }

  const exportDir = path.resolve(context.cwd, args.exportDir ?? "exports");
  const toolPath = args.abc2midiPath ?? context.env.ABC2MIDI_PATH ?? "abc2midi";
  const toolRun = await runAbc2Midi(validation.normalizedAbc, toolPath);
  const diagnostics = [...validation.diagnostics, ...toolRun.diagnostics];

  if (!toolRun.ok || !toolRun.midiBuffer) {
    return {
      result: {
        ok: false,
        diagnostics,
        toolStdout: toolRun.stdout,
        toolStderr: toolRun.stderr,
      },
      exitCode: 1,
    };
  }

  const title = getNormalizedTitle(validation.normalizedAbc);
  const fileName = `${slugify(title)}-${createContentHash(validation.normalizedAbc)}.mid`;
  const midiPath = path.join(exportDir, fileName);

  await fs.mkdir(exportDir, { recursive: true });
  await fs.writeFile(midiPath, toolRun.midiBuffer);

  return {
    result: {
      ok: true,
      midiPath,
      diagnostics,
      toolStdout: toolRun.stdout,
      toolStderr: toolRun.stderr,
    },
    exitCode: 0,
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandToken, ...rest] = argv;
  const parsed: ParsedArgs = {};

  if (commandToken === "validate" || commandToken === "convert") {
    parsed.command = commandToken;
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = rest[index + 1];

    if ((token === "--text" || token === "--input" || token === "--export-dir" || token === "--abc2midi-path") && next) {
      if (token === "--text") {
        parsed.text = next;
      }

      if (token === "--input") {
        parsed.input = next;
      }

      if (token === "--export-dir") {
        parsed.exportDir = next;
      }

      if (token === "--abc2midi-path") {
        parsed.abc2midiPath = next;
      }

      index += 1;
    }
  }

  return parsed;
}

async function readInput(args: ParsedArgs, cwd: string): Promise<string | ValidateResult> {
  const hasText = typeof args.text === "string";
  const hasInput = typeof args.input === "string";

  if (hasText === hasInput) {
    return buildUsageError("Provide exactly one of `--text` or `--input`.");
  }

  if (hasText) {
    return args.text ?? "";
  }

  const inputPath = path.resolve(cwd, args.input ?? "");

  try {
    return await fs.readFile(inputPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown file read error.";

    return buildUsageError(`Unable to read input file: ${message}`);
  }
}

async function runAbc2Midi(normalizedAbc: string, toolPath: string): Promise<ToolResult> {
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

function buildUsageError(message: string): ValidateResult {
  return {
    ok: false,
    classification: "fragment",
    normalizedAbc: "",
    unsupportedConstructs: [],
    diagnostics: [
      {
        code: "invalid-arguments",
        severity: "error",
        message,
        blocked: true,
      },
    ],
  };
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "imported-fragment";
}

function createContentHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}
