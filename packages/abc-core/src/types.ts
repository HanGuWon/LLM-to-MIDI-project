export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  line?: number;
  column?: number;
  blocked: boolean;
  appliedFix?: string;
}

export type Classification = "tune" | "fragment";

export interface ValidateResult {
  ok: boolean;
  classification: Classification;
  normalizedAbc: string;
  unsupportedConstructs: string[];
  diagnostics: Diagnostic[];
}

export interface ConvertResult {
  ok: boolean;
  midiPath?: string;
  diagnostics: Diagnostic[];
  toolStdout: string;
  toolStderr: string;
}
