import net, { type Socket } from "node:net";
import { promises as fs } from "node:fs";
import readline from "node:readline";

import {
  convertAbcText,
  inspectAbcText,
  validateAbcText,
} from "@llm-midi/engine-service";
import {
  createErrorResponse,
  createReadyEvent,
  createSuccessResponse,
  isSupportedProtocolVersion,
  isWorkerRequestKind,
  PROTOCOL_VERSION,
  type ConvertRequest,
  type WorkerResponse,
  type WorkerTransportKind,
} from "@llm-midi/worker-protocol";
import {
  createDefaultLocalIpcEndpoint,
  createNdjsonLineDecoder,
  encodeNdjsonMessage,
  isPosixSocketPath,
  normalizeLocalIpcEndpoint,
  type LocalIpcEndpoint,
} from "@llm-midi/worker-transport";

export type WorkerArgs = {
  transport: WorkerTransportKind;
  endpoint?: string;
};

type WorkerContext = {
  env: NodeJS.ProcessEnv;
};

type WorkerRunResult = {
  exitCode: number;
};

export async function runWorker(
  args: Partial<WorkerArgs> = {},
  context: Partial<WorkerContext> = {},
): Promise<WorkerRunResult> {
  const resolvedArgs: WorkerArgs = {
    transport: args.transport ?? "stdio",
    endpoint: args.endpoint,
  };
  const resolvedContext: WorkerContext = {
    env: context.env ?? process.env,
  };

  if (resolvedArgs.transport === "pipe") {
    return runPipeWorker(resolvedArgs, resolvedContext);
  }

  return runStdioWorker(resolvedContext);
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
  let transport: WorkerTransportKind = "stdio";
  let endpoint: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--transport" && next && (next === "stdio" || next === "pipe")) {
      transport = next;
      index += 1;
      continue;
    }

    if (token === "--endpoint" && next) {
      endpoint = next;
      index += 1;
    }
  }

  return {
    transport,
    endpoint,
  };
}

async function runStdioWorker(context: WorkerContext): Promise<WorkerRunResult> {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  try {
    for await (const line of rl) {
      const response = await handleWorkerLine(line, context);
      process.stdout.write(encodeNdjsonMessage(response));

      if (response.ok && response.kind === "shutdown") {
        break;
      }
    }
  } finally {
    rl.close();
  }

  return { exitCode: 0 };
}

async function runPipeWorker(args: WorkerArgs, context: WorkerContext): Promise<WorkerRunResult> {
  const endpoint = normalizeLocalIpcEndpoint(args.endpoint ?? createDefaultLocalIpcEndpoint("llm-midi-worker-pipe"));
  await cleanupPosixEndpoint(endpoint);

  return new Promise<WorkerRunResult>((resolve, reject) => {
    let activeSocket: Socket | undefined;
    let hasResolved = false;
    let requestQueue = Promise.resolve();

    const finalize = async (exitCode: number) => {
      if (hasResolved) {
        return;
      }

      hasResolved = true;
      activeSocket?.destroy();
      server.close(async () => {
        await cleanupPosixEndpoint(endpoint);
        resolve({ exitCode });
      });
    };

    const server = net.createServer((socket) => {
      if (activeSocket) {
        socket.destroy();
        return;
      }

      activeSocket = socket;
      server.close();

      const decoder = createNdjsonLineDecoder();

      socket.on("data", (chunk) => {
        const lines = decoder.push(chunk);

        for (const line of lines) {
          requestQueue = requestQueue.then(async () => {
            const response = await handleWorkerLine(line, context);
            await writeToSocket(socket, encodeNdjsonMessage(response));

            if (response.ok && response.kind === "shutdown") {
              await finalize(0);
            }
          }).catch(async () => {
            await finalize(1);
          });
        }
      });

      socket.on("error", async () => {
        await finalize(1);
      });

      socket.on("end", async () => {
        const trailingLines = decoder.flush();

        for (const line of trailingLines) {
          requestQueue = requestQueue.then(async () => {
            const response = await handleWorkerLine(line, context);
            await writeToSocket(socket, encodeNdjsonMessage(response));

            if (response.ok && response.kind === "shutdown") {
              await finalize(0);
            }
          }).catch(async () => {
            await finalize(1);
          });
        }

        requestQueue.finally(async () => {
          await finalize(0);
        });
      });

      socket.on("close", async () => {
        if (!hasResolved) {
          await finalize(0);
        }
      });
    });

    server.on("error", async (error) => {
      await cleanupPosixEndpoint(endpoint);
      reject(error);
    });

    server.listen(endpoint.path, () => {
      process.stdout.write(encodeNdjsonMessage(createReadyEvent(endpoint.path)));
    });
  });
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

async function cleanupPosixEndpoint(endpoint: LocalIpcEndpoint): Promise<void> {
  if (!isPosixSocketPath(endpoint.path)) {
    return;
  }

  try {
    await fs.rm(endpoint.path, { force: true });
  } catch {
    // ignore stale socket cleanup failures
  }
}

function writeToSocket(socket: Socket, payload: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
