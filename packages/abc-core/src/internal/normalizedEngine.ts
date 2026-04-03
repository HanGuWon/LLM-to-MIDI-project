import {
  addRational,
  createRational,
  multiplyRational,
  type CanonicalNote,
  type CanonicalScore,
  type KeySignatureInfo,
  type Rational,
  type TempoEvent,
  type TimeSignatureEvent,
} from "@llm-midi/score-model";

import type {
  Classification,
  Diagnostic,
  InternalEngineResult,
} from "../types.js";

const HEADER_RE = /^([A-Za-z]):\s*(.*)$/;
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
const MAJOR_KEY_SIGNATURES = new Map<string, number>([
  ["C", 0],
  ["G", 1],
  ["D", 2],
  ["A", 3],
  ["E", 4],
  ["B", 5],
  ["F#", 6],
  ["C#", 7],
  ["F", -1],
  ["Bb", -2],
  ["Eb", -3],
  ["Ab", -4],
  ["Db", -5],
  ["Gb", -6],
  ["Cb", -7],
]);
const MINOR_KEY_SIGNATURES = new Map<string, number>([
  ["A", 0],
  ["E", 1],
  ["B", 2],
  ["F#", 3],
  ["C#", 4],
  ["G#", 5],
  ["D#", 6],
  ["A#", 7],
  ["D", -1],
  ["G", -2],
  ["C", -3],
  ["F", -4],
  ["Bb", -5],
  ["Eb", -6],
  ["Ab", -7],
]);

type ParsedHeaders = {
  title: string;
  meter?: string;
  noteLength: Rational;
  tempo: TempoEvent[];
  timeSignature?: TimeSignatureEvent;
  key?: KeySignatureInfo;
  keyAccidentals: Map<string, number>;
  bodyText: string;
  bodyStartLine: number;
};

type BodyEvent =
  | {
      kind: "note";
      pitchMidi: number;
      startWhole: Rational;
      durationWhole: Rational;
      sourceLine: number;
      sourceColumn: number;
      tieToNext: boolean;
    }
  | {
      kind: "rest";
      startWhole: Rational;
      durationWhole: Rational;
      sourceLine: number;
      sourceColumn: number;
    };

export function parseNormalizedAbcToCanonicalScore(
  normalizedAbc: string,
  classification: Classification,
  baseDiagnostics: Diagnostic[] = [],
): InternalEngineResult {
  const diagnostics = [...baseDiagnostics];
  const headers = parseHeaders(normalizedAbc, classification, diagnostics);

  if (!headers) {
    return {
      ok: false,
      diagnostics,
    };
  }

  const parseResult = parseBody(
    headers.bodyText,
    headers.bodyStartLine,
    headers.noteLength,
    headers.keyAccidentals,
    diagnostics,
  );

  if (!parseResult) {
    return {
      ok: false,
      diagnostics,
    };
  }

  const notes = mergeTiedNotes(parseResult, diagnostics);
  const score: CanonicalScore = {
    title: headers.title,
    normalizedAbc,
    classification,
    tempo: headers.tempo,
    timeSignature: headers.timeSignature,
    key: headers.key,
    notes,
    diagnostics,
  };

  return {
    ok: diagnostics.every((diagnostic) => !diagnostic.blocked),
    diagnostics,
    score,
  };
}

function parseHeaders(
  normalizedAbc: string,
  classification: Classification,
  diagnostics: Diagnostic[],
): ParsedHeaders | undefined {
  const lines = normalizedAbc.split("\n");
  const headerMap = new Map<string, string>();
  let bodyStartLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = HEADER_RE.exec(line);

    if (!line) {
      continue;
    }

    if (!match) {
      bodyStartLine = index + 1;
      break;
    }

    headerMap.set(match[1], match[2].trim());

    if (match[1] === "K") {
      bodyStartLine = index + 2;
      break;
    }
  }

  const bodyText = lines.slice(bodyStartLine - 1).join("\n").trim();

  if (!bodyText) {
    diagnostics.push({
      code: "internal-missing-body",
      severity: "error",
      message: "Internal engine requires normalized ABC with a non-empty body.",
      blocked: true,
    });
    return undefined;
  }

  const noteLength = parseRationalHeader(headerMap.get("L"));

  if (!noteLength) {
    diagnostics.push({
      code: "internal-invalid-note-length-header",
      severity: "error",
      message: "Internal engine could not parse the normalized `L:` header.",
      blocked: true,
    });
    return undefined;
  }

  const tempo = parseTempoHeader(headerMap.get("Q"), diagnostics);
  const timeSignature = parseTimeSignatureHeader(headerMap.get("M"), diagnostics);
  const keyInfo = parseKeyHeader(headerMap.get("K"), diagnostics);

  return {
    title: headerMap.get("T") ?? "Imported Fragment",
    meter: headerMap.get("M"),
    noteLength,
    tempo,
    timeSignature,
    key: keyInfo?.info,
    keyAccidentals: keyInfo?.accidentals ?? new Map<string, number>(),
    bodyText,
    bodyStartLine,
  };
}

function parseTempoHeader(
  rawTempo: string | undefined,
  diagnostics: Diagnostic[],
): TempoEvent[] {
  if (!rawTempo) {
    return [
      {
        atWhole: createRational(0, 1),
        bpm: 120,
        beatUnitDen: 4,
      },
    ];
  }

  const match = rawTempo.match(/(?:(\d+)\s*\/\s*(\d+)\s*=)?\s*(\d+)/);

  if (!match) {
    diagnostics.push({
      code: "internal-unsupported-tempo-format",
      severity: "error",
      message: `Internal engine does not support the normalized tempo format \`${rawTempo}\`.`,
      blocked: true,
    });
    return [];
  }

  return [
    {
      atWhole: createRational(0, 1),
      bpm: Number(match[3]),
      beatUnitDen: Number(match[2] ?? 4),
    },
  ];
}

function parseTimeSignatureHeader(
  rawMeter: string | undefined,
  diagnostics: Diagnostic[],
): TimeSignatureEvent | undefined {
  if (!rawMeter || /^none$/i.test(rawMeter)) {
    return undefined;
  }

  if (rawMeter === "C") {
    return {
      atWhole: createRational(0, 1),
      numerator: 4,
      denominator: 4,
    };
  }

  if (rawMeter === "C|") {
    return {
      atWhole: createRational(0, 1),
      numerator: 2,
      denominator: 2,
    };
  }

  const match = rawMeter.match(/^(\d+)\s*\/\s*(\d+)$/);

  if (!match) {
    diagnostics.push({
      code: "internal-unsupported-meter-format",
      severity: "error",
      message: `Internal engine does not support the normalized meter format \`${rawMeter}\`.`,
      blocked: true,
    });
    return undefined;
  }

  return {
    atWhole: createRational(0, 1),
    numerator: Number(match[1]),
    denominator: Number(match[2]),
  };
}

function parseKeyHeader(
  rawKey: string | undefined,
  diagnostics: Diagnostic[],
): { info: KeySignatureInfo; accidentals: Map<string, number> } | undefined {
  if (!rawKey) {
    return undefined;
  }

  if (/^none$/i.test(rawKey)) {
    return {
      info: {
        tonic: "none",
        mode: "none",
        accidentals: [],
      },
      accidentals: new Map<string, number>(),
    };
  }

  const trimmed = rawKey.trim();
  const match = trimmed.match(/^([A-Ga-g])([b#]?)(.*)$/);

  if (!match) {
    diagnostics.push({
      code: "internal-unsupported-key-format",
      severity: "error",
      message: `Internal engine does not support the normalized key format \`${rawKey}\`.`,
      blocked: true,
    });
    return undefined;
  }

  const tonic = `${match[1].toUpperCase()}${match[2] ?? ""}`;
  const suffix = match[3].trim().toLowerCase();
  const mode: "major" | "minor" = /^(m|min|minor)$/.test(suffix) ? "minor" : "major";
  const signatureCount = mode === "major"
    ? MAJOR_KEY_SIGNATURES.get(tonic)
    : MINOR_KEY_SIGNATURES.get(tonic);

  if (signatureCount === undefined) {
    diagnostics.push({
      code: "internal-unsupported-key-signature",
      severity: "error",
      message: `Internal engine does not recognize the key signature \`${rawKey}\`.`,
      blocked: true,
    });
    return undefined;
  }

  const accidentals = new Map<string, number>();

  if (signatureCount > 0) {
    for (const letter of SHARP_ORDER.slice(0, signatureCount)) {
      accidentals.set(letter, 1);
    }
  }

  if (signatureCount < 0) {
    for (const letter of FLAT_ORDER.slice(0, Math.abs(signatureCount))) {
      accidentals.set(letter, -1);
    }
  }

  return {
    info: {
      tonic,
      mode,
      accidentals: [...accidentals.entries()].map(([letter, offset]) => `${letter}${offset > 0 ? "#" : "b"}`),
    },
    accidentals,
  };
}

function parseBody(
  bodyText: string,
  bodyStartLine: number,
  defaultNoteLength: Rational,
  keyAccidentals: Map<string, number>,
  diagnostics: Diagnostic[],
): BodyEvent[] | undefined {
  const events: BodyEvent[] = [];
  let currentTime = createRational(0, 1);
  let line = bodyStartLine;
  let column = 1;
  let index = 0;
  const barAccidentals = new Map<string, number>();

  while (index < bodyText.length) {
    const char = bodyText[index];

    if (char === "\n") {
      line += 1;
      column = 1;
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      column += 1;
      index += 1;
      continue;
    }

    if (char === "\"") {
      const chordEnd = bodyText.indexOf("\"", index + 1);
      const endIndex = chordEnd === -1 ? bodyText.length : chordEnd + 1;
      const consumed = bodyText.slice(index, endIndex);
      const lineBreakCount = consumed.split("\n").length - 1;

      if (lineBreakCount > 0) {
        line += lineBreakCount;
        column = consumed.slice(consumed.lastIndexOf("\n") + 1).length + 1;
      } else {
        column += consumed.length;
      }

      index = endIndex;
      continue;
    }

    if (char === "|") {
      barAccidentals.clear();
      column += 1;
      index += 1;
      continue;
    }

    if (char === ":") {
      diagnostics.push(unsupportedDiagnostic("internal-unsupported-repeats", "repeats and endings", line, column));
      return undefined;
    }

    if (char === "[") {
      diagnostics.push(unsupportedDiagnostic("internal-unsupported-block-chords", "block chords and endings", line, column));
      return undefined;
    }

    if (char === "(" && /\d/.test(bodyText[index + 1] ?? "")) {
      diagnostics.push(unsupportedDiagnostic("internal-unsupported-tuplets", "tuplets", line, column));
      return undefined;
    }

    if (char === "&") {
      diagnostics.push(unsupportedDiagnostic("internal-unsupported-voice-overlay", "voice overlays", line, column));
      return undefined;
    }

    if (/[VPwW]/.test(char) && bodyText[index + 1] === ":") {
      diagnostics.push(unsupportedDiagnostic("internal-unsupported-structure", `${char}: structures`, line, column));
      return undefined;
    }

    const noteStartLine = line;
    const noteStartColumn = column;
    let accidentalOffset: number | undefined;
    let noteIndex = index;

    if (bodyText[noteIndex] === "^" || bodyText[noteIndex] === "_" || bodyText[noteIndex] === "=") {
      const accidentalSymbol = bodyText[noteIndex];
      let accidentalCount = 0;

      while (bodyText[noteIndex] === accidentalSymbol) {
        accidentalCount += 1;
        noteIndex += 1;
        column += 1;
      }

      if (accidentalSymbol === "=") {
        accidentalOffset = 0;
      } else {
        accidentalOffset = accidentalSymbol === "^" ? accidentalCount : -accidentalCount;
      }
    }

    const pitchChar = bodyText[noteIndex];

    if (!pitchChar || !/[A-Ga-gzZ]/.test(pitchChar)) {
      diagnostics.push({
        code: "internal-unexpected-token",
        severity: "error",
        message: `Internal engine found an unsupported token \`${pitchChar ?? "EOF"}\`.`,
        line: noteStartLine,
        column: noteStartColumn,
        blocked: true,
      });
      return undefined;
    }

    noteIndex += 1;
    column += 1;
    let octaveDelta = 0;

    while (bodyText[noteIndex] === "'" || bodyText[noteIndex] === ",") {
      octaveDelta += bodyText[noteIndex] === "'" ? 12 : -12;
      noteIndex += 1;
      column += 1;
    }

    const lengthStart = noteIndex;
    while (/[0-9/]/.test(bodyText[noteIndex] ?? "")) {
      noteIndex += 1;
      column += 1;
    }

    const rawLength = bodyText.slice(lengthStart, noteIndex);
    const durationMultiplier = parseLengthMultiplier(rawLength, noteStartLine, noteStartColumn, diagnostics);

    if (!durationMultiplier) {
      return undefined;
    }

    const durationWhole = multiplyRational(defaultNoteLength, durationMultiplier);
    let tieToNext = false;

    if (bodyText[noteIndex] === "-") {
      tieToNext = true;
      noteIndex += 1;
      column += 1;
    }

    if (pitchChar === "z" || pitchChar === "Z") {
      events.push({
        kind: "rest",
        startWhole: currentTime,
        durationWhole,
        sourceLine: noteStartLine,
        sourceColumn: noteStartColumn,
      });
    } else {
      const noteLetter = pitchChar.toUpperCase();
      const resolvedAccidental = accidentalOffset
        ?? barAccidentals.get(noteLetter)
        ?? keyAccidentals.get(noteLetter)
        ?? 0;

      if (accidentalOffset !== undefined) {
        barAccidentals.set(noteLetter, accidentalOffset);
      }

      events.push({
        kind: "note",
        pitchMidi: pitchCharToMidi(pitchChar) + octaveDelta + resolvedAccidental,
        startWhole: currentTime,
        durationWhole,
        sourceLine: noteStartLine,
        sourceColumn: noteStartColumn,
        tieToNext,
      });
    }

    currentTime = addRational(currentTime, durationWhole);
    index = noteIndex;
  }

  return events;
}

function mergeTiedNotes(
  events: BodyEvent[],
  diagnostics: Diagnostic[],
): CanonicalNote[] {
  const notes: CanonicalNote[] = [];
  let noteCounter = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];

    if (event.kind !== "note") {
      continue;
    }

    let mergedDuration = event.durationWhole;
    let current = event;
    let nextIndex = index + 1;

    while (current.tieToNext) {
      const next = events[nextIndex];

      if (!next || next.kind !== "note" || next.pitchMidi !== current.pitchMidi) {
        diagnostics.push({
          code: "internal-invalid-tie-chain",
          severity: "error",
          message: "Internal engine only supports ties between immediately adjacent identical pitches.",
          line: current.sourceLine,
          column: current.sourceColumn,
          blocked: true,
        });
        return [];
      }

      mergedDuration = addRational(mergedDuration, next.durationWhole);
      current = next;
      nextIndex += 1;
    }

    notes.push({
      id: `note-${++noteCounter}`,
      pitchMidi: event.pitchMidi,
      startWhole: event.startWhole,
      durationWhole: mergedDuration,
      velocity: 100,
      voiceId: "1",
      sourceLine: event.sourceLine,
      sourceColumn: event.sourceColumn,
    });

    index = nextIndex - 1;
  }

  return notes;
}

function parseRationalHeader(value: string | undefined): Rational | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.match(/^(\d+)\s*\/\s*(\d+)$/);

  if (!match) {
    return undefined;
  }

  return createRational(Number(match[1]), Number(match[2]));
}

function parseLengthMultiplier(
  rawLength: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
): Rational | undefined {
  if (!rawLength) {
    return createRational(1, 1);
  }

  const numeratorMatch = rawLength.match(/^(\d+)$/);

  if (numeratorMatch) {
    return createRational(Number(numeratorMatch[1]), 1);
  }

  const fractionMatch = rawLength.match(/^(\d+)\/(\d+)$/);

  if (fractionMatch) {
    return createRational(Number(fractionMatch[1]), Number(fractionMatch[2]));
  }

  const trailingSlashMatch = rawLength.match(/^(\d+)\/+$/);

  if (trailingSlashMatch) {
    const slashCount = rawLength.length - trailingSlashMatch[1].length;
    return createRational(Number(trailingSlashMatch[1]), 2 ** slashCount);
  }

  const leadingSlashDigitsMatch = rawLength.match(/^\/(\d+)$/);

  if (leadingSlashDigitsMatch) {
    return createRational(1, Number(leadingSlashDigitsMatch[1]));
  }

  const slashOnlyMatch = rawLength.match(/^\/+$/);

  if (slashOnlyMatch) {
    return createRational(1, 2 ** rawLength.length);
  }

  diagnostics.push({
    code: "internal-invalid-note-length",
    severity: "error",
    message: `Internal engine could not parse the note length token \`${rawLength}\`.`,
    line,
    column,
    blocked: true,
  });

  return undefined;
}

function pitchCharToMidi(pitchChar: string): number {
  const pitchMap: Record<string, number> = {
    C: 60,
    D: 62,
    E: 64,
    F: 65,
    G: 67,
    A: 69,
    B: 71,
    c: 72,
    d: 74,
    e: 76,
    f: 77,
    g: 79,
    a: 81,
    b: 83,
  };

  return pitchMap[pitchChar];
}

function unsupportedDiagnostic(
  code: string,
  construct: string,
  line: number,
  column: number,
): Diagnostic {
  return {
    code,
    severity: "error",
    message: `Internal engine does not support ${construct} yet.`,
    line,
    column,
    blocked: true,
  };
}
