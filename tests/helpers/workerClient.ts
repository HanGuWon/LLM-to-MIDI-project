import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  isWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from "@llm-midi/worker-protocol";

type PendingResponse = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type WorkerClient = {
  send: (request: WorkerRequest, timeoutMs?: number) => Promise<WorkerResponse>;
  sendRawLine: (line: string, timeoutMs?: number) => Promise<WorkerResponse>;
  shutdown: () => Promise<WorkerResponse>;
  kill: () => void;
  waitForExit: (timeoutMs?: number) => Promise<number | null>;
  getStderr: () => string;
};

export function spawnWorkerClient(): WorkerClient {
  const tsxPath = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const workerEntry = path.resolve(process.cwd(), "apps/worker/src/index.ts");
  const child = spawn(process.execPath, [tsxPath, workerEntry], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<string, PendingResponse>();
  const unsolicited: WorkerResponse[] = [];
  const waitingForNext: Array<{
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += String(chunk);
    let newlineIndex = stdoutBuffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        handleResponseLine(line, pending, unsolicited, waitingForNext);
      }

      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += String(chunk);
  });

  child.on("exit", () => {
    const error = new Error("Worker process exited before responding.");

    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();

    while (waitingForNext.length > 0) {
      const next = waitingForNext.shift();
      if (next) {
        clearTimeout(next.timeout);
        next.reject(error);
      }
    }
  });

  return {
    send(request, timeoutMs = 5_000) {
      return new Promise<WorkerResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(request.id);
          reject(new Error(`Timed out waiting for worker response: ${request.id}`));
        }, timeoutMs);

        pending.set(request.id, { resolve, reject, timeout });
        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    },
    sendRawLine(line, timeoutMs = 5_000) {
      return new Promise<WorkerResponse>((resolve, reject) => {
        const next = unsolicited.shift();
        if (next) {
          resolve(next);
          return;
        }

        const timeout = setTimeout(() => {
          const index = waitingForNext.findIndex((candidate) => candidate.resolve === resolve);
          if (index >= 0) {
            waitingForNext.splice(index, 1);
          }
          reject(new Error("Timed out waiting for unsolicited worker response."));
        }, timeoutMs);

        waitingForNext.push({ resolve, reject, timeout });
        child.stdin.write(`${line}\n`);
      });
    },
    async shutdown() {
      return this.send({
        id: "shutdown-test",
        protocolVersion: "v1",
        kind: "shutdown",
      });
    },
    kill() {
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

function handleResponseLine(
  line: string,
  pending: Map<string, PendingResponse>,
  unsolicited: WorkerResponse[],
  waitingForNext: Array<{
    resolve: (response: WorkerResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>,
): void {
  const parsed = JSON.parse(line) as unknown;

  if (!isWorkerResponse(parsed)) {
    throw new Error(`Worker emitted a non-protocol response: ${line}`);
  }

  const response = parsed;
  const pendingEntry = pending.get(response.id);

  if (pendingEntry) {
    clearTimeout(pendingEntry.timeout);
    pending.delete(response.id);
    pendingEntry.resolve(response);
    return;
  }

  const next = waitingForNext.shift();

  if (next) {
    clearTimeout(next.timeout);
    next.resolve(response);
    return;
  }

  unsolicited.push(response);
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
