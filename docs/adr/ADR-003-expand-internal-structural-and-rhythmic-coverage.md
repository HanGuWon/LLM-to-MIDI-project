# ADR-003: Expand internal structural and rhythmic coverage before plugin work

## Status

Accepted

## Context

ADR-002 introduced the first internal path:

`normalized ABC -> canonical score -> MIDI`

That slice established the semantic layers, but the repo still contained conversion fixtures that required `abc2midi` fallback because the internal engine did not yet support:

- standard `(3` triplets
- simple block chords
- one-level repeats with first/second endings

Before any JUCE or plugin work begins, the internal engine needs enough structural and rhythmic coverage to handle the current fixture corpus directly.

## Decision

Expand the internal engine just enough to internalize the constructs already present in the repo's current conversion fixtures:

- standard `(3` triplets only
- simple block chords like `[CEG]` with one shared outer duration
- one-level `|: :|` repeats with optional `[1` / `[2` endings in the current fixture style

The implementation remains layered:

- normalization
- strict normalized-ABC parsing
- structural expansion
- canonical score generation
- MIDI serialization
- CLI orchestration

## Why the scope is still intentionally narrow

The goal is not full ABC coverage. The scope remains narrow so the internal engine stays deterministic, explicit, and easy to test.

This slice still does **not** implement:

- generalized tuplets beyond standard `(3`
- nested tuplets
- tuplet ratio syntax
- nested or multi-region repeats
- multi-voice semantics
- advanced chord behavior such as inner mixed durations or chord ties

Unsupported cases continue to fail explicitly instead of being silently approximated.

## Why abc2midi remains the fallback path

`abc2midi` still covers cases that the internal engine intentionally leaves out. Keeping it as fallback allows:

- stable CLI behavior for broader inputs
- `--engine auto` to remain useful beyond the current internal subset
- tests to exercise fallback behavior without depending on a real installation

## Newly internalized in this slice

- standard `(3` triplet timing with deterministic rational durations
- simultaneous note expansion for simple block chords
- structural playback expansion for one-level repeats and first/second endings
- stronger MIDI verification through a small test-only SMF reader

## Still out of scope

- JUCE / VST3 work
- FL Studio integration
- live MIDI output
- Piano Roll script integration
- multi-voice support
- generalized tuplet semantics
- nested repeat handling
- `abc2midi` packaging or installer changes

## Consequences

- `inspect` and `convert --engine internal` now cover the full current conversion fixture set.
- `convert --engine auto` now prefers the internal engine for the current conversion fixtures.
- explicit unsupported fixtures continue to exercise fallback for advanced cases.
