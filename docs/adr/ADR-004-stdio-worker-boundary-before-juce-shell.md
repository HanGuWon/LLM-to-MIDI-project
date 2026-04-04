# ADR-004: Introduce a stdio worker boundary before any JUCE shell

## Status

Accepted

## Context

Up through ADR-003, the repo had:

- reusable notation and MIDI logic
- a growing internal deterministic engine
- an external `abc2midi` fallback path
- a CLI that still owned most application orchestration

That was sufficient for command-line use, but it was the wrong boundary for the next phase. A future JUCE shell should not need to reimplement:

- validation and normalization orchestration
- engine selection
- fallback behavior
- deterministic export metadata
- `abc2midi` process handling

Before any plugin work starts, the repo needs a reusable application-service layer and a stable local process protocol that another host process can call.

## Decision

Introduce two new layers:

1. `@llm-midi/engine-service`
   This package owns application-level orchestration for:
   - validate
   - inspect
   - convert with `internal`, `abc2midi`, and `auto`
   - deterministic export planning
   - `abc2midi` process invocation and structured tool diagnostics

2. `llm-midi-worker` plus `@llm-midi/worker-protocol`
   This adds a long-running, local-only stdio worker using newline-delimited JSON over stdin/stdout.

The CLI remains direct by default in this slice. It now uses `@llm-midi/engine-service` in-process and keeps:

- argument parsing
- input file reads
- final MIDI file writes
- JSON stdout formatting

## Why a service layer is needed now

Keeping orchestration inside `apps/cli` would force future non-CLI callers to either:

- duplicate the conversion logic, or
- treat the CLI itself as an unstable integration surface

Neither is acceptable for later plugin work. A dedicated service package keeps the orchestration reusable while leaving transport and UX concerns separate.

## Why stdio is introduced before JUCE

The worker boundary is introduced now so the protocol and failure semantics can be tested independently of any plugin shell.

This gives the repo a process boundary that is:

- local
- explicit
- easy to spawn from desktop code
- easy to test in CI
- safe to keep sequential for now

It also means future JUCE work can focus on host integration and UI, not on inventing a process contract from scratch.

## Why HTTP / WebSocket / gRPC are out of scope

Those transports would add unnecessary infrastructure and lifecycle complexity for a local desktop integration problem.

This slice intentionally does **not** add:

- sockets
- local servers
- browser-facing APIs
- background daemons
- remote deployment concerns

The required boundary is only a local child process, so stdio is the smallest correct transport.

## Why the CLI stays direct by default

The CLI is still the primary user-facing interface for this phase. Making it indirect by default would add an extra moving part without any user benefit yet.

Keeping the CLI direct preserves:

- current workflows
- current JSON output behavior
- current deterministic export naming
- simple debugging for command-line use

The new worker exists as an additional reusable boundary, not a replacement for the CLI.

## Why abc2midi still remains behind the same service layer

The project still needs broader coverage than the internal engine intentionally supports.

Keeping `abc2midi` available through the same service layer ensures that:

- fallback behavior is consistent across CLI and worker callers
- diagnostics stay structured
- future plugin callers do not need special-case logic for the external tool path

## Consequences

- orchestration is no longer primarily owned by `apps/cli`
- a future JUCE shell can call either the service layer directly or the stdio worker
- the worker protocol is versioned from the beginning
- tests now cover both in-process orchestration and the long-running worker boundary
- current product scope remains unchanged: no JUCE, no VST3, no FL Studio host integration
