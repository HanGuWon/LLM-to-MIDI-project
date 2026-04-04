import { describe, expect, it } from "vitest";

import {
  createReadyEvent,
  createErrorResponse,
  createSuccessResponse,
  isWorkerReadyEvent,
  isSupportedProtocolVersion,
  isWorkerRequestKind,
  PROTOCOL_VERSION,
} from "../../packages/worker-protocol/src/index.js";

describe("worker-protocol", () => {
  it("recognizes supported request kinds", () => {
    expect(isWorkerRequestKind("ping")).toBe(true);
    expect(isWorkerRequestKind("convert")).toBe(true);
    expect(isWorkerRequestKind("nope")).toBe(false);
  });

  it("recognizes the current protocol version", () => {
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
    expect(isSupportedProtocolVersion("v0")).toBe(false);
  });

  it("builds success and error payloads with the expected shape", () => {
    const success = createSuccessResponse("1", "ping", { status: "ok" });
    const error = createErrorResponse("2", "unknown", "bad-request", "Broken request");

    expect(success.ok).toBe(true);
    expect(success.protocolVersion).toBe("v1");
    expect(error.ok).toBe(false);
    expect(error.error.code).toBe("bad-request");
    expect(error.error.message).toContain("Broken request");
  });

  it("builds a pipe ready event with the expected shape", () => {
    const ready = createReadyEvent("\\\\.\\pipe\\llm-midi-test");

    expect(isWorkerReadyEvent(ready)).toBe(true);
    expect(ready.transport).toBe("pipe");
    expect(ready.endpoint.path).toContain("llm-midi-test");
  });
});
