import {
  parseNormalizedAbcToCanonicalScore,
  validateAbc,
  type ValidateResult,
} from "@llm-midi/abc-core";
import { writeCanonicalScoreToMidiBuffer } from "@llm-midi/midi-smf";

import { runAbc2Midi } from "./abc2midi.js";
import { buildDeterministicExportPlan } from "./exportPlan.js";
import type {
  ConvertAbcTextOptions,
  ConvertAbcTextResult,
  InspectAbcTextResult,
  ValidateAbcTextResult,
} from "./types.js";

export function validateAbcText(abcText: string): ValidateAbcTextResult {
  return validateAbc(abcText);
}

export function inspectAbcText(abcText: string): InspectAbcTextResult {
  const validation = validateAbcText(abcText);

  if (!validation.ok) {
    return {
      ok: false,
      classification: validation.classification,
      normalizedAbc: validation.normalizedAbc,
      diagnostics: validation.diagnostics,
    };
  }

  const internal = parseNormalizedAbcToCanonicalScore(
    validation.normalizedAbc,
    validation.classification,
    validation.diagnostics,
  );

  return {
    ok: internal.ok,
    classification: validation.classification,
    normalizedAbc: validation.normalizedAbc,
    diagnostics: internal.diagnostics,
    score: internal.score,
  };
}

export async function convertAbcText(
  abcText: string,
  options: ConvertAbcTextOptions = {},
): Promise<ConvertAbcTextResult> {
  const validation = validateAbcText(abcText);
  const engine = options.engine ?? "abc2midi";

  if (!validation.ok) {
    return {
      ok: false,
      classification: validation.classification,
      normalizedAbc: validation.normalizedAbc,
      diagnostics: validation.diagnostics,
      toolStdout: "",
      toolStderr: "",
      engineUsed: engine === "auto" ? undefined : engine,
    };
  }

  if (engine === "internal") {
    return convertInternally(validation, options.includeCanonicalScore ?? false);
  }

  if (engine === "auto") {
    const internal = await convertInternally(validation, options.includeCanonicalScore ?? false);

    if (internal.ok) {
      return internal;
    }

    const fallback = await convertWithAbc2Midi(validation, options);
    return {
      ...fallback,
      fallback: {
        attempted: "internal",
        reason: "unsupported",
        diagnostics: internal.diagnostics.filter((diagnostic) => diagnostic.blocked),
      },
    };
  }

  return convertWithAbc2Midi(validation, options);
}

async function convertWithAbc2Midi(
  validation: ValidateResult,
  options: ConvertAbcTextOptions,
): Promise<ConvertAbcTextResult> {
  const toolPath = options.abc2midiPath ?? options.env?.ABC2MIDI_PATH ?? "abc2midi";
  const toolRun = await runAbc2Midi(validation.normalizedAbc, toolPath);
  const diagnostics = [...validation.diagnostics, ...toolRun.diagnostics];

  if (!toolRun.ok || !toolRun.midiBuffer) {
    return {
      ok: false,
      classification: validation.classification,
      normalizedAbc: validation.normalizedAbc,
      diagnostics,
      toolStdout: toolRun.stdout,
      toolStderr: toolRun.stderr,
      engineUsed: "abc2midi",
    };
  }

  return {
    ok: true,
    classification: validation.classification,
    normalizedAbc: validation.normalizedAbc,
    diagnostics,
    toolStdout: toolRun.stdout,
    toolStderr: toolRun.stderr,
    engineUsed: "abc2midi",
    exportPlan: buildDeterministicExportPlan(validation.normalizedAbc),
    midiBuffer: toolRun.midiBuffer,
  };
}

async function convertInternally(
  validation: ValidateResult,
  includeCanonicalScore: boolean,
): Promise<ConvertAbcTextResult> {
  const internal = parseNormalizedAbcToCanonicalScore(
    validation.normalizedAbc,
    validation.classification,
    validation.diagnostics,
  );

  if (!internal.ok || !internal.score) {
    return {
      ok: false,
      classification: validation.classification,
      normalizedAbc: validation.normalizedAbc,
      diagnostics: internal.diagnostics,
      toolStdout: "",
      toolStderr: "",
      engineUsed: "internal",
    };
  }

  return {
    ok: true,
    classification: validation.classification,
    normalizedAbc: validation.normalizedAbc,
    diagnostics: internal.score.diagnostics,
    toolStdout: "",
    toolStderr: "",
    engineUsed: "internal",
    exportPlan: buildDeterministicExportPlan(validation.normalizedAbc),
    midiBuffer: writeCanonicalScoreToMidiBuffer(internal.score),
    canonicalScore: includeCanonicalScore ? internal.score : undefined,
  };
}
