import { describe, expect, it } from "vitest";

import { writeCanonicalScoreToMidiBuffer } from "@llm-midi/midi-smf";
import {
  createRational,
  type CanonicalScore,
} from "@llm-midi/score-model";
import { readFormat0Midi } from "../helpers/readMidi.js";

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

  it("round-trips triplet timing, simultaneous chord starts, and repeat-expanded playback order", () => {
    const score: CanonicalScore = {
      title: "Expanded",
      normalizedAbc: "X:1",
      classification: "tune",
      tempo: [{ atWhole: createRational(0, 1), bpm: 120, beatUnitDen: 4 }],
      timeSignature: { atWhole: createRational(0, 1), numerator: 4, denominator: 4 },
      notes: [
        { id: "n1", pitchMidi: 60, startWhole: createRational(0, 1), durationWhole: createRational(1, 12), velocity: 100, voiceId: "1" },
        { id: "n2", pitchMidi: 62, startWhole: createRational(1, 12), durationWhole: createRational(1, 12), velocity: 100, voiceId: "1" },
        { id: "n3", pitchMidi: 64, startWhole: createRational(1, 6), durationWhole: createRational(1, 12), velocity: 100, voiceId: "1" },
        { id: "n4", pitchMidi: 60, startWhole: createRational(1, 4), durationWhole: createRational(1, 4), velocity: 100, voiceId: "1", chordId: "chord-1" },
        { id: "n5", pitchMidi: 64, startWhole: createRational(1, 4), durationWhole: createRational(1, 4), velocity: 100, voiceId: "1", chordId: "chord-1" },
        { id: "n6", pitchMidi: 67, startWhole: createRational(1, 4), durationWhole: createRational(1, 4), velocity: 100, voiceId: "1", chordId: "chord-1" },
        { id: "n7", pitchMidi: 65, startWhole: createRational(1, 2), durationWhole: createRational(1, 8), velocity: 100, voiceId: "1" },
        { id: "n8", pitchMidi: 67, startWhole: createRational(5, 8), durationWhole: createRational(1, 8), velocity: 100, voiceId: "1" },
        { id: "n9", pitchMidi: 69, startWhole: createRational(3, 4), durationWhole: createRational(1, 8), velocity: 100, voiceId: "1" },
        { id: "n10", pitchMidi: 71, startWhole: createRational(7, 8), durationWhole: createRational(1, 8), velocity: 100, voiceId: "1" },
      ],
      diagnostics: [],
    };

    const midi = readFormat0Midi(writeCanonicalScoreToMidiBuffer(score));

    expect(midi.ppq).toBe(480);
    expect(midi.tempoMicrosecondsPerQuarter).toBe(500000);
    expect(midi.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(midi.notes.slice(0, 3).map((note) => note.startTick)).toEqual([0, 160, 320]);
    expect(midi.notes.slice(0, 3).map((note) => note.durationTick)).toEqual([160, 160, 160]);
    expect(midi.notes.slice(3, 6).map((note) => note.startTick)).toEqual([480, 480, 480]);
    expect(midi.notes.slice(3, 6).map((note) => note.pitch)).toEqual([60, 64, 67]);
    expect(midi.notes.slice(6).map((note) => note.pitch)).toEqual([65, 67, 69, 71]);
  });
});
