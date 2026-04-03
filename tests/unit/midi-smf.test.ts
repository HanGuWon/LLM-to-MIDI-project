import { describe, expect, it } from "vitest";

import { writeCanonicalScoreToMidiBuffer } from "@llm-midi/midi-smf";
import {
  createRational,
  type CanonicalScore,
} from "@llm-midi/score-model";

describe("midi-smf writer", () => {
  it("writes a deterministic format-0 SMF with tempo and note events", () => {
    const score: CanonicalScore = {
      title: "Test",
      normalizedAbc: "X:1\nT:Test\nL:1/8\nQ:1/4=120\nK:none\nC D |",
      classification: "fragment",
      tempo: [{ atWhole: createRational(0, 1), bpm: 120, beatUnitDen: 4 }],
      timeSignature: { atWhole: createRational(0, 1), numerator: 4, denominator: 4 },
      notes: [
        {
          id: "note-1",
          pitchMidi: 60,
          startWhole: createRational(0, 1),
          durationWhole: createRational(1, 8),
          velocity: 100,
          voiceId: "1",
        },
        {
          id: "note-2",
          pitchMidi: 62,
          startWhole: createRational(1, 8),
          durationWhole: createRational(1, 8),
          velocity: 100,
          voiceId: "1",
        },
      ],
      diagnostics: [],
    };

    const buffer = writeCanonicalScoreToMidiBuffer(score);

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("MThd");
    expect(buffer.subarray(14, 18).toString("ascii")).toBe("MTrk");
    expect(buffer.includes(Buffer.from([0xff, 0x51, 0x03]))).toBe(true);
    expect(buffer.includes(Buffer.from([0xff, 0x58, 0x04]))).toBe(true);
    expect(buffer.includes(Buffer.from([0x90, 60, 100]))).toBe(true);
    expect(buffer.includes(Buffer.from([0x80, 60, 0x00]))).toBe(true);
    expect(buffer.at(-3)).toBe(0xff);
    expect(buffer.at(-2)).toBe(0x2f);
    expect(buffer.at(-1)).toBe(0x00);
  });
});
