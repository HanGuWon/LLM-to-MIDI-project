import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export interface LocalIpcEndpoint {
  type: "pipe";
  path: string;
}

export interface NdjsonLineDecoder {
  push: (chunk: string | Buffer) => string[];
  flush: () => string[];
}

export function createDefaultLocalIpcEndpoint(name: string = "llm-midi-worker"): LocalIpcEndpoint {
  const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;

  if (process.platform === "win32") {
    return {
      type: "pipe",
      path: `\\\\.\\pipe\\${sanitizeEndpointName(name)}-${suffix}`,
    };
  }

  return {
    type: "pipe",
    path: path.join(os.tmpdir(), `${sanitizeEndpointName(name)}-${suffix}.sock`),
  };
}

export function normalizeLocalIpcEndpoint(
  endpoint?: string | LocalIpcEndpoint,
  defaultName?: string,
): LocalIpcEndpoint {
  if (!endpoint) {
    return createDefaultLocalIpcEndpoint(defaultName);
  }

  if (typeof endpoint === "object") {
    return {
      type: "pipe",
      path: normalizeEndpointPath(endpoint.path),
    };
  }

  return {
    type: "pipe",
    path: normalizeEndpointPath(endpoint),
  };
}

export function encodeNdjsonMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

export function createNdjsonLineDecoder(): NdjsonLineDecoder {
  let buffer = "";

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines: string[] = [];
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        buffer = buffer.slice(newlineIndex + 1);
        lines.push(line);
        newlineIndex = buffer.indexOf("\n");
      }

      return lines;
    },
    flush() {
      if (!buffer.length) {
        return [];
      }

      const remainder = buffer.replace(/\r$/, "");
      buffer = "";
      return [remainder];
    },
  };
}

export function isWindowsPipePath(value: string): boolean {
  return /^\\\\\.\\pipe\\/.test(value);
}

export function isPosixSocketPath(value: string): boolean {
  return value.startsWith("/") && value.endsWith(".sock");
}

function normalizeEndpointPath(rawPath: string): string {
  if (isWindowsPipePath(rawPath) || isPosixSocketPath(rawPath)) {
    return rawPath;
  }

  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${sanitizeEndpointName(rawPath)}`;
  }

  return path.resolve(rawPath);
}

function sanitizeEndpointName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "llm-midi-worker";
}
