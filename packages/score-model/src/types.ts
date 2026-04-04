export type Classification = "tune" | "fragment";

export interface Diagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
  blocked: boolean;
  appliedFix?: string;
}

export interface Rational {
  num: number;
  den: number;
}

export interface CanonicalNote {
  id: string;
  pitchMidi: number;
  startWhole: Rational;
  durationWhole: Rational;
  velocity: number;
  voiceId: string;
  chordId?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface TempoEvent {
  atWhole: Rational;
  bpm: number;
  beatUnitDen: number;
}

export interface TimeSignatureEvent {
  atWhole: Rational;
  numerator: number;
  denominator: number;
}

export interface KeySignatureInfo {
  tonic: string;
  mode: "major" | "minor" | "none";
  accidentals: string[];
}

export interface CanonicalScore {
  title: string;
  normalizedAbc: string;
  classification: Classification;
  tempo: TempoEvent[];
  timeSignature?: TimeSignatureEvent;
  key?: KeySignatureInfo;
  notes: CanonicalNote[];
  diagnostics: Diagnostic[];
}
