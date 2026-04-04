import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  isWorkerReadyEvent,
  isWorkerResponse,
  PROTOCOL_VERSION,
  type WorkerReadyEvent,
  type WorkerRequest,
  type WorkerResponse,
} from "@llm-midi/worker-protocol";
import {
  createNdjsonLineDecoder,
} from "@llm-midi/worker-transport";

type PendingResponse = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingAnyLine = {
  resolve: (value: WorkerResponse | WorkerReadyEvent) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type WorkerClient = {
  send: (request: WorkerRequest, timeoutMs?: number) => Promise<WorkerResponse>;
  sendRawLine: (line: string, timeoutMs?: number) => Promise<WorkerResponse | WorkerReadyEvent>;
  waitForReady: (timeoutMs?: number) => Promise<WorkerReadyEvent>;
  shutdown: () => Promise<WorkerResponse>;
  kill: () => void;
  waitForExit: (timeoutMs?: number) => Promise<number | null>;
  getStderr: () => string;
};

type SpawnWorkerClientOptions = {
  transport?: "stdio" | "pipe";
  useBuiltEntry?: boolean;
};

export function spawnWorkerClient(options: SpawnWorkerClientOptions = {}): WorkerClient {
  const transport = options.transport ?? "stdio";
  const child = spawnWorkerProcess(options);
  const responseInbox = createLineInbox<WorkerResponse>(isWorkerResponse);
  const readyInbox = createLineInbox<WorkerReadyEvent>(isWorkerReadyEvent);
  let stderrBuffer = "";
  let requestWriter: ((line: string) => void) | undefined;
  let pipeSocket: net.Socket | undefined;
  let readyPromise: Promise<WorkerReadyEvent> | undefined;

  child.stderr.on("data", (chunk) => {
    stderrBuffer += String(chunk);
  });

  if (transport === "stdio") {
    attachReadable(child.stdout, (line) => {
      responseInbox.accept(line);
    });
    requestWriter = (line) => {
      child.stdin.write(`${line}\n`);
    };
  } else {
    attachReadable(child.stdout, (line) => {
      readyInbox.accept(line);
    });
    readyPromise = waitForReadyEvent(readyInbox);
    const connectPromise = waitForPipeConnection(child, readyPromise);
    requestWriter = (line) => {
      connectPromise.then((socket) => {
        socket.write(`${line}\n`);
      }).catch(() => {
        // handled by pending timeouts/worker exit
      });
    };

    connectPromise.then((socket) => {
      pipeSocket = socket;
      attachReadable(socket, (line) => {
        responseInbox.accept(line);
      });
    }).catch(() => {
      // handled by pending timeouts/worker exit
    });
  }

  child.on("exit", () => {
    const error = new Error("Worker process exited before responding.");
    responseInbox.failAll(error);
    readyInbox.failAll(error);
  });

  return {
    send(request, timeoutMs = 5_000) {
      return new Promise<WorkerResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          responseInbox.pendingById.delete(request.id);
          reject(new Error(`Timed out waiting for worker response: ${request.id}`));
        }, timeoutMs);

        responseInbox.pendingById.set(request.id, { resolve, reject, timeout });
        requestWriter?.(JSON.stringify(request));
      });
    },
    sendRawLine(line, timeoutMs = 5_000) {
      return new Promise<WorkerResponse | WorkerReadyEvent>((resolve, reject) => {
        const existing = responseInbox.unsolicited.shift() ?? readyInbox.unsolicited.shift();

        if (existing) {
          resolve(existing);
          return;
        }

        const timeout = setTimeout(() => {
          const index = responseInbox.pendingAny.findIndex((candidate) => candidate.resolve === resolve);
          if (index >= 0) {
            responseInbox.pendingAny.splice(index, 1);
          }
          reject(new Error("Timed out waiting for unsolicited worker response."));
        }, timeoutMs);

        responseInbox.pendingAny.push({ resolve, reject, timeout });
        requestWriter?.(line);
      });
    },
    waitForReady(timeoutMs = 5_000) {
      if (transport !== "pipe") {
        return Promise.reject(new Error("Ready events are only emitted in pipe mode."));
      }

      return readyPromise ?? waitForReadyEvent(readyInbox, timeoutMs);
    },
    shutdown() {
      return this.send({
        id: "shutdown-test",
        protocolVersion: PROTOCOL_VERSION,
        kind: "shutdown",
      });
    },
    kill() {
      pipeSocket?.destroy();
      child.kill();
    },
    waitForExit(timeoutMs = 5_000) {
      return waitForChildExit(child, timeoutMs);
    },
    getStderr() {
      return stderrBuffer;
    },
  };
}

function spawnWorkerProcess(options: SpawnWorkerClientOptions): ChildProcessWithoutNullStreams {
  const useBuiltEntry = options.useBuiltEntry ?? false;
  const builtEntry = path.resolve(process.cwd(), "apps/worker/dist/index.js");
  const sourceEntry = path.resolve(process.cwd(), "apps/worker/src/index.ts");
  const tsxPath = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const useDist = useBuiltEntry && existsSync(builtEntry);

  const args = useDist
    ? [builtEntry]
    : [tsxPath, sourceEntry];

  if (options.transport === "pipe") {
    args.push("--transport", "pipe");
  }

  return spawn(process.execPath, args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createLineInbox<T>(guard: (value: unknown) => value is T) {
  return {
    pendingById: new Map<string, PendingResponse>(),
    pendingAny: [] as PendingAnyLine[],
    unsolicited: [] as T[],
    accept(line: string) {
      const parsed = JSON.parse(line) as unknown;

      if (!guard(parsed)) {
        throw new Error(`Worker emitted an unexpected protocol line: ${line}`);
      }

      if (hasStringId(parsed)) {
        const pendingEntry = this.pendingById.get(parsed.id);

        if (pendingEntry) {
          clearTimeout(pendingEntry.timeout);
          this.pendingById.delete(parsed.id);
          pendingEntry.resolve(parsed);
          return;
        }
      }

      const nextAny = this.pendingAny.shift();
      if (nextAny) {
        clearTimeout(nextAny.timeout);
        nextAny.resolve(parsed);
        return;
      }

      this.unsolicited.push(parsed);
    },
    failAll(error: Error) {
      for (const pending of this.pendingById.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pendingById.clear();

      while (this.pendingAny.length > 0) {
        const pending = this.pendingAny.shift();
        if (pending) {
          clearTimeout(pending.timeout);
          pending.reject(error);
        }
      }
    },
  };
}

function attachReadable(
  readable: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  const decoder = createNdjsonLineDecoder();

  readable.on("data", (chunk) => {
    const lines = decoder.push(chunk);
    for (const line of lines) {
      if (line.trim().length > 0) {
        onLine(line);
      }
    }
  });

  readable.on("end", () => {
    const trailing = decoder.flush();
    for (const line of trailing) {
      if (line.trim().length > 0) {
        onLine(line);
      }
    }
  });
}

async function waitForPipeConnection(
  child: ChildProcessWithoutNullStreams,
  readyPromise: Promise<WorkerReadyEvent>,
): Promise<net.Socket> {
    const readyEvent = await readyPromise;

  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection(readyEvent.endpoint.path);

    socket.once("connect", () => {
      resolve(socket);
    });

    socket.once("error", (error) => {
      reject(error);
    });

    child.once("exit", () => {
      reject(new Error("Worker process exited before pipe connection completed."));
    });
  });
}

function waitForReadyEvent(
  readyInbox: ReturnType<typeof createLineInbox<WorkerReadyEvent>>,
  timeoutMs: number = 5_000,
): Promise<WorkerReadyEvent> {
  return new Promise<WorkerReadyEvent>((resolve, reject) => {
    const existing = readyInbox.unsolicited.shift();
    if (existing) {
      resolve(existing);
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for worker ready event."));
    }, timeoutMs);

    readyInbox.pendingAny.push({ resolve, reject, timeout });
  });
}

function hasStringId(value: unknown): value is { id: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for worker process to exit."));
    }, timeoutMs);

    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}
