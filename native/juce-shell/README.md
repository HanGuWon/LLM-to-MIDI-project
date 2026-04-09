# Native JUCE Shell

Optional Windows-first standalone JUCE desktop app for the existing local Node worker.

This project is intentionally separate from the default Node toolchain:

- it is not part of `npm run build`
- it is not part of `npm run typecheck`
- it is not part of `npm test`
- it does not add any JUCE dependency to the workspace packages

## What It Does

The shell proves the current worker/service stack is consumable from a native JUCE process without introducing plugin-host complexity yet.

Current flow:

1. Launch `node apps/worker/dist/index.js --transport pipe`
2. Read exactly one machine-readable ready line
3. Extract the named-pipe endpoint from that line
4. Connect with `juce::NamedPipe`
5. Exchange newline-delimited JSON requests and responses off the JUCE message thread
6. Decode `midiBase64` and write the file locally using the worker-provided `suggestedFileName`

## Prerequisites

- Windows 10/11
- Visual Studio 2022 with C++ build tools
- CMake 3.22+
- Node.js 22+
- a built worker entrypoint at `apps/worker/dist/index.js`
- JUCE available either as:
  - a local JUCE checkout passed with `-DJUCE_SOURCE_DIR=...`
  - or an installed JUCE CMake package discoverable through `CMAKE_PREFIX_PATH`

Optional:

- `abc2midi` installed locally, or an explicit executable path entered in the shell UI

## Prepare The Worker

Run the normal Node build first from the repo root:

```powershell
npm install
npm run build
```

The shell defaults to `node` for the executable and tries to point the worker script field at `apps/worker/dist/index.js`.

## Configure With A Local JUCE Checkout

From the repo root:

```powershell
cmake -S native/juce-shell -B native/juce-shell/build -G "Visual Studio 17 2022" -A x64 -DJUCE_SOURCE_DIR="C:\path\to\JUCE"
```

## Configure With An Installed JUCE CMake Package

If JUCE has been installed as a CMake package:

```powershell
cmake -S native/juce-shell -B native/juce-shell/build -G "Visual Studio 17 2022" -A x64 -DCMAKE_PREFIX_PATH="C:\path\to\JUCE\install"
```

This project follows the two JUCE CMake consumption paths described in the official JUCE CMake docs:

- `add_subdirectory` with a local checkout
- `find_package(JUCE CONFIG REQUIRED)` with an installed package

## Build

```powershell
cmake --build native/juce-shell/build --config Release
```

Expected target:

- `llm_midi_juce_shell`

## Run

From the repo root:

```powershell
.\native\juce-shell\build\llm_midi_juce_shell_artefacts\Release\LLM to MIDI Shell.exe
```

If your generator writes the executable elsewhere, use the path shown by the build output.

## Default Shell Behavior

The app exposes:

- ABC paste editor
- worker status area
- `Start Worker`
- `Stop Worker`
- `Validate`
- `Inspect`
- `Convert to MIDI`
- engine selector: `abc2midi`, `internal`, `auto`
- text fields for:
  - Node executable path
  - worker script path
  - optional `abc2midi` path
  - export directory

The app:

- keeps worker launch and IPC off the JUCE message thread
- launches the existing worker in pipe mode
- connects over the existing NDJSON protocol
- writes MIDI files locally using the worker-provided deterministic export plan metadata

## Manual Smoke Steps

### Internal Engine Smoke

1. Build the Node workspace with `npm run build`.
2. Launch the shell.
3. Confirm the worker script points at `apps/worker/dist/index.js`.
4. Leave Node executable as `node`.
5. Leave `abc2midi` blank.
6. Choose engine `internal`.
7. Paste `tests/fixtures/conversion/melody.abc` into the ABC editor.
8. Click `Start Worker`.
9. Click `Validate`.
10. Confirm normalized ABC and diagnostics appear.
11. Click `Inspect`.
12. Confirm canonical score JSON appears.
13. Click `Convert to MIDI`.
14. Confirm the app reports the exported path and writes `<suggestedFileName>` into the chosen export directory.

### Fallback Smoke

1. Set engine to `auto`.
2. Paste `tests/fixtures/conversion/quintuplet.abc`.
3. Supply an explicit `abc2midi` path if you want to exercise fallback on a machine without `abc2midi` on `PATH`.
4. Click `Convert to MIDI`.
5. Confirm the output panel shows fallback metadata and either:
   - a written MIDI file, if `abc2midi` is available
   - or a clear tool error, if it is not

## Notes

- This shell does not add any plugin target.
- This shell does not add any host integration.
- This shell does not add live MIDI output.
- This shell does not replace the CLI.
- This shell does not replace stdio worker mode.
