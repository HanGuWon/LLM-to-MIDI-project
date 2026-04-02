# LLM to MIDI Project

Windows-first Phase 0 spike for a local `ABC -> MIDI -> FL Studio Piano Roll import` workflow.

## Scope

- Paste ABC text directly into a local CLI.
- Normalize only safe defaults and cleanup.
- Convert through `abc2midi`.
- Export a deterministic `.mid` file for FL Studio import.

This phase intentionally does **not** include a JUCE plugin, live MIDI/Burn flow, an FL Piano Roll script bridge, or an internal canonical score engine.

## Prerequisites

- Node.js 22+
- npm 10+
- Git
- `abc2midi` installed locally, or a path supplied with `--abc2midi-path`

The current machine does not have `abc2midi` on `PATH`, so the CLI is designed to accept an explicit executable path.

## Setup

```powershell
npm install
npm run build
npm test
```

## Usage

Validate pasted ABC from the built repo:

```powershell
node apps/cli/dist/index.js validate --input .\tests\fixtures\conversion\melody.abc
```

Convert pasted ABC to MIDI from the built repo:

```powershell
node apps/cli/dist/index.js convert --input .\tests\fixtures\conversion\melody.abc --export-dir exports --abc2midi-path "C:\path\to\abc2midi.exe"
```

Convert from a file:

```powershell
node apps/cli/dist/index.js convert --input .\example.abc --export-dir exports
```

If you want a plain `llm-midi` command locally, run `npm link` after `npm run build`.

Each command prints JSON. `convert` writes a deterministic file name:

```text
exports/<title-or-imported-fragment>-<8charhash>.mid
```

## FL Studio manual smoke flow

1. Run `convert` and note the exported MIDI path.
2. In FL Studio Piano Roll, use `Ctrl+M` to import the file.
3. Or drag the exported `.mid` directly into the Piano Roll.
4. Confirm the notes appear as ordinary editable Piano Roll data.

## Project layout

```text
apps/cli            CLI entrypoint and process integration
packages/abc-core   normalization, validation, diagnostics, shared types
tests/              fixture-driven validation and conversion tests
docs/adr/           architecture decisions
```
