import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type WorkerResponse } from "@llm-midi/worker-protocol";

import { spawnWorkerClient, type WorkerClient } from "../helpers/workerClient.js";

const conversionDir = path.resolve(process.cwd(), "tests/fixtures/conversion");
const validationDir = path.resolve(process.cwd(), "tests/fixtures/validation");
const fakeToolPath = path.resolve(process.cwd(), "tests/helpers/fake-abc2midi.mjs");

async function loadFixture(directory: string, name: string): Promise<string> {
  return readFile(path.join(directory, name), "utf8");
}

const workers: WorkerClient[] = [];

afterEach(async () => {
  while (workers.length > 0) {
    const worker = workers.pop();
    if (!worker) {
      continue;
    }

    try {
      await worker.shutdown();
      await worker.waitForExit();
    } catch {
      worker.kill();
    }
  }
});

function createPipeWorker(): WorkerClient {
  const worker = spawnWorkerClient({ transport: "pipe" });
  workers.push(worker);
  return worker;
}

describe("worker pipe integration", () => {
  it("emits a ready line in pipe mode", async () => {
    const worker = createPipeWorker();
    const ready = await worker.waitForReady();

    expect(ready.kind).toBe("ready");
    expect(ready.transport).toBe("pipe");
    expect(ready.endpoint.type).toBe("pipe");
    expect(ready.endpoint.path.length).toBeGreaterThan(0);
  });

  it("responds to ping over pipe", async () => {
    const worker = createPipeWorker();
    const response = await worker.send({
      id: "pipe-ping-1",
      protocolVersion: PROTOCOL_VERSION,
      kind: "ping",
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.status).toBe("ok");
    }
  });

  it("validates and inspects over pipe", async () => {
    const worker = createPipeWorker();
    const validateFixture = await loadFixture(validationDir, "clean-tune.abc");
    const inspectFixture = await loadFixture(conversionDir, "repeats-endings.abc");

    const validateResponse = await worker.send({
      id: "pipe-validate-1",
      protocolVersion: PROTOCOL_VERSION,
      kind: "validate",
      abcText: validateFixture,
    });
    const inspectResponse = await worker.send({
      id: "pipe-inspect-1",
      protocolVersion: PROTOCOL_VERSION,
      kind: "inspect",
      abcText: inspectFixture,
    });

    expect(validateResponse.ok).toBe(true);
    expect(inspectResponse.ok).toBe(true);
    if (validateResponse.ok && inspectResponse.ok) {
      expect(validateResponse.result.ok).toBe(true);
      expect(inspectResponse.result.ok).toBe(true);
      expect(inspectResponse.result.score?.notes.length).toBeGreaterThan(0);
    }
  });

  it("returns MIDI base64 for internal conversion over pipe", async () => {
    const worker = createPipeWorker();
    const fixture = await loadFixture(conversionDir, "block-chords.abc");
    const response = await worker.send({
      id: "pipe-convert-internal",
      protocolVersion: PROTOCOL_VERSION,
      kind: "convert",
      abcText: fixture,
      engine: "internal",
      includeMidiBase64: true,
      includeCanonicalScore: true,
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.ok).toBe(true);
      expect(response.result.engineUsed).toBe("internal");
      expect(response.result.midiBase64).toBeDefined();
      expect(response.result.canonicalScore?.notes.length).toBeGreaterThan(0);
    }
  });

  it("falls back cleanly in auto mode over pipe", async () => {
    const worker = createPipeWorker();
    const fixture = await loadFixture(conversionDir, "nested-repeats.abc");
    const response = await worker.send({
      id: "pipe-convert-auto",
      protocolVersion: PROTOCOL_VERSION,
      kind: "convert",
      abcText: fixture,
      engine: "auto",
      abc2midiPath: fakeToolPath,
      includeMidiBase64: true,
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.result.ok).toBe(true);
      expect(response.result.engineUsed).toBe("abc2midi");
      expect(response.result.fallback?.attempted).toBe("internal");
      expect(response.result.midiBase64).toBeDefined();
    }
  });

  it("does not crash on malformed JSON over pipe", async () => {
    const worker = createPipeWorker();
    const malformedResponse = await worker.sendRawLine("{");
    const followupFixture = await loadFixture(conversionDir, "melody.abc");
    const followupResponse = await worker.send({
      id: "pipe-followup",
      protocolVersion: PROTOCOL_VERSION,
      kind: "inspect",
      abcText: followupFixture,
    });

    expect("ok" in malformedResponse && malformedResponse.ok).toBe(false);
    if ("ok" in malformedResponse && !malformedResponse.ok) {
      expect(malformedResponse.error.code).toBe("invalid-json");
    }

    expect(followupResponse.ok).toBe(true);
  });

  it("handles multiple sequential requests over one pipe connection and shuts down cleanly", async () => {
    const worker = createPipeWorker();
    const fixture = await loadFixture(conversionDir, "tuplets.abc");
    const responses: WorkerResponse[] = [];

    responses.push(await worker.send({
      id: "pipe-seq-validate",
      protocolVersion: PROTOCOL_VERSION,
      kind: "validate",
      abcText: fixture,
    }));
    responses.push(await worker.send({
      id: "pipe-seq-inspect",
      protocolVersion: PROTOCOL_VERSION,
      kind: "inspect",
      abcText: fixture,
    }));
    responses.push(await worker.send({
      id: "pipe-seq-convert",
      protocolVersion: PROTOCOL_VERSION,
      kind: "convert",
      abcText: fixture,
      engine: "internal",
      includeMidiBase64: true,
    }));

    for (const response of responses) {
      expect(response.ok).toBe(true);
    }

    const shutdownResponse = await worker.shutdown();
    const exitCode = await worker.waitForExit();

    expect(shutdownResponse.ok).toBe(true);
    if (shutdownResponse.ok) {
      expect(shutdownResponse.result.status).toBe("shutting-down");
    }
    expect(exitCode).toBe(0);
  });
});
