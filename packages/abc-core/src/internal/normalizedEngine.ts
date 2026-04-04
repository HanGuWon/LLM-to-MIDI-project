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
  noteLength: Rational;
  tempo: TempoEvent[];
  timeSignature?: TimeSignatureEvent;
  key?: KeySignatureInfo;
  keyAccidentals: Map<string, number>;
  bodyText: string;
  bodyStartLine: number;
};

type BodyMarkerKind = "bar" | "repeatStart" | "repeatEnd" | "ending1" | "ending2" | "finalBar";

type BodyMarker = {
  kind: BodyMarkerKind;
  sourceLine: number;
  sourceColumn: number;
};

type NoteAtom = {
  kind: "note";
  pitchMidi: number;
  durationWhole: Rational;
  sourceLine: number;
  sourceColumn: number;
  tieToNext: boolean;
};

type RestAtom = {
  kind: "rest";
  durationWhole: Rational;
  sourceLine: number;
  sourceColumn: number;
};

type ChordAtom = {
  kind: "chord";
  pitchesMidi: number[];
  durationWhole: Rational;
  sourceLine: number;
  sourceColumn: number;
  chordId: string;
};

type BodyAtom = NoteAtom | RestAtom | ChordAtom;
type BodyItem = BodyAtom | BodyMarker;
type TimedBodyAtom = (NoteAtom | RestAtom | ChordAtom) & { startWhole: Rational };

export function parseNormalizedAbcToCanonicalScore(
  normalizedAbc: string,
  classification: Classification,
  baseDiagnostics: Diagnostic[] = [],
): InternalEngineResult {
  const diagnostics = [...baseDiagnostics];
  const headers = parseHeaders(normalizedAbc, diagnostics);

  if (!headers) {
    return { ok: false, diagnostics };
  }

  const bodyItems = parseBodyItems(
    headers.bodyText,
    headers.bodyStartLine,
    headers.noteLength,
    headers.keyAccidentals,
    diagnostics,
  );

  if (!bodyItems) {
    return { ok: false, diagnostics };
  }

  const expandedAtoms = expandStructuralItems(bodyItems, diagnostics);

  if (!expandedAtoms) {
    return { ok: false, diagnostics };
  }

  const timedAtoms = assignPlaybackTimes(expandedAtoms);
  const notes = materializeCanonicalNotes(timedAtoms, diagnostics);

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
    diagnostics.push(blockingDiagnostic(
      "internal-missing-body",
      "Internal engine requires normalized ABC with a non-empty body.",
    ));
    return undefined;
  }

  const noteLength = parseRationalHeader(headerMap.get("L"));

  if (!noteLength) {
    diagnostics.push(blockingDiagnostic(
      "internal-invalid-note-length-header",
      "Internal engine could not parse the normalized `L:` header.",
    ));
    return undefined;
  }

  const tempo = parseTempoHeader(headerMap.get("Q"), diagnostics);
  const timeSignature = parseTimeSignatureHeader(headerMap.get("M"), diagnostics);
  const keyInfo = parseKeyHeader(headerMap.get("K"), diagnostics);

  return {
    title: headerMap.get("T") ?? "Imported Fragment",
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
    return [{ atWhole: createRational(0, 1), bpm: 120, beatUnitDen: 4 }];
  }

  const match = rawTempo.match(/(?:(\d+)\s*\/\s*(\d+)\s*=)?\s*(\d+)/);

  if (!match) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-tempo-format",
      `Internal engine does not support the normalized tempo format \`${rawTempo}\`.`,
    ));
    return [];
  }

  return [{
    atWhole: createRational(0, 1),
    bpm: Number(match[3]),
    beatUnitDen: Number(match[2] ?? 4),
  }];
}

function parseTimeSignatureHeader(
  rawMeter: string | undefined,
  diagnostics: Diagnostic[],
): TimeSignatureEvent | undefined {
  if (!rawMeter || /^none$/i.test(rawMeter)) {
    return undefined;
  }

  if (rawMeter === "C") {
    return { atWhole: createRational(0, 1), numerator: 4, denominator: 4 };
  }

  if (rawMeter === "C|") {
    return { atWhole: createRational(0, 1), numerator: 2, denominator: 2 };
  }

  const match = rawMeter.match(/^(\d+)\s*\/\s*(\d+)$/);

  if (!match) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-meter-format",
      `Internal engine does not support the normalized meter format \`${rawMeter}\`.`,
    ));
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
      info: { tonic: "none", mode: "none", accidentals: [] },
      accidentals: new Map<string, number>(),
    };
  }

  const trimmed = rawKey.trim();
  const match = trimmed.match(/^([A-Ga-g])([b#]?)(.*)$/);

  if (!match) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-key-format",
      `Internal engine does not support the normalized key format \`${rawKey}\`.`,
    ));
    return undefined;
  }

  const tonic = `${match[1].toUpperCase()}${match[2] ?? ""}`;
  const suffix = match[3].trim().toLowerCase();
  const mode: "major" | "minor" = /^(m|min|minor)$/.test(suffix) ? "minor" : "major";
  const signatureCount = mode === "major"
    ? MAJOR_KEY_SIGNATURES.get(tonic)
    : MINOR_KEY_SIGNATURES.get(tonic);

  if (signatureCount === undefined) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-key-signature",
      `Internal engine does not recognize the key signature \`${rawKey}\`.`,
    ));
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

function parseBodyItems(
  bodyText: string,
  bodyStartLine: number,
  defaultNoteLength: Rational,
  keyAccidentals: Map<string, number>,
  diagnostics: Diagnostic[],
): BodyItem[] | undefined {
  const items: BodyItem[] = [];
  const barAccidentals = new Map<string, number>();
  let index = 0;
  let chordCounter = 0;
  let activeTriplet: { remaining: number; line: number; column: number } | undefined;

  while (index < bodyText.length) {
    const char = bodyText[index];

    if (char === "\n" || /\s/.test(char)) {
      index += 1;
      continue;
    }

    const source = indexToLineColumn(bodyText, index, bodyStartLine);

    if (char === "\"") {
      const chordEnd = bodyText.indexOf("\"", index + 1);
      index = chordEnd === -1 ? bodyText.length : chordEnd + 1;
      continue;
    }

    if (bodyText.startsWith("|:", index)) {
      barAccidentals.clear();
      items.push({ kind: "repeatStart", sourceLine: source.line, sourceColumn: source.column });
      index += 2;
      continue;
    }

    if (bodyText.startsWith(":|", index)) {
      barAccidentals.clear();
      items.push({ kind: "repeatEnd", sourceLine: source.line, sourceColumn: source.column });
      index += 2;
      continue;
    }

    if (bodyText.startsWith("||", index)) {
      barAccidentals.clear();
      items.push({ kind: "finalBar", sourceLine: source.line, sourceColumn: source.column });
      index += 2;
      continue;
    }

    if (bodyText.startsWith("[1", index)) {
      barAccidentals.clear();
      items.push({ kind: "ending1", sourceLine: source.line, sourceColumn: source.column });
      index += 2;
      continue;
    }

    if (bodyText.startsWith("[2", index)) {
      barAccidentals.clear();
      items.push({ kind: "ending2", sourceLine: source.line, sourceColumn: source.column });
      index += 2;
      continue;
    }

    if (char === "|") {
      barAccidentals.clear();
      items.push({ kind: "bar", sourceLine: source.line, sourceColumn: source.column });
      index += 1;
      continue;
    }

    if (char === "(" && /\d/.test(bodyText[index + 1] ?? "")) {
      if ((bodyText[index + 2] ?? "") === ":") {
        diagnostics.push(blockingDiagnostic(
          "internal-unsupported-general-tuplet",
          "Internal engine only supports standard `(3` triplets, not extended tuplet ratios.",
          source.line,
          source.column,
        ));
        return undefined;
      }

      if (bodyText[index + 1] !== "3") {
        diagnostics.push(blockingDiagnostic(
          "internal-unsupported-general-tuplet",
          `Internal engine only supports standard \`(3\` triplets, not \`(${bodyText[index + 1]}\`.`,
          source.line,
          source.column,
        ));
        return undefined;
      }

      if (activeTriplet) {
        diagnostics.push(blockingDiagnostic(
          "internal-unsupported-nested-triplet",
          "Internal engine does not support nested or overlapping triplets.",
          source.line,
          source.column,
        ));
        return undefined;
      }

      activeTriplet = { remaining: 3, line: source.line, column: source.column };
      index += 2;
      continue;
    }

    if (char === "[") {
      if (activeTriplet) {
        diagnostics.push(blockingDiagnostic(
          "internal-unsupported-triplet-chord-mix",
          "Internal engine does not support block chords inside triplet groups.",
          source.line,
          source.column,
        ));
        return undefined;
      }

      const chord = parseChordAtom(
        bodyText,
        index,
        source.line,
        source.column,
        defaultNoteLength,
        keyAccidentals,
        barAccidentals,
        diagnostics,
        ++chordCounter,
      );

      if (!chord) {
        return undefined;
      }

      items.push(chord.atom);
      index = chord.nextIndex;
      continue;
    }

    const atom = parseSimpleAtom(
      bodyText,
      index,
      source.line,
      source.column,
      defaultNoteLength,
      keyAccidentals,
      barAccidentals,
      diagnostics,
      activeTriplet ? createRational(2, 3) : undefined,
    );

    if (!atom) {
      return undefined;
    }

    items.push(atom.atom);
    index = atom.nextIndex;

    if (activeTriplet) {
      activeTriplet.remaining -= 1;
      if (activeTriplet.remaining === 0) {
        activeTriplet = undefined;
      }
    }
  }

  if (activeTriplet) {
    diagnostics.push(blockingDiagnostic(
      "internal-incomplete-triplet",
      "Internal engine found an incomplete `(3` triplet group.",
      activeTriplet.line,
      activeTriplet.column,
    ));
    return undefined;
  }

  return items;
}

function expandStructuralItems(
  items: BodyItem[],
  diagnostics: Diagnostic[],
): BodyAtom[] | undefined {
  const repeatStarts = collectMarkerIndices(items, "repeatStart");
  const repeatEnds = collectMarkerIndices(items, "repeatEnd");
  const ending1s = collectMarkerIndices(items, "ending1");
  const ending2s = collectMarkerIndices(items, "ending2");

  if (repeatStarts.length === 0 && repeatEnds.length === 0 && ending1s.length === 0 && ending2s.length === 0) {
    return items.filter(isAtom);
  }

  if (repeatStarts.length !== 1 || repeatEnds.length !== 1 || ending1s.length > 1 || ending2s.length > 1) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-repeat-structure",
      "Internal engine supports only a single one-level repeat region with optional first/second endings.",
    ));
    return undefined;
  }

  const repeatStart = repeatStarts[0];
  const repeatEnd = repeatEnds[0];

  if (repeatStart >= repeatEnd) {
    diagnostics.push(blockingDiagnostic(
      "internal-invalid-repeat-order",
      "Internal engine found a repeat end before its repeat start.",
    ));
    return undefined;
  }

  const prefix = extractAtoms(items.slice(0, repeatStart));

  if (ending1s.length === 0 && ending2s.length === 0) {
    const loop = extractAtoms(items.slice(repeatStart + 1, repeatEnd));
    const suffix = extractAtoms(items.slice(repeatEnd + 1));
    return [...prefix, ...loop, ...loop, ...suffix];
  }

  if (ending1s.length !== 1 || ending2s.length !== 1) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-repeat-endings",
      "Internal engine requires both `[1` and `[2` when repeat endings are used.",
    ));
    return undefined;
  }

  const ending1 = ending1s[0];
  const ending2 = ending2s[0];

  if (!(repeatStart < ending1 && ending1 < repeatEnd && repeatEnd < ending2)) {
    diagnostics.push(blockingDiagnostic(
      "internal-invalid-repeat-endings",
      "Internal engine could not match the repeat and ending markers into a supported one-level structure.",
    ));
    return undefined;
  }

  if (extractAtoms(items.slice(repeatEnd + 1, ending2)).length > 0) {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-repeat-structure",
      "Internal engine does not support extra playback atoms between `:|` and `[2`.",
    ));
    return undefined;
  }

  const common = extractAtoms(items.slice(repeatStart + 1, ending1));
  const firstEnding = extractAtoms(items.slice(ending1 + 1, repeatEnd));
  const secondEnding = extractAtoms(items.slice(ending2 + 1));

  return [...prefix, ...common, ...firstEnding, ...common, ...secondEnding];
}

function assignPlaybackTimes(atoms: BodyAtom[]): TimedBodyAtom[] {
  const timedAtoms: TimedBodyAtom[] = [];
  let currentTime = createRational(0, 1);

  for (const atom of atoms) {
    timedAtoms.push({
      ...atom,
      startWhole: currentTime,
    });
    currentTime = addRational(currentTime, atom.durationWhole);
  }

  return timedAtoms;
}

function materializeCanonicalNotes(
  atoms: TimedBodyAtom[],
  diagnostics: Diagnostic[],
): CanonicalNote[] {
  const notes: CanonicalNote[] = [];
  let noteCounter = 0;

  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index];

    if (atom.kind === "rest") {
      continue;
    }

    if (atom.kind === "chord") {
      for (const pitchMidi of atom.pitchesMidi) {
        notes.push({
          id: `note-${++noteCounter}`,
          pitchMidi,
          startWhole: atom.startWhole,
          durationWhole: atom.durationWhole,
          velocity: 100,
          voiceId: "1",
          chordId: atom.chordId,
          sourceLine: atom.sourceLine,
          sourceColumn: atom.sourceColumn,
        });
      }
      continue;
    }

    let mergedDuration = atom.durationWhole;
    let current = atom;
    let nextIndex = index + 1;

    while (current.tieToNext) {
      const next = atoms[nextIndex];

      if (!next || next.kind !== "note" || next.pitchMidi !== current.pitchMidi) {
        diagnostics.push(blockingDiagnostic(
          "internal-invalid-tie-chain",
          "Internal engine only supports ties between immediately adjacent identical note atoms.",
          current.sourceLine,
          current.sourceColumn,
        ));
        return [];
      }

      mergedDuration = addRational(mergedDuration, next.durationWhole);
      current = next;
      nextIndex += 1;
    }

    notes.push({
      id: `note-${++noteCounter}`,
      pitchMidi: atom.pitchMidi,
      startWhole: atom.startWhole,
      durationWhole: mergedDuration,
      velocity: 100,
      voiceId: "1",
      sourceLine: atom.sourceLine,
      sourceColumn: atom.sourceColumn,
    });

    index = nextIndex - 1;
  }

  return notes;
}

function parseSimpleAtom(
  bodyText: string,
  index: number,
  line: number,
  column: number,
  defaultNoteLength: Rational,
  keyAccidentals: Map<string, number>,
  barAccidentals: Map<string, number>,
  diagnostics: Diagnostic[],
  tupletFactor?: Rational,
): { atom: NoteAtom | RestAtom; nextIndex: number } | undefined {
  let noteIndex = index;
  let accidentalOffset: number | undefined;

  if (bodyText[noteIndex] === "^" || bodyText[noteIndex] === "_" || bodyText[noteIndex] === "=") {
    const accidentalSymbol = bodyText[noteIndex];
    let accidentalCount = 0;

    while (bodyText[noteIndex] === accidentalSymbol) {
      accidentalCount += 1;
      noteIndex += 1;
    }

    accidentalOffset = accidentalSymbol === "=" ? 0 : accidentalSymbol === "^" ? accidentalCount : -accidentalCount;
  }

  const pitchChar = bodyText[noteIndex];

  if (!pitchChar || !/[A-Ga-gzZ]/.test(pitchChar)) {
    diagnostics.push(blockingDiagnostic(
      "internal-unexpected-token",
      `Internal engine found an unsupported token \`${pitchChar ?? "EOF"}\`.`,
      line,
      column,
    ));
    return undefined;
  }

  noteIndex += 1;
  let octaveDelta = 0;

  while (bodyText[noteIndex] === "'" || bodyText[noteIndex] === ",") {
    octaveDelta += bodyText[noteIndex] === "'" ? 12 : -12;
    noteIndex += 1;
  }

  const lengthStart = noteIndex;
  while (/[0-9/]/.test(bodyText[noteIndex] ?? "")) {
    noteIndex += 1;
  }

  const rawLength = bodyText.slice(lengthStart, noteIndex);
  const durationMultiplier = parseLengthMultiplier(rawLength, line, column, diagnostics);

  if (!durationMultiplier) {
    return undefined;
  }

  let durationWhole = multiplyRational(defaultNoteLength, durationMultiplier);
  if (tupletFactor) {
    durationWhole = multiplyRational(durationWhole, tupletFactor);
  }

  let tieToNext = false;

  if (bodyText[noteIndex] === "-") {
    tieToNext = true;
    noteIndex += 1;
  }

  if (pitchChar === "z" || pitchChar === "Z") {
    if (tieToNext) {
      diagnostics.push(blockingDiagnostic(
        "internal-invalid-rest-tie",
        "Internal engine does not support ties on rests.",
        line,
        column,
      ));
      return undefined;
    }

    return {
      atom: {
        kind: "rest",
        durationWhole,
        sourceLine: line,
        sourceColumn: column,
      },
      nextIndex: noteIndex,
    };
  }

  const noteLetter = pitchChar.toUpperCase();
  const resolvedAccidental = accidentalOffset
    ?? barAccidentals.get(noteLetter)
    ?? keyAccidentals.get(noteLetter)
    ?? 0;

  if (accidentalOffset !== undefined) {
    barAccidentals.set(noteLetter, accidentalOffset);
  }

  return {
    atom: {
      kind: "note",
      pitchMidi: pitchCharToMidi(pitchChar) + octaveDelta + resolvedAccidental,
      durationWhole,
      sourceLine: line,
      sourceColumn: column,
      tieToNext,
    },
    nextIndex: noteIndex,
  };
}

function parseChordAtom(
  bodyText: string,
  index: number,
  line: number,
  column: number,
  defaultNoteLength: Rational,
  keyAccidentals: Map<string, number>,
  barAccidentals: Map<string, number>,
  diagnostics: Diagnostic[],
  chordCounter: number,
): { atom: ChordAtom; nextIndex: number } | undefined {
  let cursor = index + 1;
  const pitchesMidi: number[] = [];

  while (cursor < bodyText.length && bodyText[cursor] !== "]") {
    if (/\s/.test(bodyText[cursor])) {
      cursor += 1;
      continue;
    }

    const accidentalStart = cursor;
    let accidentalOffset: number | undefined;

    if (bodyText[cursor] === "^" || bodyText[cursor] === "_" || bodyText[cursor] === "=") {
      const accidentalSymbol = bodyText[cursor];
      let accidentalCount = 0;

      while (bodyText[cursor] === accidentalSymbol) {
        accidentalCount += 1;
        cursor += 1;
      }

      accidentalOffset = accidentalSymbol === "=" ? 0 : accidentalSymbol === "^" ? accidentalCount : -accidentalCount;
    }

    const pitchChar = bodyText[cursor];

    if (!pitchChar || !/[A-Ga-g]/.test(pitchChar)) {
      diagnostics.push(blockingDiagnostic(
        "internal-invalid-chord-note",
        "Internal engine only supports note letters, accidentals, and octave markers inside block chords.",
        line,
        column + (accidentalStart - index),
      ));
      return undefined;
    }

    cursor += 1;
    let octaveDelta = 0;

    while (bodyText[cursor] === "'" || bodyText[cursor] === ",") {
      octaveDelta += bodyText[cursor] === "'" ? 12 : -12;
      cursor += 1;
    }

    if (/[0-9/]/.test(bodyText[cursor] ?? "")) {
      diagnostics.push(blockingDiagnostic(
        "internal-unsupported-mixed-duration-chord",
        "Internal engine does not support inner chord notes with their own duration modifiers.",
        line,
        column + (cursor - index),
      ));
      return undefined;
    }

    const noteLetter = pitchChar.toUpperCase();
    const resolvedAccidental = accidentalOffset
      ?? barAccidentals.get(noteLetter)
      ?? keyAccidentals.get(noteLetter)
      ?? 0;

    if (accidentalOffset !== undefined) {
      barAccidentals.set(noteLetter, accidentalOffset);
    }

    pitchesMidi.push(pitchCharToMidi(pitchChar) + octaveDelta + resolvedAccidental);
  }

  if (cursor >= bodyText.length || bodyText[cursor] !== "]") {
    diagnostics.push(blockingDiagnostic(
      "internal-unterminated-chord",
      "Internal engine found a block chord without a closing `]`.",
      line,
      column,
    ));
    return undefined;
  }

  if (pitchesMidi.length === 0) {
    diagnostics.push(blockingDiagnostic(
      "internal-empty-chord",
      "Internal engine found an empty block chord.",
      line,
      column,
    ));
    return undefined;
  }

  cursor += 1;
  const lengthStart = cursor;
  while (/[0-9/]/.test(bodyText[cursor] ?? "")) {
    cursor += 1;
  }

  const rawLength = bodyText.slice(lengthStart, cursor);
  const durationMultiplier = parseLengthMultiplier(rawLength, line, column, diagnostics);

  if (!durationMultiplier) {
    return undefined;
  }

  if (bodyText[cursor] === "-") {
    diagnostics.push(blockingDiagnostic(
      "internal-unsupported-chord-tie",
      "Internal engine does not support ties into or out of block chords.",
      line,
      column,
    ));
    return undefined;
  }

  return {
    atom: {
      kind: "chord",
      pitchesMidi,
      durationWhole: multiplyRational(defaultNoteLength, durationMultiplier),
      sourceLine: line,
      sourceColumn: column,
      chordId: `chord-${chordCounter}`,
    },
    nextIndex: cursor,
  };
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

  diagnostics.push(blockingDiagnostic(
    "internal-invalid-note-length",
    `Internal engine could not parse the note length token \`${rawLength}\`.`,
    line,
    column,
  ));
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

function collectMarkerIndices(items: BodyItem[], kind: BodyMarkerKind): number[] {
  const indices: number[] = [];

  for (const [index, item] of items.entries()) {
    if (!isAtom(item) && item.kind === kind) {
      indices.push(index);
    }
  }

  return indices;
}

function extractAtoms(items: BodyItem[]): BodyAtom[] {
  return items.filter(isAtom);
}

function isAtom(item: BodyItem): item is BodyAtom {
  return item.kind === "note" || item.kind === "rest" || item.kind === "chord";
}

function indexToLineColumn(
  text: string,
  index: number,
  bodyStartLine: number,
): { line: number; column: number } {
  const before = text.slice(0, index);
  const lineBreaks = before.split("\n");

  return {
    line: bodyStartLine + lineBreaks.length - 1,
    column: lineBreaks[lineBreaks.length - 1].length + 1,
  };
}

function blockingDiagnostic(
  code: string,
  message: string,
  line?: number,
  column?: number,
): Diagnostic {
  return {
    code,
    severity: "error",
    message,
    line,
    column,
    blocked: true,
  };
}
