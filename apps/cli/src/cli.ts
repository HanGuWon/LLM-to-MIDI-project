import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  ConvertResult,
  InspectResult,
  ValidateResult,
} from "@llm-midi/abc-core";
import {
  convertAbcText,
  type EngineName,
  inspectAbcText,
  validateAbcText,
} from "@llm-midi/engine-service";

type CommandName = "validate" | "convert" | "inspect";

type ParsedArgs = {
  command?: CommandName;
  text?: string;
  input?: string;
  exportDir?: string;
  abc2midiPath?: string;
  engine?: EngineName;
};

type CliOutput = {
  exitCode: number;
  stdout: string;
};

type CliContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
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

  if (args.command === "inspect") {
    const { result, exitCode } = await runInspectCommand(args, resolvedContext.cwd);
    return {
      exitCode,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
    };
  }

  return {
    exitCode: 1,
    stdout: `${JSON.stringify(buildUsageError("Missing command. Use `validate`, `inspect`, or `convert`."), null, 2)}\n`,
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

  return validateAbcText(abcText);
}

export async function runInspectCommand(
  args: ParsedArgs,
  cwd: string,
): Promise<{ result: InspectResult; exitCode: number }> {
  const abcText = await readInput(args, cwd);

  if (typeof abcText !== "string") {
    return {
      result: {
        ok: false,
        diagnostics: abcText.diagnostics,
      },
      exitCode: 1,
    };
  }

  const inspected = inspectAbcText(abcText);

  return {
    result: {
      ok: inspected.ok,
      diagnostics: inspected.diagnostics,
      score: inspected.score,
    },
    exitCode: inspected.ok ? 0 : 1,
  };
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

  const converted = await convertAbcText(abcText, {
    engine: args.engine,
    abc2midiPath: args.abc2midiPath,
    env: context.env,
  });

  if (!converted.ok || !converted.midiBuffer || !converted.exportPlan) {
    return {
      result: {
        ok: false,
        diagnostics: converted.diagnostics,
        toolStdout: converted.toolStdout,
        toolStderr: converted.toolStderr,
        engineUsed: converted.engineUsed,
        fallback: converted.fallback,
      },
      exitCode: 1,
    };
  }

  const exportDir = path.resolve(context.cwd, args.exportDir ?? "exports");
  const midiPath = path.join(exportDir, converted.exportPlan.suggestedFileName);

  await fs.mkdir(exportDir, { recursive: true });
  await fs.writeFile(midiPath, converted.midiBuffer);

  return {
    result: {
      ok: true,
      midiPath,
      diagnostics: converted.diagnostics,
      toolStdout: converted.toolStdout,
      toolStderr: converted.toolStderr,
      engineUsed: converted.engineUsed,
      fallback: converted.fallback,
    },
    exitCode: 0,
  };
}

function parseArgs(argv: string[]): ParsedArgs {
  const [commandToken, ...rest] = argv;
  const parsed: ParsedArgs = {};

  if (commandToken === "validate" || commandToken === "convert" || commandToken === "inspect") {
    parsed.command = commandToken;
  }

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const next = rest[index + 1];

    if ((token === "--text" || token === "--input" || token === "--export-dir" || token === "--abc2midi-path" || token === "--engine") && next) {
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

      if (token === "--engine" && (next === "abc2midi" || next === "internal" || next === "auto")) {
        parsed.engine = next;
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
