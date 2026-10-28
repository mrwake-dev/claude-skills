# Platform Scripting Rules (bash, PowerShell, BrightScript, batch, C#)

Apply when the diff touches `.sh`/`.bash`, `.ps1`/`.psm1`/`.psd1`, `.brs`, `.bat`/`.cmd` or `.cs`.
These scripts install, launch, update and recover the player. They run unattended, on a device with
no console and nobody to retry them, so a silent failure leaves a black screen until someone drives
to the site. Nothing transpiles, type-checks or lints them the way the TypeScript source is checked.

## Shared expectations

- **Fail loudly.** A failed step must stop the script rather than continue against half-installed
  state. Silent continuation is the defect that turns a bad update into a bricked player.
- **Idempotent.** A re-run after a power cut mid-script must converge, not duplicate or corrupt.
- **Absolute paths, or an explicit working directory.** These run from init, cron, a service
  manager or an autorun — never from an interactive shell where `$PWD` is what you assume.
- **Quote and escape every path.** Device paths contain spaces (`Program Files`, SD card mounts).
- **No secrets** in the script, or in a command line visible to the process table or event log.
- **No unpinned network fetch** as an install step — pin the version and verify a checksum.

## bash

- `set -euo pipefail` at the top of any new script; a bare `set -e` is not enough (an unset variable
  or a failing pipeline stage still passes).
- Quote every expansion — `"$var"`, `"${arr[@]}"`. An unquoted expansion in `rm`/`cp`/`mv`/`cd` is
  the classic wipe-the-disk bug when the variable is empty or contains a space.
- `$(...)`, never backticks; `mktemp` for temp files, never a fixed `/tmp/name`; `trap … EXIT` to
  clean them up.
- `cd … || exit` — an unchecked `cd` runs everything that follows in the wrong directory.
- Never pipe a download into a shell (`curl … | sh`), and never `eval` interpolated input.
- Probe with `command -v` before using a tool — device images are minimal and often lack `curl`,
  `jq` or GNU coreutils flags.
- If the shebang is `/bin/sh` (busybox on embedded Linux), bashisms are unavailable: `[[ ]]`,
  arrays, `local`, `source`, `${var,,}`.

## PowerShell

- `$ErrorActionPreference = 'Stop'` and `Set-StrictMode -Version Latest` at the top — the default is
  to *continue* past a non-terminating error, which is how a failed install reports success.
- `-ErrorAction SilentlyContinue` hides failures; acceptable only with an explicit check right after.
- Native executables do not throw — check `$LASTEXITCODE` after every external call.
- No `Invoke-Expression`/`iex` on interpolated strings; use the call operator with an argument array.
- Approved verbs on functions (`Get-`, `New-`, `Set-`, `Test-`, `Install-`).
- No plaintext credentials: `ConvertTo-SecureString -AsPlainText -Force` in a committed script is a
  finding.
- Target the Windows PowerShell **5.1** baseline unless the change ships pwsh 7 — `??`, `?.`, the
  ternary operator and `ForEach-Object -Parallel` are 7-only and fail to parse on 5.1.

## BrightScript

- Verify `try`/`catch` is actually supported by the minimum BrightSign OS being targeted; on older
  firmware there is no exception handling and an uncaught runtime error kills the script, taking
  playback with it. Check return values instead.
- `roMessagePort` loops: every registered object needs its port set, and the loop must handle
  unexpected message types rather than falling through and spinning.
- Release object references (`= invalid`) for `roVideoPlayer`, `roImageWidget` and similar — a
  leaked object holds the single hardware decoder and the next play fails.
- `wait(0, port)` blocks indefinitely; pass a timeout in any loop that must stay responsive.
- String concatenation in a loop reallocates each time — build large output via `roList`/`roByteArray`.
- `roRegistrySection` writes hit flash; batch them, never write per frame or per second.

## Batch & C#

- `.bat`/`.cmd`: quote paths, `setlocal` to avoid leaking environment, and check `if errorlevel 1`
  after each step — batch has no `set -e` equivalent.
- `.cs`: dispose native handles and `Process` objects; never swallow an exception in a service entry
  point, where the only symptom is a service that exits silently at boot.
