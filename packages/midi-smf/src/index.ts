import {
  type CanonicalScore,
  rationalToNumber,
  type Rational,
} from "@llm-midi/score-model";

export const DEFAULT_PPQ = 480;
const WHOLE_NOTE_TICKS = DEFAULT_PPQ * 4;

type TimedEvent = {
  tick: number;
  order: number;
  data: number[];
};

export function writeCanonicalScoreToMidiBuffer(
  score: CanonicalScore,
  ppq: number = DEFAULT_PPQ,
): Buffer {
  const events: TimedEvent[] = [];

  for (const tempoEvent of score.tempo) {
    events.push({
      tick: rationalToTicks(tempoEvent.atWhole, ppq),
      order: 0,
      data: buildTempoMetaEvent(tempoEvent.bpm, tempoEvent.beatUnitDen),
    });
  }

  if (score.timeSignature) {
    events.push({
      tick: rationalToTicks(score.timeSignature.atWhole, ppq),
      order: 1,
      data: buildTimeSignatureMetaEvent(
        score.timeSignature.numerator,
        score.timeSignature.denominator,
      ),
    });
  }

  for (const note of score.notes) {
    const startTick = rationalToTicks(note.startWhole, ppq);
    const endTick = rationalToTicks(
      {
        num: note.startWhole.num * note.durationWhole.den + note.durationWhole.num * note.startWhole.den,
        den: note.startWhole.den * note.durationWhole.den,
      },
      ppq,
    );

    events.push({
      tick: startTick,
      order: 3,
      data: [0x90, note.pitchMidi, note.velocity],
    });
    events.push({
      tick: endTick,
      order: 2,
      data: [0x80, note.pitchMidi, 0x00],
    });
  }

  events.sort((left, right) => {
    if (left.tick !== right.tick) {
      return left.tick - right.tick;
    }

    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.data[1] - right.data[1];
  });

  const trackBytes: number[] = [];
  let lastTick = 0;

  for (const event of events) {
    const delta = event.tick - lastTick;
    trackBytes.push(...encodeVariableLength(delta), ...event.data);
    lastTick = event.tick;
  }

  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  const trackBuffer = Buffer.from(trackBytes);
  const header = Buffer.from([
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x00,
    0x00, 0x01,
    (ppq >> 8) & 0xff,
    ppq & 0xff,
  ]);
  const trackChunkHeader = Buffer.from([
    0x4d, 0x54, 0x72, 0x6b,
    (trackBuffer.length >>> 24) & 0xff,
    (trackBuffer.length >>> 16) & 0xff,
    (trackBuffer.length >>> 8) & 0xff,
    trackBuffer.length & 0xff,
  ]);

  return Buffer.concat([header, trackChunkHeader, trackBuffer]);
}

export function rationalToTicks(value: Rational, ppq: number = DEFAULT_PPQ): number {
  const ticks = rationalToNumber(value) * (ppq / DEFAULT_PPQ) * WHOLE_NOTE_TICKS;
  return Math.round(ticks);
}

function buildTempoMetaEvent(bpm: number, beatUnitDen: number): number[] {
  const quarterNotesPerMinute = bpm * (4 / beatUnitDen);
  const microsecondsPerQuarter = Math.max(1, Math.round(60_000_000 / quarterNotesPerMinute));

  return [
    0xff,
    0x51,
    0x03,
    (microsecondsPerQuarter >>> 16) & 0xff,
    (microsecondsPerQuarter >>> 8) & 0xff,
    microsecondsPerQuarter & 0xff,
  ];
}

function buildTimeSignatureMetaEvent(numerator: number, denominator: number): number[] {
  const denominatorPower = Math.round(Math.log2(denominator));

  return [
    0xff,
    0x58,
    0x04,
    numerator & 0xff,
    denominatorPower & 0xff,
    0x18,
    0x08,
  ];
}

function encodeVariableLength(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];

  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if ((buffer & 0x80) !== 0) {
      buffer >>= 8;
      continue;
    }
    break;
  }

  return bytes;
}
