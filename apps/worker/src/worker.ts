import readline from "node:readline";

import {
  convertAbcText,
  inspectAbcText,
  validateAbcText,
} from "@llm-midi/engine-service";
import {
  createErrorResponse,
  createSuccessResponse,
  isSupportedProtocolVersion,
  isWorkerRequestKind,
  PROTOCOL_VERSION,
  type ConvertRequest,
  type WorkerResponse,
} from "@llm-midi/worker-protocol";

type WorkerContext = {
  env: NodeJS.ProcessEnv;
};

type WorkerRunResult = {
  exitCode: number;
};

export async function runWorker(context: Partial<WorkerContext> = {}): Promise<WorkerRunResult> {
  const resolvedContext: WorkerContext = {
    env: context.env ?? process.env,
  };
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  let exitCode = 0;

  try {
    for await (const line of rl) {
      const response = await handleWorkerLine(line, resolvedContext);
      process.stdout.write(`${JSON.stringify(response)}\n`);

      if (response.ok && response.kind === "shutdown") {
        break;
      }
    }
  } finally {
    rl.close();
  }

  return { exitCode };
}

async function handleWorkerLine(line: string, context: WorkerContext): Promise<WorkerResponse> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return createErrorResponse(
      "unknown",
      "unknown",
      "invalid-json",
      "Unable to parse request JSON.",
    );
  }

  const id = extractStringField(parsed, "id") ?? "unknown";
  const kind = extractStringField(parsed, "kind") ?? "unknown";
  const protocolVersion = extractStringField(parsed, "protocolVersion");

  if (!isSupportedProtocolVersion(protocolVersion)) {
    return createErrorResponse(
      id,
      kind,
      "unsupported-protocol-version",
      `Unsupported protocol version. Expected ${PROTOCOL_VERSION}.`,
    );
  }

  if (!isWorkerRequestKind(kind)) {
    return createErrorResponse(
      id,
      kind,
      "unknown-request-kind",
      `Unknown request kind: ${kind}.`,
    );
  }

  try {
    switch (kind) {
      case "ping":
        return createSuccessResponse(id, "ping", { status: "ok" });
      case "validate":
        return createSuccessResponse(id, "validate", validateAbcText(readAbcText(parsed)));
      case "inspect": {
        const result = inspectAbcText(readAbcText(parsed));
        return createSuccessResponse(id, "inspect", result);
      }
      case "convert": {
        const request = parsed as ConvertRequest;
        const result = await convertAbcText(readAbcText(parsed), {
          engine: request.engine,
          abc2midiPath: request.abc2midiPath,
          env: context.env,
          includeCanonicalScore: request.includeCanonicalScore ?? false,
        });

        return createSuccessResponse(id, "convert", {
          ok: result.ok,
          classification: result.classification,
          normalizedAbc: result.normalizedAbc,
          diagnostics: result.diagnostics,
          toolStdout: result.toolStdout,
          toolStderr: result.toolStderr,
          engineUsed: result.engineUsed,
          fallback: result.fallback,
          exportPlan: result.exportPlan,
          midiBase64: request.includeMidiBase64 && result.midiBuffer
            ? result.midiBuffer.toString("base64")
            : undefined,
          canonicalScore: request.includeCanonicalScore ? result.canonicalScore : undefined,
        });
      }
      case "shutdown":
        return createSuccessResponse(id, "shutdown", { status: "shutting-down" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker failure.";
    return createErrorResponse(
      id,
      kind,
      "request-failed",
      message,
    );
  }
}

function readAbcText(input: unknown): string {
  const abcText = extractStringField(input, "abcText");
  return abcText ?? "";
}

function extractStringField(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
