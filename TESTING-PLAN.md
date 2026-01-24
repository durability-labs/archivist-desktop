# Archivist Desktop Cross-Platform Testing Plan

## Overview
Testing the complete UI and backup functionality between:
- **Machine A**: Windows 11 Pro (Source/Primary) - creates backups
- **Machine B**: Ubuntu (Backup Server) - receives backups

---

## Bug Fixes Applied During Testing (2026-01-24)

### Bug: Auto-generated manifests not registered with ManifestRegistry

**Problem:** When the sync service automatically generated manifests (after reaching the file change threshold), they were uploaded to the node but NOT registered with the ManifestRegistry. This meant the manifest server returned an empty array `{"manifests":[]}` even though manifest files existed in storage.

**Root Cause:** The `process_queue()` method in `SyncService` generated and uploaded manifests but didn't call `registry.register_manifest()`. Compare to the `generate_folder_manifest` Tauri command which did register manifests correctly.

**Fix Applied:** Modified `SyncService` to hold a reference to the `ManifestRegistry` and auto-register manifests after generation.

**Files Changed:**
1. **`src-tauri/src/services/sync.rs`**
   - Added import: `use crate::services::manifest_server::{ManifestInfo, ManifestRegistry};`
   - Added field to `SyncService` struct: `manifest_registry: Option<Arc<RwLock<ManifestRegistry>>>`
   - Added constructor: `pub fn with_manifest_registry(manifest_registry: Arc<RwLock<ManifestRegistry>>) -> Self`
   - Added auto-registration in `process_queue()` after manifest upload:
     ```rust
     // Register manifest with the discovery server's registry
     if let Some(registry) = &self.manifest_registry {
         if let Some(folder) = self.folders.get(&folder_id) {
             let manifest_info = ManifestInfo {
                 folder_id: folder_id.clone(),
                 folder_path: folder.path.clone(),
                 manifest_cid: manifest_cid.clone(),
                 sequence_number: folder.manifest_sequence,
                 updated_at: Utc::now().to_rfc3339(),
                 file_count: folder.file_count,
                 total_size_bytes: folder.total_size_bytes,
             };
             let mut reg = registry.write().await;
             reg.register_manifest(manifest_info);
             log::info!(
                 "Auto-registered manifest {} for folder {}",
                 manifest_cid,
                 folder_id
             );
         }
     }
     ```

2. **`src-tauri/src/state.rs`**
   - Changed `SyncService::new()` to `SyncService::with_manifest_registry(manifest_registry.clone())`

**Verification:** After the fix, logs show:
```
Threshold reached for folder ..., generating manifest
Manifest generated and uploaded for folder ...: zDvZRwzm...
Registering manifest for folder ...: CID=zDvZRwzm..., seq=1
Auto-registered manifest zDvZRwzm... for folder ...
```

Machine B should now automatically receive manifests without needing to click "Backup Now".

---

### Issue: P2P Connection Fails Between Internet-Separated Machines

**Status:** ✅ RESOLVED - Reverse Connection Works

**Problem:** Machine B's backup daemon can reach Machine A's manifest server (HTTP on port 8085) and receives the manifest list correctly. However, when the daemon tries to download the manifest/files via P2P, the libp2p connection fails with "Unable to dial peer".

**Symptoms:**
```
[17:30:56][backup_daemon][INFO] Connecting to source peer 16Uiu2HAmG88f62k... at /ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62k...
[17:30:56][node_api][INFO] Sending GET request to: http://127.0.0.1:8080/api/archivist/v1/connect/16Uiu2HAmG88f62k...
[17:30:56][archivist-node] Received error response from handler status=400 restError="Unable to dial peer"
[17:30:56][backup_daemon][WARN] Failed to connect to peer... (will try download anyway)
[17:30:56][backup_daemon][INFO] Manifest not in local storage, fetching from network
[17:30:57][archivist-node] WRN No key for a QueryResponse
```

**Key Finding:** TCP port 8070 IS reachable (`nc -zv 99.74.3.238 8070` succeeds), but libp2p protocol negotiation fails. The archivist-node returns "Unable to dial peer" error.

**Root Cause Analysis:**
1. Both nodes only announce LAN addresses (192.168.x.x), not public IPs
2. NAT traversal (UPnP) may not be working properly
3. Libp2p requires both sides to be reachable or use a relay

**Potential Solutions:**
1. **Try reverse connection** - Have Machine A connect to Machine B's multiaddr first
2. **Configure announce addresses** - Add public IP to announce addresses in settings
3. **Use relay/bootstrap** - Connect both nodes to a public bootstrap node first
4. **Check Windows Firewall** - Ensure Windows allows inbound on TCP 8070

**Resolution (2026-01-24 12:39 EST):**
Machine A successfully connected to Machine B using the reverse direction:
1. Machine A → Peers page → Connected to `/ip4/174.80.132.129/tcp/8070/p2p/16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj`
2. P2P connection established bidirectionally
3. Backup daemon on Machine B successfully processed manifest `zDvZRwzmBAzu...`
4. All 16 files (25.8 MB) downloaded from Machine A to Machine B

**Files Backed Up:**
- Wallpaper images: `illustration-anime-city.jpg`, `Wallpaper_-_37.jpg`, `anime-moon-landscape.jpg`, `thumb-1920-1195443.jpg`
- Test files: `manifest-trigger-1.txt` through `manifest-trigger-11.txt`
- `welcome.txt` from quickstart folder

**Lesson Learned:** When NAT traversal fails in one direction, try the reverse direction. The machine with more permissive NAT/firewall should initiate the connection.

---

## Current Machine Connection Info

### Machine A (Windows) - VERIFIED ✅
| Property | Value |
|----------|-------|
| **Public IP** | `99.74.3.238` |
| **Peer ID** | `16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f` |
| **Full Multiaddr** | `/ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f` |
| **SPR** | `spr:CiUIAhIhAzOHIp2Ls2E8VmU6h9Ci4b5outaMpNNUjJ8o4O2em8_GEgIDARpjCicAJQgCEiEDM4cinYuzYTxWZTqH0KLhvmi61oyk01SMnyjg7Z6bz8YQxdvTywYaCwoJBH8AAAGRAh-aGgsKCQTAqABGkQIfmhoLCgkEZFkjf5ECH5oaCwoJBKwTIAGRAh-aKkYwRAIgT1lg0R2-ulHNCWhYBri2nuzAvPo9cifdXWf1I-xcMhgCIEOAau5LjDGFLu9ozYZoXzKjL-HWUWkz9Kf4zsz_B94E` |
| **Node Version** | v0.2.0 (revision 3bb8c93) |
| **Data Directory** | `C:\Users\anon\AppData\Roaming\archivist` |

**Local Network Addresses:**
- `/ip4/192.168.0.70/tcp/8070` (LAN)
- `/ip4/100.89.35.127/tcp/8070` (Tailscale)
- `/ip4/172.19.32.1/tcp/8070` (WSL/Docker)

### Machine B (Ubuntu)
| Property | Value |
|----------|-------|
| **Public IP** | `174.80.132.129` |
| **Peer ID** | `16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj` |
| **Full Multiaddr** | `/ip4/174.80.132.129/tcp/8070/p2p/16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj` |

---

## Machine A Current Status (Verified 2026-01-24)

### Node Status: ✅ Running
- API responding at `http://127.0.0.1:8080`
- Manifest server running on port 8085
- Backup daemon trigger server on port 8086

### Storage Status
- **Used**: 15.3 MB (298 blocks)
- **Quota**: 10 GB
- **Files stored**: 54 items

### Manifests Generated: 6
The following manifest files exist:
- `.archivist-manifest-16Uiu2HAmG88.json` (multiple versions with different CIDs)

### Watched Folder
- `C:\Users\anon\Documents\Archivist Quickstart` - synced with welcome.txt

---

## Prerequisites

### Network Setup (Internet Connection)
Since machines are on different networks, port forwarding is required:

**Get Public IPs:**
```bash
# On each machine
curl ifconfig.me
```

### Machine A (Windows 11 Pro)
- [x] Archivist Desktop installed and running
- [ ] **Router Port Forwarding:**
  - TCP 8070 → 192.168.0.70 (P2P connections)
  - UDP 8090 → 192.168.0.70 (Discovery)
  - TCP 8085 → 192.168.0.70 (Manifest server)
- [ ] **Windows Firewall:** Allow inbound on UDP 8090, TCP 8070, TCP 8085
- [x] Public IP = `99.74.3.238`

### Machine B (Ubuntu - This Machine)
- [ ] Archivist Desktop running (`pnpm tauri dev`)
- [ ] **Router Port Forwarding:**
  - TCP 8070 → Machine B's LAN IP (P2P connections)
  - UDP 8090 → Machine B's LAN IP (Discovery)
  - TCP 8086 → Machine B's LAN IP (Backup trigger)
- [ ] **UFW Firewall:**
  ```bash
  sudo ufw allow 8070/tcp
  sudo ufw allow 8090/udp
  sudo ufw allow 8086/tcp
  ```
- [x] Public IP = `174.80.132.129`

### Verify Ports Are Open
```bash
# From external network, test Machine A's ports:
nc -zv 99.74.3.238 8070
nc -zv 99.74.3.238 8085

# Test Machine B's ports:
nc -zv 174.80.132.129 8070
nc -zv 174.80.132.129 8086
```

---

## Phase 1: Basic UI Testing (Each Machine Independently)

### 1.1 Onboarding Flow (First Run Only)
| Step | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| 1 | Launch app fresh (clear localStorage) | Splash screen appears (video or CSS fallback) | [ ] | [ ] |
| 2 | Wait for splash to complete | Welcome screen with "Get Started" button | [ ] | [ ] |
| 3 | Click "Get Started" | Node Starting screen, node auto-starts | [ ] | [ ] |
| 4 | Wait for node ready | "Ready" indicator, auto-advance | [ ] | [ ] |
| 5 | Click "Quick Backup" | Folder created, syncing screen appears | [ ] | [ ] |
| 6 | Wait for sync timeline | Timeline progresses, shows CID | [ ] | [ ] |
| 7 | Click "Continue to Dashboard" | Redirected to Dashboard, node running | [ ] | [ ] |

**Reset Onboarding**: Settings → Developer → Reset Onboarding

### 1.2 Dashboard Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| Node Status | View dashboard | Shows node state, uptime, PID | [ ] | [ ] |
| Start/Stop | Click Stop, then Start | Node stops/starts, status updates | [ ] | [ ] |
| Connection Info | When running | Shows peer ID and multiaddr | [ ] | [ ] |
| Copy Multiaddr | Click Copy button | Address copied to clipboard | [ ] | [ ] |
| View Toggle | Click Basic/Advanced toggle | View switches, persists on reload | [ ] | [ ] |
| Diagnostics | Click "Run Diagnostics" | Shows API status, addresses, peer ID | [ ] | [ ] |
| Quick Stats | View stats cards | Shows peers, storage, last backup | [ ] | [ ] |
| NextSteps | After onboarding | Shows guidance cards if applicable | [ ] | [ ] |

### 1.3 Sync (Backups) Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| Add Folder | Click "Add Watch Folder" | File picker opens | [ ] | [ ] |
| Select Folder | Choose a folder with files | Folder added, shows file count/size | [ ] | [ ] |
| Folder Status | View folder card | Shows Idle/Scanning/Syncing status | [ ] | [ ] |
| Enable/Disable | Toggle folder enable switch | Status changes | [ ] | [ ] |
| Manual Sync | Click "Sync Now" | Sync triggers, files upload | [ ] | [ ] |
| Remove Folder | Click Remove on folder | Folder removed from list | [ ] | [ ] |

### 1.4 Restore (Files) Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| File List | View page | Shows uploaded files with CIDs | [ ] | [ ] |
| Upload File | Click "Upload Files" | File picker, file uploads, CID shown | [ ] | [ ] |
| Copy CID | Click copy on file row | CID copied to clipboard | [ ] | [ ] |
| Download Local | Click Download on file | Save dialog, file downloads | [ ] | [ ] |
| CID Paste | Paste valid CID in input | Green border, auto-triggers download | [ ] | [ ] |
| Invalid CID | Type invalid CID | Red border, error message | [ ] | [ ] |
| Remove File | Click Remove on file | File removed from list | [ ] | [ ] |

### 1.5 Devices Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| This Device | View page with node running | Shows peer ID, storage, addresses | [ ] | [ ] |
| Copy Peer ID | Click copy button | Peer ID copied | [ ] | [ ] |
| Copy SPR | Click copy SPR | SPR copied | [ ] | [ ] |
| Offline State | Stop node, view page | Shows offline message | [ ] | [ ] |

### 1.6 Peers Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| Local Info | View page | Shows local peer ID and addresses | [ ] | [ ] |
| Copy Address | Click on address | Full multiaddr copied | [ ] | [ ] |
| Empty State | No peers connected | Shows "No peers connected" | [ ] | [ ] |

### 1.7 Logs Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| View Logs | Navigate to Logs | Shows recent log lines | [ ] | [ ] |
| Line Count | Change dropdown (100/500/1000) | Line count changes | [ ] | [ ] |
| Auto-Refresh | Enable checkbox | Logs update every 2s | [ ] | [ ] |
| Auto-Scroll | Scroll up manually | Auto-scroll disables | [ ] | [ ] |
| Copy All | Click "Copy All" | All logs copied to clipboard | [ ] | [ ] |
| Scroll to Bottom | Click button | Scrolls to end, re-enables auto-scroll | [ ] | [ ] |

### 1.8 Settings Page
| Test | Action | Expected Result | Win | Ubuntu |
|------|--------|-----------------|-----|--------|
| Load Settings | Navigate to Settings | All settings load correctly | [ ] | [ ] |
| Change Port | Modify API port | Field updates | [ ] | [ ] |
| Save Settings | Click Save | Settings persist, restart notice | [ ] | [ ] |
| Reset Defaults | Click Reset | Confirm dialog, settings reset | [ ] | [ ] |
| Notification Toggle | Toggle sound settings | Sound plays/stops | [ ] | [ ] |

---

## Phase 2: P2P Connection Testing

### 2.1 Get Connection Info

**Important:** Since connecting over internet, you must use PUBLIC IPs in multiaddrs.

**Machine A (Windows):**
```
Peer ID: 16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f
Multiaddr: /ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f
```

**Machine B (Ubuntu):**
```
Peer ID: 16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj
Multiaddr: /ip4/174.80.132.129/tcp/8070/p2p/16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj
```

### 2.2 Connect Peers

| Test | Action | Expected Result | Win→Ubuntu | Ubuntu→Win |
|------|--------|-----------------|------------|------------|
| Connect via Multiaddr | Paste full multiaddr, click Connect | Connection successful | [ ] | [ ] |
| Connect via SPR | Paste SPR, click Connect | Connection successful | [ ] | [ ] |
| Peer Appears | Check Peers page | Other machine shows in list | [ ] | [ ] |
| Peer Count | Check Dashboard | Connected peers count = 1 | [ ] | [ ] |
| Disconnect | Click Disconnect on peer | Peer removed from connected list | [ ] | [ ] |
| Reconnect | Click Connect again | Reconnects successfully | [ ] | [ ] |

### 2.3 Add Device Wizard

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Go to Devices → Add Device | Wizard opens on input step |
| 2 | Paste other machine's multiaddr | Input shows address |
| 3 | Click Connect | Connecting spinner appears |
| 4 | Wait for connection | Success screen with peer ID |
| 5 | Click Done | Returns to Devices page, peer listed |

---

## Phase 3: File Transfer Testing

### 3.1 Upload and Download Between Peers

**Setup:** Ensure both machines are connected as peers

| Test | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| Upload | A (Win) | Upload a test file | File appears in list with CID | [ ] |
| Copy CID | A (Win) | Copy the CID | CID in clipboard | [ ] |
| Download | B (Ubuntu) | Paste CID, download | File downloads from network | [ ] |
| Verify | B (Ubuntu) | Open downloaded file | Content matches original | [ ] |
| Reverse | B (Ubuntu) | Upload different file | File has CID | [ ] |
| Download | A (Win) | Paste CID, download | File downloads successfully | [ ] |

### 3.2 Watched Folder Sync

| Test | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| Add Folder | A (Win) | Add folder with 5+ files | Folder syncs, all files have CIDs | [ ] |
| Add File | A (Win) | Add new file to watched folder | File auto-uploads | [ ] |
| Modify File | A (Win) | Edit existing file | File re-uploads with new CID | [ ] |
| Delete File | A (Win) | Delete file from folder | Tracked as deletion | [ ] |

---

## Phase 4: Backup System Testing (Machine A → Machine B)

### 4.1 Configure Machine A (Source/Windows)

**Settings → Sync → Backup to Peer:**
| Setting | Value | Notes |
|---------|-------|-------|
| Enable backup | ✓ Checked | Master switch |
| Backup peer address | `/ip4/174.80.132.129/tcp/8070/p2p/16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj` | Machine B's multiaddr |
| Backup peer nickname | "Ubuntu Backup" | Optional |
| Generate manifest files | ✓ Checked | Creates .archivist-manifest-*.json |
| Auto-notify backup peer | ✓ Checked | Triggers immediate sync |
| Manifest update threshold | 5 | Lower for testing (default 10) |

**Settings → Manifest Server:**
| Setting | Value | Notes |
|---------|-------|-------|
| Enable | ✓ Checked | Exposes manifest endpoint |
| Port | 8085 | Default |
| Allowed IPs | `174.80.132.129` | Machine B's PUBLIC IP |

**Save Settings** and note any restart requirements.

### 4.2 Configure Machine B (Backup Server/Ubuntu)

**Settings → Backup Server:**
| Setting | Value | Notes |
|---------|-------|-------|
| Enable | ✓ Checked | Starts backup daemon |
| Poll interval | 30 | Seconds between polls |
| Max concurrent downloads | 3 | Parallel file downloads |
| Max retries | 3 | Retry failed manifests |
| Auto-delete tombstones | ✓ Checked | Honor deletion requests |

**Add Source Peer:**
| Field | Value |
|-------|-------|
| Nickname | "Windows Source" |
| Host/IP | `99.74.3.238` |
| Manifest port | 8085 |
| P2P Multiaddr | `/ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f` |
| Enabled | ✓ Checked |

**Save Settings.**

### 4.3 Backup Flow Testing

| Step | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| 1 | A | Add watched folder with 10 files | Folder syncs, shows in Sync page | [ ] |
| 2 | A | Wait for manifest threshold | Manifest auto-generates | [ ] |
| 3 | A | Check folder card | Shows manifest CID | [ ] |
| 4 | B | Go to Backup Server page | Daemon shows "enabled" | [ ] |
| 5 | B | Wait for poll (or trigger) | Manifest appears in "In Progress" | [ ] |
| 6 | B | Watch progress | Files download, progress bar updates | [ ] |
| 7 | B | Wait for completion | Manifest moves to "Processed" | [ ] |
| 8 | B | Check statistics | File count and bytes updated | [ ] |
| 9 | B | Go to Files page | Downloaded files appear in list | [ ] |

### 4.4 Deletion Sync Testing

| Step | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| 1 | A | Delete 3 files from watched folder | Files removed locally | [ ] |
| 2 | A | Add 2 new files | Triggers threshold | [ ] |
| 3 | A | Wait for manifest | New manifest with deletions | [ ] |
| 4 | B | Wait for processing | Manifest processed | [ ] |
| 5 | B | Check stats | "Deleted" count increased by 3 | [ ] |
| 6 | B | Check Files page | Deleted files no longer listed | [ ] |

### 4.5 Manual Backup Trigger

| Step | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| 1 | A | Go to Sync page | View watched folders | [ ] |
| 2 | A | Click "Backup Now" on folder | Notification sent | [ ] |
| 3 | B | Check Backup Server page | Immediate processing starts | [ ] |

### 4.6 Retry Failed Manifest

| Step | Machine | Action | Expected Result | Pass |
|------|---------|--------|-----------------|------|
| 1 | B | Disconnect from Machine A | Peer disconnected | [ ] |
| 2 | A | Trigger new manifest | Manifest generates | [ ] |
| 3 | B | Wait for poll | Manifest appears in "Failed" | [ ] |
| 4 | B | Reconnect to Machine A | Peer connected | [ ] |
| 5 | B | Click "Retry" on failed manifest | Processing starts | [ ] |
| 6 | B | Wait for completion | Moves to "Processed" | [ ] |

---

## Phase 5: Error Handling & Edge Cases

### 5.1 Network Issues
| Test | Action | Expected Result | Pass |
|------|--------|-----------------|------|
| Node offline | Stop node, try operations | Graceful error messages | [ ] |
| Peer disconnect | Disconnect peer mid-transfer | Error shown, retry available | [ ] |
| Invalid multiaddr | Enter garbage in connect field | Validation error | [ ] |
| Wrong port | Connect with wrong port | Connection timeout/error | [ ] |

### 5.2 File Edge Cases
| Test | Action | Expected Result | Pass |
|------|--------|-----------------|------|
| Large file | Upload 500MB+ file | Progress shown, completes | [ ] |
| Many files | Sync folder with 100+ files | All files process | [ ] |
| Special characters | File with spaces, unicode | Uploads correctly | [ ] |
| Empty folder | Watch empty folder | No errors, ready state | [ ] |

### 5.3 Windows-Specific Issues
| Test | Action | Expected Result | Pass |
|------|--------|-----------------|------|
| Log viewing | View Logs page | No file locking error | [ ] |
| Path handling | Folder with spaces in path | Works correctly | [ ] |
| Firewall prompt | First run | Windows Firewall dialog appears | [ ] |

---

## Phase 6: UI Polish & Visual Testing

### 6.1 Theme & Styling
| Test | Expected Result | Win | Ubuntu |
|------|-----------------|-----|--------|
| Terminal theme | Dark background, phosphor green accents | [ ] | [ ] |
| Glow effects | Buttons/icons have subtle glow | [ ] | [ ] |
| Hover states | Elements respond to hover | [ ] | [ ] |
| Loading states | Spinners appear during operations | [ ] | [ ] |
| Error states | Red styling for errors | [ ] | [ ] |

### 6.2 Responsive Behavior
| Test | Action | Expected Result | Pass |
|------|--------|-----------------|------|
| Window resize | Resize window smaller | Content adapts, no overflow | [ ] |
| Sidebar collapse | Check at narrow width | Nav remains usable | [ ] |
| Long content | Long file names, addresses | Truncated with ellipsis | [ ] |

---

## Known Issues to Watch For

1. **Windows file locking** - Log viewing should work (fixed in v0.1.2)
2. **Video playback on Linux** - CSS fallback should trigger on Ubuntu
3. **Port conflicts** - Check nothing else uses 8070/8080/8085/8086/8090
4. **Firewall blocks** - Both machines need proper firewall rules
5. **NAT traversal** - UPnP may not work on all routers

## Internet Connection Troubleshooting

| Issue | Diagnosis | Solution |
|-------|-----------|----------|
| Can't connect to peer | Port not forwarded | Check router port forwarding for TCP 8070 |
| Manifest server unreachable | Port 8085 blocked | Forward TCP 8085 on Machine A's router |
| Backup trigger fails | Port 8086 blocked | Forward TCP 8086 on Machine B's router |
| Connection times out | Wrong IP | Verify using public IP, not LAN IP |
| Intermittent disconnects | ISP blocking P2P | Try different ports or use VPN |
| "Address already in use" | Orphaned process | Restart app or kill archivist process |

**Quick Port Test from Machine B:**
```bash
# Test Machine A's P2P port
nc -zv 99.74.3.238 8070 -w 5

# Test Machine A's manifest server
curl -v http://99.74.3.238:8085/health

# If these fail, port forwarding isn't working
```

---

## Test Results Summary

| Category | Windows Pass | Windows Fail | Ubuntu Pass | Ubuntu Fail |
|----------|-------------|--------------|-------------|-------------|
| Onboarding | /7 | | /7 | |
| Dashboard | /8 | | /8 | |
| Sync | /6 | | /6 | |
| Files | /7 | | /7 | |
| Devices | /4 | | /4 | |
| Peers | /3 | | /3 | |
| Logs | /6 | | /6 | |
| Settings | /5 | | /5 | |
| P2P Connection | /6 | | /6 | |
| File Transfer | /6 | | /6 | |
| Backup System | /9 | | /9 | |

**Total Tests: ~67 per platform**

---

## Claude Code Prompts for Machine B (Ubuntu)

### Verify Connection to Machine A
```
Test if this machine can connect to Machine A (Windows source):

1. Test P2P port: nc -zv 99.74.3.238 8070 -w 5
2. Test manifest server: curl -v http://99.74.3.238:8085/manifests
3. Try to connect to Machine A as a peer using multiaddr:
   /ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f

Report what works and what doesn't.
```

### Configure Backup Server
```
Help me configure this machine as a backup server for Machine A:

Machine A's info:
- Public IP: 99.74.3.238
- Peer ID: 16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f
- Manifest server port: 8085

1. Check if the backup daemon is enabled in settings
2. Add Machine A as a source peer with:
   - Nickname: "Windows Source"
   - Host: 99.74.3.238
   - Manifest port: 8085
   - P2P Multiaddr: /ip4/99.74.3.238/tcp/8070/p2p/16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f
3. Verify the configuration is saved correctly
```

### Check Backup Daemon Status
```
Check the backup daemon status on this machine:

1. Is the backup daemon running?
2. What source peers are configured?
3. Are there any manifests being processed?
4. Check the logs for any backup-related errors
5. What is the current poll interval?

Show me a summary of the backup server state.
```

---

## Claude Code Prompts for Machine A (Windows)

### Verify Backup Settings
```
Verify my backup settings are correctly configured:

1. Check Settings -> Sync -> Backup to Peer section:
   - Is "Enable backup" checked?
   - Is the backup peer address set to: /ip4/174.80.132.129/tcp/8070/p2p/16Uiu2HAmPVCGtzHq8TYvD9AYA6Mf5K9KqobPKWRJUNHU59PGTfCj
   - Is "Generate manifest files" checked?
   - Is "Auto-notify backup peer" checked?
   - What is the manifest update threshold?

2. Check Settings -> Manifest Server section:
   - Is it enabled?
   - Is port 8085?
   - Is 174.80.132.129 in the allowed IPs list?

3. Check if settings were saved properly by reading the config file.
```

### Force Manifest Generation
```
The backup server (Machine B) is not receiving any manifests. Help me force manifest generation:

1. First, check what watched folders exist
2. Check how many files have been synced in each folder
3. If files are synced, try to trigger manifest generation via the API or UI
4. Verify the manifest appears at http://127.0.0.1:8085/manifests

Machine B is polling http://99.74.3.238:8085/manifests and should receive manifests.
```

### Create Test Files
```
Help me create test files to trigger manifest generation:

1. Find the watched folder path
2. Create 10 small test files in that folder (e.g., test1.txt through test10.txt)
3. Wait for the files to sync
4. Check if a manifest was generated after the threshold was reached
5. Verify the manifest appears at http://127.0.0.1:8085/manifests
```

### Full Debug Dump
```
Generate a full debug dump for troubleshooting the backup system:

1. Node status and info (API call to /debug/info)
2. List of watched folders and their sync status
3. Manifest server status and what it's serving
4. Current peer connections
5. Recent log entries (last 50 lines)
6. Config file contents (redact any sensitive info)
7. Network connectivity tests to Machine B (174.80.132.129 ports 8070)

Format as a report I can share with the other machine for debugging.
```
