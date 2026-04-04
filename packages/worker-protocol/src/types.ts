import type {
  Classification,
  Diagnostic,
  ValidateResult,
} from "@llm-midi/abc-core";
import type { CanonicalScore } from "@llm-midi/score-model";

export const PROTOCOL_VERSION = "v1";

export type ProtocolVersion = typeof PROTOCOL_VERSION;
export type RequestKind = "ping" | "validate" | "inspect" | "convert" | "shutdown";
export type EngineName = "abc2midi" | "internal" | "auto";
export type WorkerTransportKind = "stdio" | "pipe";

export interface BaseRequest {
  id: string;
  protocolVersion: ProtocolVersion;
  kind: RequestKind;
}

export interface PingRequest extends BaseRequest {
  kind: "ping";
}

export interface ValidateRequest extends BaseRequest {
  kind: "validate";
  abcText: string;
}

export interface InspectRequest extends BaseRequest {
  kind: "inspect";
  abcText: string;
}

export interface ConvertRequest extends BaseRequest {
  kind: "convert";
  abcText: string;
  engine: EngineName;
  abc2midiPath?: string;
  includeMidiBase64?: boolean;
  includeCanonicalScore?: boolean;
}

export interface ShutdownRequest extends BaseRequest {
  kind: "shutdown";
}

export type WorkerRequest =
  | PingRequest
  | ValidateRequest
  | InspectRequest
  | ConvertRequest
  | ShutdownRequest;

export interface ProtocolError {
  code: string;
  message: string;
}

export interface WorkerExportPlanMetadata {
  title: string;
  slug: string;
  contentHash: string;
  suggestedFileName: string;
}

export interface WorkerInspectResult {
  ok: boolean;
  classification: Classification;
  normalizedAbc: string;
  diagnostics: Diagnostic[];
  score?: CanonicalScore;
}

export interface WorkerConvertResult {
  ok: boolean;
  classification: Classification;
  normalizedAbc: string;
  diagnostics: Diagnostic[];
  toolStdout: string;
  toolStderr: string;
  engineUsed?: "abc2midi" | "internal";
  fallback?: {
    attempted: "internal";
    reason: "unsupported";
    diagnostics: Diagnostic[];
  };
  exportPlan?: WorkerExportPlanMetadata;
  midiBase64?: string;
  canonicalScore?: CanonicalScore;
}

export interface PingResult {
  status: "ok";
}

export interface ShutdownResult {
  status: "shutting-down";
}

export type ValidateWorkerResult = ValidateResult;

export type WorkerSuccessResultByKind = {
  ping: PingResult;
  validate: ValidateWorkerResult;
  inspect: WorkerInspectResult;
  convert: WorkerConvertResult;
  shutdown: ShutdownResult;
};

export interface WorkerSuccessResponse<K extends RequestKind = RequestKind> {
  id: string;
  protocolVersion: ProtocolVersion;
  kind: K;
  ok: true;
  result: WorkerSuccessResultByKind[K];
}

export interface WorkerErrorResponse {
  id: string;
  protocolVersion: ProtocolVersion;
  kind: string;
  ok: false;
  error: ProtocolError;
  diagnostics?: Diagnostic[];
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export interface WorkerReadyEvent {
  protocolVersion: ProtocolVersion;
  kind: "ready";
  transport: "pipe";
  endpoint: {
    type: "pipe";
    path: string;
  };
}
