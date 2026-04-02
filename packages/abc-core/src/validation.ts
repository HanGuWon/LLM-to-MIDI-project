import type { Classification, Diagnostic, ValidateResult } from "./types.js";

type ExtractionResult = {
  content: string;
  usedFence: boolean;
  strippedLeading: boolean;
  strippedTrailing: boolean;
};

type HeaderMap = Map<string, string>;

const HEADER_RE = /^([A-Za-z]):\s*(.*)$/;
const FENCE_RE = /```(?:abc)?\s*([\s\S]*?)```/i;
const INLINE_BODY_FIELD_RE = /\[(K|M|Q):/;
const MICROTONE_RE = /(?:\^|_){1,2}(?:\d+\/\d+|\/\d+|\d+\/|\/)[A-Ga-g]/;

export function validateAbc(abcText: string): ValidateResult {
  const diagnostics: Diagnostic[] = [];
  const unsupportedConstructs = new Set<string>();
  const normalizedInput = normalizeLineEndings(abcText);
  const extraction = extractLikelyAbcBlock(normalizedInput);

  if (extraction.usedFence) {
    diagnostics.push(
      infoDiagnostic(
        "markdown-fence-stripped",
        "Extracted ABC from a fenced code block.",
        "Removed surrounding Markdown fences.",
      ),
    );
  }

  if (extraction.strippedLeading) {
    diagnostics.push(
      infoDiagnostic(
        "leading-prose-stripped",
        "Removed text before the first ABC-looking block.",
        "Kept only the first ABC block.",
      ),
    );
  }

  if (extraction.strippedTrailing) {
    diagnostics.push(
      infoDiagnostic(
        "trailing-prose-stripped",
        "Removed text after the first ABC-looking block.",
        "Kept only the first ABC block.",
      ),
    );
  }

  const cleaned = extraction.content
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();

  if (!cleaned) {
    diagnostics.push(
      errorDiagnostic(
        "no-abc-content",
        "No ABC content was found in the provided input.",
      ),
    );

    return {
      ok: false,
      classification: "fragment",
      normalizedAbc: "",
      unsupportedConstructs: [],
      diagnostics,
    };
  }

  const lines = cleaned.split("\n");
  const xLines = findHeaderLines(lines, "X");

  if (xLines.length > 1) {
    unsupportedConstructs.add("multiple tunes");
    diagnostics.push(
      errorDiagnostic(
        "multiple-tunes",
        "Phase 0 only supports the first tune. Multiple `X:` sections were detected.",
        xLines[1],
        1,
      ),
    );
  }

  const headerInfo = parseLeadingHeaders(lines);
  const classification: Classification = headerInfo.headerLines.length > 0 ? "tune" : "fragment";
  const bodyStartIndex = classification === "tune" ? headerInfo.bodyStartIndex : 0;
  const bodyLines = trimOuterBlankLines(lines.slice(bodyStartIndex));
  const bodyText = bodyLines.join("\n");

  if (classification === "tune" && !headerInfo.headers.has("K")) {
    diagnostics.push(
      errorDiagnostic(
        "missing-key-header",
        "Tune-style input is missing the required `K:` header.",
      ),
    );
  }

  if (!bodyText.trim()) {
    diagnostics.push(
      errorDiagnostic(
        "missing-body",
        "ABC input does not contain any music body to validate or convert.",
      ),
    );
  }

  diagnostics.push(
    ...scanForUnsupportedConstructs(
      lines,
      bodyStartIndex,
      unsupportedConstructs,
    ),
  );
  diagnostics.push(...scanChordBrackets(bodyText, bodyStartIndex));
  diagnostics.push(...scanTiePlacement(bodyText, bodyStartIndex));

  const normalizedAbc = buildNormalizedAbc(
    classification,
    headerInfo.headers,
    bodyText,
    diagnostics,
  );

  const ok = diagnostics.every((diagnostic) => !diagnostic.blocked);

  return {
    ok,
    classification,
    normalizedAbc,
    unsupportedConstructs: [...unsupportedConstructs],
    diagnostics,
  };
}

export function getNormalizedTitle(normalizedAbc: string): string {
  for (const line of normalizedAbc.split("\n")) {
    const match = HEADER_RE.exec(line.trim());

    if (match?.[1] === "T") {
      return match[2].trim() || "Imported Fragment";
    }
  }

  return "Imported Fragment";
}

function buildNormalizedAbc(
  classification: Classification,
  headers: HeaderMap,
  bodyText: string,
  diagnostics: Diagnostic[],
): string {
  const normalizedHeaderLines: string[] = [];

  if (classification === "fragment") {
    normalizedHeaderLines.push("X:1", "T:Imported Fragment");
    diagnostics.push(
      infoDiagnostic(
        "fragment-wrapper-added",
        "Wrapped the pasted fragment in synthetic `X:` and `T:` headers.",
        "Inserted `X:1` and `T:Imported Fragment`.",
      ),
    );
  } else {
    const x = headers.get("X");
    const t = headers.get("T");

    if (x) {
      normalizedHeaderLines.push(`X:${x}`);
    }

    if (t) {
      normalizedHeaderLines.push(`T:${t}`);
    }
  }

  const meter = headers.get("M");

  if (meter) {
    normalizedHeaderLines.push(`M:${meter}`);
  }

  const noteLength = headers.get("L") ?? inferDefaultNoteLength(meter);

  if (!headers.has("L")) {
    diagnostics.push(
      infoDiagnostic(
        "default-note-length-applied",
        `Inserted a default note length of \`L:${noteLength}\`.`,
        `Inserted \`L:${noteLength}\`.`,
      ),
    );
  }

  normalizedHeaderLines.push(`L:${noteLength}`);

  const tempo = headers.get("Q") ?? "1/4=120";

  if (!headers.has("Q")) {
    diagnostics.push(
      infoDiagnostic(
        "default-tempo-applied",
        "Inserted the default tempo `Q:1/4=120`.",
        "Inserted `Q:1/4=120`.",
      ),
    );
  }

  normalizedHeaderLines.push(`Q:${tempo}`);

  if (classification === "fragment") {
    normalizedHeaderLines.push("K:none");
    diagnostics.push(
      infoDiagnostic(
        "fragment-key-applied",
        "Inserted `K:none` for fragment mode.",
        "Inserted `K:none`.",
      ),
    );
  } else {
    const key = headers.get("K");

    if (key) {
      normalizedHeaderLines.push(`K:${key}`);
    }
  }

  return [...normalizedHeaderLines, bodyText].filter(Boolean).join("\n");
}

function parseLeadingHeaders(lines: string[]): {
  headerLines: string[];
  headers: HeaderMap;
  bodyStartIndex: number;
} {
  const headerLines: string[] = [];
  const headers = new Map<string, string>();
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const match = HEADER_RE.exec(trimmed);

    if (!match) {
      break;
    }

    headerLines.push(trimmed);
    headers.set(match[1], match[2].trim());
    index += 1;

    if (match[1] === "K") {
      break;
    }
  }

  return {
    headerLines,
    headers,
    bodyStartIndex: index,
  };
}

function scanForUnsupportedConstructs(
  lines: string[],
  bodyStartIndex: number,
  unsupportedConstructs: Set<string>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (/^%%MIDI\b/i.test(trimmed)) {
      unsupportedConstructs.add("abc2midi MIDI directives");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-midi-directive",
          "Phase 0 does not support `%%MIDI` directives.",
          index + 1,
          1,
        ),
      );
    }

    if (/^V:/.test(trimmed)) {
      unsupportedConstructs.add("multiple voices");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-voices",
          "Phase 0 does not support `V:` multiple-voice structures.",
          index + 1,
          1,
        ),
      );
    }

    if (/^P:/.test(trimmed)) {
      unsupportedConstructs.add("parts");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-parts",
          "Phase 0 does not support `P:` multipart structures.",
          index + 1,
          1,
        ),
      );
    }

    if (/^[wW]:/.test(trimmed)) {
      unsupportedConstructs.add("lyrics");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-lyrics",
          "Phase 0 does not support `w:` or `W:` lyric alignment fields.",
          index + 1,
          1,
        ),
      );
    }

    if (index >= bodyStartIndex && /^[KMQ]:/.test(trimmed)) {
      unsupportedConstructs.add("body header changes");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-body-header-change",
          "Phase 0 does not support body-level `K:`, `M:`, or `Q:` changes.",
          index + 1,
          1,
        ),
      );
    }

    if (index >= bodyStartIndex && INLINE_BODY_FIELD_RE.test(line)) {
      unsupportedConstructs.add("inline body field changes");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-inline-field",
          "Phase 0 does not support inline `[K:]`, `[M:]`, or `[Q:]` body fields.",
          index + 1,
          line.indexOf("[") + 1,
        ),
      );
    }

    if (index >= bodyStartIndex && line.includes("&")) {
      unsupportedConstructs.add("voice overlays");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-voice-overlay",
          "Phase 0 does not support voice overlays using `&`.",
          index + 1,
          line.indexOf("&") + 1,
        ),
      );
    }

    if (index >= bodyStartIndex && MICROTONE_RE.test(line)) {
      unsupportedConstructs.add("microtones");
      diagnostics.push(
        errorDiagnostic(
          "unsupported-microtones",
          "Phase 0 does not support microtonal accidentals.",
          index + 1,
          line.search(MICROTONE_RE) + 1,
        ),
      );
    }
  }

  return diagnostics;
}

function scanChordBrackets(bodyText: string, bodyStartIndex: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const openBrackets: number[] = [];

  for (let index = 0; index < bodyText.length; index += 1) {
    const char = bodyText[index];

    if (char === "[") {
      const next = bodyText[index + 1] ?? "";
      const afterNext = bodyText.slice(index + 1, index + 4);

      if (/\d/.test(next) || /^(K|M|Q):/.test(afterNext)) {
        continue;
      }

      openBrackets.push(index);
    }

    if (char === "]") {
      if (openBrackets.length === 0) {
        const position = indexToLineColumn(bodyText, index, bodyStartIndex);
        diagnostics.push(
          errorDiagnostic(
            "unmatched-closing-bracket",
            "Found `]` without a matching opening chord bracket.",
            position.line,
            position.column,
          ),
        );
        continue;
      }

      openBrackets.pop();
    }
  }

  for (const openIndex of openBrackets) {
    const position = indexToLineColumn(bodyText, openIndex, bodyStartIndex);
    diagnostics.push(
      errorDiagnostic(
        "unmatched-opening-bracket",
        "Found `[` without a matching closing chord bracket.",
        position.line,
        position.column,
      ),
    );
  }

  return diagnostics;
}

function scanTiePlacement(bodyText: string, bodyStartIndex: number): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (let index = 0; index < bodyText.length; index += 1) {
    if (bodyText[index] !== "-") {
      continue;
    }

    const previous = previousNonWhitespace(bodyText, index);
    const next = nextNonWhitespace(bodyText, index);

    if (!previous || !next) {
      const position = indexToLineColumn(bodyText, index, bodyStartIndex);
      diagnostics.push(
        errorDiagnostic(
          "illegal-tie-placement",
          "Tie markers must connect one note or chord to the next note or chord.",
          position.line,
          position.column,
        ),
      );
      continue;
    }

    const validPrevious = /[A-Ga-g0-9,/'\]]/.test(previous);
    const validNext = /[=_^A-Ga-g\[]/.test(next);

    if (!validPrevious || !validNext) {
      const position = indexToLineColumn(bodyText, index, bodyStartIndex);
      diagnostics.push(
        errorDiagnostic(
          "illegal-tie-placement",
          "Tie markers must connect one note or chord to the next note or chord.",
          position.line,
          position.column,
        ),
      );
    }
  }

  return diagnostics;
}

function previousNonWhitespace(text: string, startIndex: number): string | undefined {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (!/\s/.test(text[index])) {
      return text[index];
    }
  }

  return undefined;
}

function nextNonWhitespace(text: string, startIndex: number): string | undefined {
  for (let index = startIndex + 1; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      return text[index];
    }
  }

  return undefined;
}

function findHeaderLines(lines: string[], headerCode: string): number[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith(`${headerCode}:`))
    .map(({ index }) => index + 1);
}

function trimOuterBlankLines(lines: string[]): string[] {
  const copy = [...lines];

  while (copy[0] !== undefined && copy[0].trim() === "") {
    copy.shift();
  }

  while (copy[copy.length - 1] !== undefined && copy[copy.length - 1].trim() === "") {
    copy.pop();
  }

  return copy;
}

function inferDefaultNoteLength(meter: string | undefined): string {
  if (!meter || /^none$/i.test(meter)) {
    return "1/8";
  }

  if (meter === "C" || meter === "C|") {
    return "1/8";
  }

  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(meter);

  if (!match) {
    return "1/8";
  }

  const ratio = Number(match[1]) / Number(match[2]);
  return ratio < 0.75 ? "1/16" : "1/8";
}

function extractLikelyAbcBlock(input: string): ExtractionResult {
  const fencedMatch = FENCE_RE.exec(input);

  if (fencedMatch) {
    const start = fencedMatch.index;
    const end = start + fencedMatch[0].length;

    return {
      content: fencedMatch[1],
      usedFence: true,
      strippedLeading: input.slice(0, start).trim().length > 0,
      strippedTrailing: input.slice(end).trim().length > 0,
    };
  }

  const lines = input.split("\n");
  const firstIndex = lines.findIndex((line) => looksLikeAbcLine(line));

  if (firstIndex === -1) {
    return {
      content: input,
      usedFence: false,
      strippedLeading: false,
      strippedTrailing: false,
    };
  }

  let endIndex = firstIndex;

  while (endIndex < lines.length) {
    const line = lines[endIndex];

    if (line.trim() === "" || looksLikeAbcLine(line)) {
      endIndex += 1;
      continue;
    }

    break;
  }

  return {
    content: lines.slice(firstIndex, endIndex).join("\n"),
    usedFence: false,
    strippedLeading: lines.slice(0, firstIndex).some((line) => line.trim().length > 0),
    strippedTrailing: lines.slice(endIndex).some((line) => line.trim().length > 0),
  };
}

function looksLikeAbcLine(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  if (HEADER_RE.test(trimmed) || /^%%/.test(trimmed)) {
    return true;
  }

  const strippedChordSymbols = trimmed.replace(/"[^"\n]*"/g, "");

  if (!/[A-Ga-gzZ|[\]()]/.test(strippedChordSymbols)) {
    return false;
  }

  return /^[A-Ga-gzZ|:[\]()<>_\^=,'\/0-9\-\s.+]*$/.test(strippedChordSymbols);
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

function indexToLineColumn(
  text: string,
  index: number,
  lineOffset: number,
): { line: number; column: number } {
  const before = text.slice(0, index);
  const lineBreaks = before.split("\n");

  return {
    line: lineOffset + lineBreaks.length,
    column: lineBreaks[lineBreaks.length - 1].length + 1,
  };
}

function infoDiagnostic(code: string, message: string, appliedFix?: string): Diagnostic {
  return {
    code,
    severity: "info",
    message,
    blocked: false,
    appliedFix,
  };
}

function errorDiagnostic(
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
