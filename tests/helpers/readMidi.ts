type ParsedNote = {
  pitch: number;
  startTick: number;
  durationTick: number;
  velocity: number;
};

export type ParsedMidi = {
  ppq: number;
  tempoMicrosecondsPerQuarter?: number;
  timeSignature?: { numerator: number; denominator: number };
  notes: ParsedNote[];
};

export function readFormat0Midi(buffer: Buffer): ParsedMidi {
  if (buffer.subarray(0, 4).toString("ascii") !== "MThd") {
    throw new Error("Missing MThd header.");
  }

  const ppq = buffer.readUInt16BE(12);
  const trackOffset = 14;

  if (buffer.subarray(trackOffset, trackOffset + 4).toString("ascii") !== "MTrk") {
    throw new Error("Missing MTrk chunk.");
  }

  const trackLength = buffer.readUInt32BE(trackOffset + 4);
  const trackStart = trackOffset + 8;
  const trackEnd = trackStart + trackLength;
  const openNotes = new Map<number, Array<{ startTick: number; velocity: number }>>();
  const notes: ParsedNote[] = [];
  let tempoMicrosecondsPerQuarter: number | undefined;
  let timeSignature: ParsedMidi["timeSignature"];
  let absoluteTick = 0;
  let index = trackStart;
  let runningStatus = 0;

  while (index < trackEnd) {
    const delta = readVariableLength(buffer, index);
    absoluteTick += delta.value;
    index = delta.nextIndex;

    let statusByte = buffer[index];
    if (statusByte < 0x80) {
      statusByte = runningStatus;
    } else {
      index += 1;
      runningStatus = statusByte;
    }

    if (statusByte === 0xff) {
      const metaType = buffer[index];
      const metaLength = readVariableLength(buffer, index + 1);
      const dataStart = metaLength.nextIndex;
      const dataEnd = dataStart + metaLength.value;

      if (metaType === 0x51 && metaLength.value === 3) {
        tempoMicrosecondsPerQuarter = buffer.readUIntBE(dataStart, 3);
      }

      if (metaType === 0x58 && metaLength.value >= 2) {
        timeSignature = {
          numerator: buffer[dataStart],
          denominator: 2 ** buffer[dataStart + 1],
        };
      }

      index = dataEnd;
      continue;
    }

    const eventType = statusByte & 0xf0;
    const pitch = buffer[index];
    const velocity = buffer[index + 1];
    index += 2;

    if (eventType === 0x90 && velocity > 0) {
      const stack = openNotes.get(pitch) ?? [];
      stack.push({ startTick: absoluteTick, velocity });
      openNotes.set(pitch, stack);
      continue;
    }

    if (eventType === 0x80 || (eventType === 0x90 && velocity === 0)) {
      const stack = openNotes.get(pitch);

      if (!stack || stack.length === 0) {
        throw new Error(`Unmatched note-off for pitch ${pitch}.`);
      }

      const noteOn = stack.shift();

      if (!noteOn) {
        throw new Error(`Missing note-on data for pitch ${pitch}.`);
      }

      notes.push({
        pitch,
        startTick: noteOn.startTick,
        durationTick: absoluteTick - noteOn.startTick,
        velocity: noteOn.velocity,
      });
    }
  }

  notes.sort((left, right) => {
    if (left.startTick !== right.startTick) {
      return left.startTick - right.startTick;
    }

    if (left.pitch !== right.pitch) {
      return left.pitch - right.pitch;
    }

    return left.durationTick - right.durationTick;
  });

  return {
    ppq,
    tempoMicrosecondsPerQuarter,
    timeSignature,
    notes,
  };
}

function readVariableLength(buffer: Buffer, startIndex: number): { value: number; nextIndex: number } {
  let value = 0;
  let index = startIndex;

  while (index < buffer.length) {
    const byte = buffer[index];
    value = (value << 7) | (byte & 0x7f);
    index += 1;

    if ((byte & 0x80) === 0) {
      return { value, nextIndex: index };
    }
  }

  throw new Error("Unterminated variable-length quantity.");
}
