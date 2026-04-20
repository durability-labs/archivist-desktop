# Sidecar Binaries

This directory contains the Archivist node binaries that run alongside the desktop application.

The sidecar is built from the **`main` branch** of [durability-labs/archivist-node](https://github.com/durability-labs/archivist-node) at a pinned commit. See `scripts/download-sidecar.sh` (`ARCHIVIST_COMMIT`) for the exact commit currently in use.

## Automatic Download

Requires the GitHub CLI (`gh`) installed and authenticated, since main-branch builds are published as workflow artifacts (not GitHub Releases):

```bash
gh auth login   # first time only

# From the project root - download for current platform
pnpm download-sidecar

# Or for a specific target (cross-compilation)
bash scripts/download-sidecar.sh x86_64-apple-darwin
bash scripts/download-sidecar.sh aarch64-apple-darwin
bash scripts/download-sidecar.sh x86_64-pc-windows-msvc
```

## Upgrading the pinned commit

1. Pick a new commit on `main` that has a successful "Release" workflow run.
2. Update `ARCHIVIST_COMMIT` in `scripts/download-sidecar.sh`.
3. Run the script for each target platform; it will print the actual SHA256 — paste it into `get_checksum()` for that platform.
4. Commit the updated script + DLLs.

## Manual Download

If you can't use `gh`, download the binary directly from the GitHub Actions UI:
the `Release` workflow run for the pinned commit publishes per-platform artifacts named `release-archivist-main-<platform>` (e.g. `release-archivist-main-windows-amd64.exe`).

Rename the extracted binary to match the Tauri target triple:

| Platform | Sidecar Filename |
|----------|------------------|
| Linux x64 | `archivist-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `archivist-aarch64-unknown-linux-gnu` |
| macOS Intel | `archivist-x86_64-apple-darwin` |
| macOS Apple Silicon | `archivist-aarch64-apple-darwin` |
| Windows x64 | `archivist-x86_64-pc-windows-msvc.exe` |

## Windows Runtime DLLs

The Windows binary requires MinGW runtime DLLs (`libgcc_s_seh-1.dll` and `libwinpthread-1.dll`).
These are bundled in the workflow artifact and the download script copies them automatically.
The DLLs are tracked in git to keep the Windows build reproducible.

## Note

The main binary is gitignored due to its size. Each developer/CI pipeline must download it before building.
