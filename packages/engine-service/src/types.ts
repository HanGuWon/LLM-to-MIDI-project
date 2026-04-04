import type {
  Classification,
  Diagnostic,
  ValidateResult,
} from "@llm-midi/abc-core";
import type { CanonicalScore } from "@llm-midi/score-model";

export type EngineName = "abc2midi" | "internal" | "auto";

export interface DeterministicExportPlan {
  title: string;
  slug: string;
  contentHash: string;
  suggestedFileName: string;
}

export interface InspectAbcTextResult {
  ok: boolean;
  classification: Classification;
  normalizedAbc: string;
  diagnostics: Diagnostic[];
  score?: CanonicalScore;
}

export interface ConvertAbcTextOptions {
  engine?: EngineName;
  abc2midiPath?: string;
  env?: NodeJS.ProcessEnv;
  includeCanonicalScore?: boolean;
}

export interface ConvertFallbackMetadata {
  attempted: "internal";
  reason: "unsupported";
  diagnostics: Diagnostic[];
}

export interface ConvertAbcTextResult {
  ok: boolean;
  classification: Classification;
  normalizedAbc: string;
  diagnostics: Diagnostic[];
  toolStdout: string;
  toolStderr: string;
  engineUsed?: "abc2midi" | "internal";
  fallback?: ConvertFallbackMetadata;
  exportPlan?: DeterministicExportPlan;
  midiBuffer?: Buffer;
  canonicalScore?: CanonicalScore;
}

export type ValidateAbcTextResult = ValidateResult;
