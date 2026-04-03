# ADR-002: Introduce a narrow internal canonical score engine

## Status

Accepted

## Context

Phase 0 proved the local CLI workflow with:

`raw pasted ABC -> normalization -> abc2midi -> .mid`

That path is still useful, but later phases need an internal semantic core that can be reused inside a worker process, service boundary, or plugin-side orchestration layer without depending entirely on an external converter.

The next thin vertical slice therefore needs a deterministic internal path for a deliberately narrow subset:

`normalized ABC -> canonical score -> MIDI`

## Decision

Add three new layers while keeping the original fallback path:

- `packages/score-model` for JSON-serializable canonical score types using rational musical time
- `packages/midi-smf` for deterministic format-0 MIDI writing
- a strict normalized-ABC parser/expander inside `packages/abc-core`

The CLI gains:

- `inspect` to print canonical score JSON
- `convert --engine internal`
- `convert --engine auto`

`convert --engine abc2midi` remains available and preserves the original Phase 0 behavior.

## Why the scope is intentionally narrow

The internal engine currently supports only a small MVP subset so that its semantics remain explicit and testable:

- monophonic notes and rests
- simple headers and note lengths
- ties between identical pitches
- basic key-signature accidental resolution

It does **not** try to infer or repair unsupported rhythmic or structural constructs such as tuplets, repeats, block chords, or multiple voices.

That narrow scope is intentional. The goal is to establish a reliable semantic foundation, not to replace every external-tool capability in one step.

## Why abc2midi remains as fallback

`abc2midi` still covers constructs that the internal engine does not yet support, and it remains valuable for:

- preserving the existing user workflow
- handling unsupported inputs in `--engine auto`
- keeping tests independent from a real installation through the fake external tool

This allows the internal engine to grow incrementally without breaking the current CLI contract.

## Deferred

The following remain deferred:

- JUCE / VST3 work
- FL Studio integration
- live MIDI output
- Piano Roll script bridging
- `abc2midi` bundling, installer work, and license packaging

## Consequences

- The codebase now has a reusable internal semantic layer.
- Unsupported constructs fail explicitly instead of being silently approximated.
- The existing external-tool path remains intact while future phases can build on the canonical score model.
