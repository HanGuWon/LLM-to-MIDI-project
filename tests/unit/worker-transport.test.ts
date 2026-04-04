import { describe, expect, it } from "vitest";

import {
  createDefaultLocalIpcEndpoint,
  createNdjsonLineDecoder,
  encodeNdjsonMessage,
  isPosixSocketPath,
  isWindowsPipePath,
  normalizeLocalIpcEndpoint,
} from "../../packages/worker-transport/src/index.js";

describe("worker-transport", () => {
  it("creates and normalizes Windows pipe paths explicitly", () => {
    const normalized = normalizeLocalIpcEndpoint("\\\\.\\pipe\\llm-midi-test");

    expect(isWindowsPipePath(normalized.path)).toBe(true);
    expect(normalized.path).toBe("\\\\.\\pipe\\llm-midi-test");
  });

  it("creates a platform default endpoint and recognizes posix socket paths when applicable", () => {
    const endpoint = createDefaultLocalIpcEndpoint("llm-midi");

    if (process.platform === "win32") {
      expect(isWindowsPipePath(endpoint.path)).toBe(true);
    } else {
      expect(isPosixSocketPath(endpoint.path)).toBe(true);
    }
  });

  it("encodes NDJSON messages", () => {
    expect(encodeNdjsonMessage({ ok: true })).toBe("{\"ok\":true}\n");
  });

  it("buffers partial lines and emits complete ones", () => {
    const decoder = createNdjsonLineDecoder();

    expect(decoder.push("one")).toEqual([]);
    expect(decoder.push("\ntwo\nthr")).toEqual(["one", "two"]);
    expect(decoder.push("ee\n")).toEqual(["three"]);
  });

  it("handles multiple messages in one chunk and leaves malformed payload parsing to callers", () => {
    const decoder = createNdjsonLineDecoder();
    const lines = decoder.push("{\"id\":1}\nnot-json\n{\"id\":2}\n");

    expect(lines).toEqual(["{\"id\":1}", "not-json", "{\"id\":2}"]);
  });
});
