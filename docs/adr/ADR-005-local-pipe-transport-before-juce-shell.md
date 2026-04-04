# ADR-005: Add a local pipe transport before any JUCE shell

## Status

Accepted

## Context

ADR-004 introduced:

- a reusable service layer in `@llm-midi/engine-service`
- a versioned request/response contract in `@llm-midi/worker-protocol`
- a long-running local stdio worker

That was enough to validate the process boundary, but stdio alone is not the final integration shape for a future native shell.

A JUCE-hosted process will need to:

- launch the worker
- read a single readiness signal
- connect through a local IPC endpoint
- exchange newline-delimited JSON without relying on ongoing stdin/stdout request traffic

## Decision

Add a second worker transport mode:

- `stdio` remains unchanged
- `pipe` is added as a local IPC transport using a named-pipe style endpoint on Windows

This slice also introduces `@llm-midi/worker-transport`, which owns:

- local endpoint/path helpers
- NDJSON framing helpers
- Windows-first pipe-path handling

The request/response protocol itself remains in `@llm-midi/worker-protocol`.

In pipe mode:

- the worker emits one machine-readable `ready` event on stdout
- the event advertises the local endpoint path
- request/response traffic then moves to the pipe connection

## Why stdio alone is not enough

Stdio is useful for development and tests, but it is awkward as the long-term boundary for a future native shell because:

- request and response traffic share the process stdio channels
- the host must keep stdin/stdout plumbing active for the worker lifetime
- native-process launch code usually prefers a clear "launch -> ready -> connect" model

Pipe mode is a better fit for that future shape while staying fully local and simple.

## Why add pipe transport now

Adding the transport now lets the repo stabilize:

- the ready handshake
- local endpoint generation rules
- NDJSON framing over a socket-like stream
- shutdown and disconnect semantics

before any JUCE code is written.

That keeps later native-shell work focused on host integration instead of protocol redesign.

## Why the service layer remains the source of truth

Both stdio mode and pipe mode delegate to the same service layer:

- validation
- inspect
- convert
- deterministic export planning
- `abc2midi` fallback handling

This prevents transport-specific divergence and keeps business logic out of the worker transport layer.

## Why the CLI stays direct by default

The CLI is still the primary user-facing tool in this phase. Keeping it direct preserves:

- current user workflows
- current deterministic export naming
- current default engine behavior
- simpler command-line debugging

The worker transports exist to prepare for future embedding, not to replace the CLI.

## Why transport stays local-only

This transport intentionally does **not** become:

- HTTP
- WebSocket
- gRPC
- a background daemon
- a multi-client service

The requirement is only a local child-process boundary for one future plugin instance at a time.

## Chosen disconnect behavior

For this slice, pipe mode accepts a single client connection. If that client disconnects unexpectedly, the worker exits cleanly.

This keeps lifecycle semantics simple:

- one worker process
- one client
- one connection
- one shutdown or disconnect path

## Consequences

- the repo now supports both stdio and local pipe worker modes
- Windows named-pipe style IPC is a first-class path
- tests cover both transports without requiring a real `abc2midi` installation
- the repo is better prepared for a future JUCE shell without adding JUCE yet
