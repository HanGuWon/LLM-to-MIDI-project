# ADR-001: Use abc2midi for the Phase 0 conversion engine

## Status

Accepted

## Context

The repository starts empty and the goal for Phase 0 is a Windows-first proof path:

`pasted ABC -> normalized ABC -> abc2midi -> .mid -> FL Studio Piano Roll import`

The spike needs deterministic local conversion quickly, with enough validation to reject unsupported constructs and clean up common pasted chatbot output. It does not need a plugin shell, real-time scheduling, or a richer internal music model yet.

## Decision

Phase 0 uses `abc2midi` as the primary conversion engine.

The codebase will:

- normalize pasted ABC into a supported subset,
- block unsupported constructs before invoking the tool,
- write normalized ABC to a temp file,
- invoke `abc2midi`,
- capture stdout and stderr into structured diagnostics,
- export a deterministic MIDI file name for FL Studio import.

## Deferred

The following are explicitly deferred beyond Phase 0:

- JUCE VST3 shell
- live MIDI output / FL Studio Burn workflow
- FL Piano Roll Python bridge
- internal canonical score model
- bundled `abc2midi` packaging and license review

## Consequences

- Phase 0 becomes usable quickly and remains focused on proof-of-workflow.
- Conversion quality is bounded by `abc2midi` plus the validation layer.
- Later phases can replace or supplement `abc2midi` without rewriting the CLI contract.
