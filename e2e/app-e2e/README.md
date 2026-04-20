# App E2E Tests — Real Archivist Desktop via CDP

These tests drive the **real installed** Archivist Desktop app (not the Vite dev server) via Chrome DevTools Protocol. They verify both:
- **UI state** (Playwright assertions on the WebView2 frontend)
- **Backend behavior** (pattern-matching the sidecar's `node.log`)

This catches bugs the mocked vitest suite can't — wire-format regressions, Tauri IPC wiring, sidecar CLI flag contracts, etc.

## Running

Windows only right now.

```powershell
# Prereqs: release build + install
pnpm test:release            # builds + installs + runs the basic release smoke tests
                             # leaves the NSIS bundle at src-tauri/target/release/bundle/nsis/

# Run all app-e2e tests with a clean data dir
pnpm test:e2e:app

# Keep the existing wallet / data dir (useful for iterating on a specific flow)
powershell.exe -File scripts/run-app-e2e.ps1 -KeepData

# Run a subset by test-name grep
powershell.exe -File scripts/run-app-e2e.ps1 -Grep "Publish"
```

## What the orchestrator does

`scripts/run-app-e2e.ps1` is the single entry point. It:
1. Kills any running `archivist-desktop.exe` / `archivist.exe`
2. Wipes `%APPDATA%\archivist\` (unless `-KeepData`)
3. Sets `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
4. Launches `%LOCALAPPDATA%\Archivist\archivist-desktop.exe`
5. Polls TCP `127.0.0.1:9222` until reachable (60s timeout)
6. Runs Playwright with `ARCHIVIST_CDP_URL` + `ARCHIVIST_NODE_LOG` set
7. Kills the app on exit (pass or fail)

## Adding a test

1. Create `tests/my-flow.spec.ts`.
2. Import from `../fixtures/app` (provides `page`, `tailNodeLog`, etc.).
3. Use `navigateTo(page, 'Settings')` / other helpers from `../fixtures/appHelpers`.
4. Anchor `tailNodeLog()` BEFORE the UI action you're testing, then `tail.readNew()` after.
5. Assert on both UI state (`expect(locator).toBeVisible()` etc.) and log contents (`findHardFailures(chunk)`).

## Why CDP?

- WebView2 already speaks CDP when launched with `--remote-debugging-port=N`.
- Playwright can `chromium.connectOverCDP('http://127.0.0.1:9222')` — no `tauri-driver` install required.
- No separate browser process. Full fidelity with what users see.

## Limitations

- **Windows only.** The orchestrator uses PowerShell + WebView2-specific env var. macOS (WebKit) and Linux (WebKitGTK) don't expose equivalent CDP endpoints.
- **Single browser context.** The Tauri app exposes its one WebView as the default CDP context — tests can't open multiple tabs.
- **Sequential execution.** `workers: 1`; there's only one app instance at a time.
