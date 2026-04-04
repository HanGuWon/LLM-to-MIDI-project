import type {
  Diagnostic,
} from "@llm-midi/abc-core";

import {
  PROTOCOL_VERSION,
  type ProtocolVersion,
  type RequestKind,
  type WorkerErrorResponse,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerSuccessResponse,
} from "./types.js";

export {
  PROTOCOL_VERSION,
  type BaseRequest,
  type ConvertRequest,
  type EngineName,
  type InspectRequest,
  type PingRequest,
  type PingResult,
  type ProtocolError,
  type ProtocolVersion,
  type RequestKind,
  type ShutdownRequest,
  type ShutdownResult,
  type ValidateRequest,
  type ValidateWorkerResult,
  type WorkerConvertResult,
  type WorkerErrorResponse,
  type WorkerExportPlanMetadata,
  type WorkerInspectResult,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerSuccessResponse,
} from "./types.js";

const REQUEST_KINDS: RequestKind[] = ["ping", "validate", "inspect", "convert", "shutdown"];

export function isSupportedProtocolVersion(input: unknown): input is ProtocolVersion {
  return input === PROTOCOL_VERSION;
}

export function isWorkerRequestKind(input: unknown): input is RequestKind {
  return typeof input === "string" && REQUEST_KINDS.includes(input as RequestKind);
}

export function createSuccessResponse<K extends RequestKind>(
  id: string,
  kind: K,
  result: WorkerSuccessResponse<K>["result"],
): WorkerSuccessResponse<K> {
  return {
    id,
    protocolVersion: PROTOCOL_VERSION,
    kind,
    ok: true,
    result,
  };
}

export function createErrorResponse(
  id: string,
  kind: string,
  code: string,
  message: string,
  diagnostics?: Diagnostic[],
): WorkerErrorResponse {
  return {
    id,
    protocolVersion: PROTOCOL_VERSION,
    kind,
    ok: false,
    error: {
      code,
      message,
    },
    diagnostics,
  };
}

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkerResponse>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.protocolVersion === "string"
    && typeof candidate.kind === "string"
    && typeof candidate.ok === "boolean"
  );
}
