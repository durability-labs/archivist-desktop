You are Claude Code running inside the repo https://github.com/durability-labs/archivist-desktop.

Goal
- Fix the UI/UX so the product’s “happy path” is a 30-second backup + sync trial after installing the Archivist Desktop .exe.
- Prioritize these user story paths (in order):
  1) “Try it fast”: user can back up a folder and see it being tracked/synced (no networking knowledge required).
  2) “Prove it worked”: user can confirm a file was captured (CID / upload status / last synced time) and can restore/download it locally.
  3) “Add a second device”: user can connect a second machine and start receiving the same backups (guided; advanced networking hidden).
  4) “Operate confidently”: user can see node status, health, logs, and fix common issues via clear CTAs.
  5) “Advanced”: peers view, raw logs, ports, SPR record management, etc. should be discoverable but not in the initial flow.

Hard acceptance criteria (must meet)
- Fresh install → open app → user can complete a “Quick Backup” in <= 30 seconds with <= 3 decisions:
  - Decision 1: click “Start Quick Backup”
  - Decision 2 (optional): pick a folder OR accept default “Documents/Archivist Quickstart”
  - Decision 3: (optional) enable “Sync to network” later; initial trial can be local + node running.
- The app must auto-start the node (sidecar) on first run, show a clear status (“Running / Starting / Error”), and never dump the user into an empty dashboard.
- No “Peers/Logs/Settings” required for the first backup trial.
- After the first successful backup event, show a “Next steps” panel: Restore file + Add second device.

What to do (work plan)
1) Repo mapping (quick)
   - Identify current entry route and navigation layout.
   - Identify existing “Sync” or folder-watching UI + any state store/services talking to the Rust backend.
   - Identify how the node/sidecar is started/stopped and how status is surfaced to the frontend.

2) Implement a first-run onboarding + “Quick Backup” flow
   - Add a new first-run route/page (e.g., /onboarding or /quickstart) that becomes the default landing page until the user completes the first backup.
   - Persist completion via local storage or existing config persistence used in the app.
   - UI requirements:
     - Single primary CTA: “Start Quick Backup”.
     - Secondary: “Choose a folder instead…”
     - Show node status inline at top with minimal text and an expand/collapse for details.
     - If the node isn’t running, start it automatically and show progress.

3) Make “Quick Backup” extremely low friction
   - Default behavior:
     - Create (if missing) a default folder (e.g., ~/Documents/Archivist Quickstart) and drop a tiny sample file (“hello-archivist.txt”) so there is an immediate observable event.
     - Start watching that folder immediately.
     - Start upload/sync pipeline as currently implemented (or if network sync is optional/slow, at least show local indexing + CID creation and queueing).
   - UI shows a small timeline:
     - Node started
     - Folder selected
     - Watching enabled
     - First file captured
     - First sync/upload complete (or “queued” if offline)
   - Show concrete artifacts:
     - “Last change captured: <filename>”
     - “CID: <…>” (if available)
     - “Last synced: <time>” (or “Pending”)

4) Rework navigation to match priority
   - Replace the default left-nav (or top-nav) emphasis so “Quickstart / Backups” is first.
   - Create a simplified primary IA:
     - Backups (primary)
     - Restore (or “Files”) (secondary)
     - Devices (connect second machine) (secondary)
     - Advanced (Peers, Logs, Settings)
   - If the app already has these sections, re-label/re-order, and tuck Peers/Logs behind an “Advanced” accordion/route group.

5) Add a “Restore” success proof
   - From the post-backup success screen, include “Restore a file”:
     - Either download from network or pull from local content-addressed store via existing APIs.
     - Minimal UI: pick a backed-up file → choose restore location → restore.
   - If full restore isn’t feasible quickly, implement a “Show me where it’s stored + copy CID” proof step and a “Download to…” CTA stub that is wired to existing download path.

6) Add “Add second device” guided flow
   - Create a dedicated “Devices” screen with a wizard:
     - Step 1: “On second device, install Archivist Desktop”
     - Step 2: “Copy/paste your pairing info (SPR record or whatever the repo uses)”
     - Step 3: “Confirm connection” with a green success state
   - Hide port/relay details behind “Troubleshooting” expandable section.
   - Provide clear error states with action buttons (retry, copy diagnostics, open logs, etc.).

7) Error states + polish (minimum)
   - If node fails to start: show a single-line explanation + “Retry” + “Open Logs” + “Copy diagnostics”.
   - If folder permissions fail: show “Choose a different folder” CTA.
   - If sync is offline: show “Working locally; will sync when online/connected” and keep the user moving.

Deliverables (must produce in this PR)
- Code changes implementing the onboarding/quickstart UX, including:
  - New page(s)/route(s)
  - Updated nav/IA
  - Node status component
  - Quick Backup action that (a) ensures node is running (b) chooses/creates default folder (c) enables watch/sync
  - Post-success “Next steps” panel (Restore + Add second device)
- Update README or in-app Help text:
  - “30-second Quick Backup” instructions
- Add minimal tests or at least a manual QA checklist in the PR description.

Implementation constraints
- Follow existing code style, component patterns, and state management in this repo (do NOT introduce a new design system).
- Keep the change set focused: prioritize the quickstart path over adding brand-new complex features.
- Prefer small refactors + re-wiring existing capabilities.

Manual QA checklist (you should run and report results)
1) Fresh profile (clear app config) → app opens to Quickstart.
2) Click “Start Quick Backup” → node auto-starts → default folder created → sample file captured → UI shows success.
3) Add a new file into the watched folder → UI updates “last captured”.
4) Navigate away and relaunch app → does NOT show onboarding again; lands in Backups with status.
5) Simulate node start failure → error screen shows Retry/Logs/Diagnostics actions.
6) Devices wizard loads and pairing info can be copied.

Now implement the above in the repo. Start by identifying the current routing/nav entrypoint and the existing folder sync/watch implementation, then wire the new Quickstart flow to those primitives.
