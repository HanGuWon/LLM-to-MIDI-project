# ADR-006: Build a JUCE standalone shell before any VST3 target

## Status

Accepted

## Context

ADR-004 and ADR-005 established the local service and worker boundary:

- deterministic `ABC -> canonical score -> MIDI` logic remains in the Node packages
- the CLI stays thin and direct by default
- the long-running worker already supports both `stdio` and `pipe`
- pipe mode already follows the future native embedding shape:
  - launch process
  - read one ready line
  - connect to a local endpoint
  - exchange NDJSON requests and responses

The next question is where to validate the native boundary first.

Going directly to a VST3 target would force several unrelated concerns into the same slice:

- plugin target configuration
- host scanning and loading
- plugin lifecycle constraints
- future audio-thread restrictions
- editor/process separation concerns
- host-specific debugging

That would make it harder to tell whether failures came from the worker boundary or from plugin-host complexity.

## Decision

Add a standalone JUCE desktop app first under `native/juce-shell`.

This app is intentionally:

- optional
- local-only
- Windows-first
- GUI-only
- not part of the default npm pipeline
- not a plugin target

The standalone shell launches the existing Node worker in `pipe` mode, reads the ready line, connects with `juce::NamedPipe`, and reuses the existing newline-delimited JSON worker protocol as-is.

## Why Start With A Standalone Shell

The standalone shell isolates the exact boundary that matters next:

- native process launch
- ready-line handshake
- local IPC connection
- NDJSON request/response handling
- native-side file writing of returned MIDI bytes

without also taking on:

- VST3 packaging
- host scanning
- host UI embedding
- plugin state serialization
- audio-thread constraints enforced by a host

This creates a direct proving ground for the future plugin shell while keeping debugging and iteration simple.

## Why Reuse The Worker/Service Boundary Exactly As-Is

The current worker/service stack already owns:

- validation
- inspect
- convert
- deterministic export metadata
- internal-engine selection
- `abc2midi` fallback behavior

Reusing that boundary exactly avoids duplicating TypeScript business logic in C++ and keeps the native layer client-only.

The JUCE shell should consume:

- the existing worker request kinds
- the existing ready event shape
- the existing convert metadata including `suggestedFileName`

rather than inventing a parallel native-specific contract.

## Why Use `juce::NamedPipe`

ADR-005 already chose a Windows-first local pipe transport for the future native embedding path.

Using `juce::NamedPipe` here keeps the native shell aligned with that decision:

- no extra framing layer
- no new transport abstraction
- no browser or network stack
- no `InterprocessConnection` wrapper over a protocol that is already raw NDJSON

The worker already speaks newline-delimited JSON over a stream. The native client should therefore connect to the same stream directly.

## Why Worker Launch And IPC Stay Off The Future Audio Thread

Even though the standalone shell has no audio thread yet, the boundaries should be future-safe now.

That means:

- no worker launch on the message thread
- no blocking pipe reads on the message thread
- no request handlers that wait forever
- clear restart behavior after crashes or disconnects

These constraints map directly onto the future plugin shell, where process launch, IPC waits, and disconnect recovery must remain outside any real-time path.

## Why VST3 And FL Studio Integration Stay Deferred

Those targets are still deferred because they add independent complexity that is not required to prove the current worker boundary.

Deferred items include:

- VST3 target generation
- `AudioProcessor`
- `AudioProcessorEditor`
- parameter/state wiring
- host automation
- FL Studio specific integration
- live MIDI output
- Burn-to-Piano-Roll workflows

The standalone shell should validate only that the current Node worker/service stack is reusable from native JUCE code in a way that can later be carried into a plugin shell.

## Consequences

- the repo now includes an optional JUCE standalone app
- the Node build/test/typecheck workflows remain JUCE-free by default
- the native shell becomes the first consumer of the pipe-mode worker outside Node tests
- future plugin work can reuse:
  - worker launch rules
  - ready-line parsing
  - named-pipe transport
  - NDJSON protocol handling
  - document/session state boundaries
