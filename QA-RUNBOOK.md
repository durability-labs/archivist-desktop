# Archivist Desktop v0.1.0 — QA Runbook

Step-by-step execution guide. Run from an **Administrator PowerShell**.

---

## Prerequisites

- Node.js / pnpm on PATH
- Archivist Desktop NSIS installer downloaded
- This repo cloned at `C:\Users\anon\GitHub\archivist-desktop`

---

## Phase 1: Pre-Install Baseline

```powershell
cd C:\Users\anon\GitHub\archivist-desktop
.\scripts\win10-qa-phase1.ps1 -Mode PreInstall
```

## Phase 1b: Install (Manual)

1. Run the NSIS installer
2. Click through UAC, observe progress
3. After install completes:

```powershell
.\scripts\win10-qa-phase1.ps1 -Mode PostInstall
```

---

## Phase 2: Launch App + Playwright Tests

### Step 1 — Set CDP env var and launch app

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
Start-Process "C:\Program Files\Archivist\Archivist.exe"
# Adjust path if installed elsewhere. Check phase1 output for actual location.
```

### Step 2 — Wait for app window, then complete onboarding manually (or let tests do it)

### Step 3 — Install e2e deps and run Playwright

```powershell
cd C:\Users\anon\GitHub\archivist-desktop\e2e
npm install
npx playwright test
```

To run individual spec files:

```powershell
npx playwright test tests/01-onboarding.spec.ts
npx playwright test tests/02-dashboard.spec.ts
npx playwright test tests/03-files.spec.ts
npx playwright test tests/04-logs.spec.ts
npx playwright test tests/05-settings.spec.ts
npx playwright test tests/06-devices.spec.ts
```

### Step 4 — Run PowerShell phases 2 and 3 (while app is still running)

```powershell
cd C:\Users\anon\GitHub\archivist-desktop
.\scripts\win10-qa-phase2.ps1
.\scripts\win10-qa-phase3.ps1
```

---

## Phase 3: Manual Tray Checklist

While app is running, verify manually:

- [ ] Tray icon visible in notification area
- [ ] Left-click shows/focuses window
- [ ] Right-click shows menu ("Show Archivist", "Quit")
- [ ] Window X button hides to tray (does not exit)
- [ ] "Quit" menu item fully exits app

---

## Phase 4: Uninstall Verification

1. Close the app (right-click tray → Quit)
2. Uninstall via **Settings → Apps → Archivist → Uninstall**
3. Run:

```powershell
cd C:\Users\anon\GitHub\archivist-desktop
.\scripts\win10-qa-phase4.ps1
```

---

## File Locations

| File | Purpose |
|------|---------|
| `scripts/win10-qa-phase1.ps1` | Install verification (pre/post) |
| `scripts/win10-qa-phase2.ps1` | Sidecar, ports, API, config |
| `scripts/win10-qa-phase3.ps1` | API file ops, log analysis, quickstart, single-instance |
| `scripts/win10-qa-phase4.ps1` | Uninstall cleanup verification |
| `e2e/tests/01-onboarding.spec.ts` | Onboarding UI flow |
| `e2e/tests/02-dashboard.spec.ts` | Dashboard assertions |
| `e2e/tests/03-files.spec.ts` | Files page + CID validation |
| `e2e/tests/04-logs.spec.ts` | Logs page + os-error-32 check |
| `e2e/tests/05-settings.spec.ts` | Settings save/persist/reset |
| `e2e/tests/06-devices.spec.ts` | Devices + Add Device wizard |
