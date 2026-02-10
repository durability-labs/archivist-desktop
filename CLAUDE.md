# Archivist Desktop

Tauri v2 desktop application for decentralized file storage with P2P sync capabilities.

> Full historical documentation (backup system details, P2P testing guide, version history, troubleshooting, CI/CD pipeline): see [CLAUDE-FULL.md](CLAUDE-FULL.md)

## Quick Start

```bash
pnpm setup          # Install deps + download sidecar
pnpm tauri dev      # Development mode
pnpm tauri build    # Production build
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Rust + Tauri v2 |
| Sidecar | archivist-node (P2P storage daemon) |
| Package Manager | pnpm v10 |
| Node.js | v20 |
| Rust | 1.77.2+ stable |

## Project Structure

```
archivist-desktop/
├── src/                          # React frontend
│   ├── components/               # Reusable UI components
│   ├── hooks/                    # Custom React hooks
│   │   ├── useNode.ts           # Node lifecycle (start/stop/status)
│   │   ├── useSync.ts           # Folder watching + sync queue
│   │   ├── usePeers.ts          # Peer connections
│   │   ├── useFeatures.ts       # Feature flag detection
│   │   ├── useMediaDownload.ts  # yt-dlp media download
│   │   └── useWallet.ts         # V2 wallet (stub)
│   ├── pages/                    # Route components
│   │   ├── Dashboard.tsx        # Main status overview
│   │   ├── Files.tsx            # Upload/download/list files
│   │   ├── Sync.tsx             # Watched folder management
│   │   ├── Peers.tsx            # P2P network view
│   │   ├── Logs.tsx             # Node logs viewer
│   │   ├── MediaDownload.tsx    # yt-dlp media download UI
│   │   └── Settings.tsx         # App configuration
│   ├── lib/                      # Utilities and types
│   │   ├── api.ts               # TypeScript interfaces
│   │   ├── features.ts          # Feature flag constants
│   │   └── tauri.ts             # Tauri invoke helpers
│   ├── styles/                   # CSS files
│   ├── App.tsx                   # Router + layout
│   └── main.tsx                  # Entry point
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs              # App entry (delegates to lib.rs)
│   │   ├── lib.rs               # Tauri setup, commands, tray
│   │   ├── error.rs             # ArchivistError enum
│   │   ├── state.rs             # AppState (service container)
│   │   ├── features.rs          # Runtime feature detection
│   │   ├── node_api.rs          # HTTP client for sidecar
│   │   ├── commands/            # Tauri command handlers
│   │   │   ├── node.rs          # start/stop/restart/status
│   │   │   ├── files.rs         # upload/download/list/delete
│   │   │   ├── sync.rs          # watch folders, sync queue
│   │   │   ├── peers.rs         # connect/disconnect/list
│   │   │   ├── media.rs         # yt-dlp media download
│   │   │   └── system.rs        # config, platform info
│   │   └── services/            # Business logic
│   │       ├── node.rs          # Sidecar process management
│   │       ├── files.rs         # File operations via API
│   │       ├── sync.rs          # File watching (notify crate)
│   │       ├── peers.rs         # Peer management
│   │       ├── config.rs        # Settings persistence
│   │       ├── backup_daemon.rs # Backup daemon (polls source peers)
│   │       ├── manifest_server.rs # HTTP manifest discovery server
│   │       ├── binary_manager.rs # yt-dlp/ffmpeg binary management
│   │       └── media_download.rs # Media download queue + progress
│   ├── sidecars/                # archivist-node binaries (gitignored)
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri configuration
│
├── scripts/
│   └── download-sidecar.sh      # Downloads archivist-node binary
│
├── .github/workflows/
│   ├── ci.yml                   # Tests, lint, build checks
│   └── release.yml              # Multi-platform release builds
│
└── package.json                 # npm scripts + dependencies
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│              React Frontend (localhost:1420)              │
│  Dashboard │ Files │ Sync │ Peers │ Settings             │
└─────────────────────────┬────────────────────────────────┘
                          │ Tauri IPC (invoke)
┌─────────────────────────▼────────────────────────────────┐
│              Rust Backend (Tauri Commands)                │
│                                                           │
│  Commands → Services → NodeApiClient                      │
│     ↓           ↓            ↓                            │
│  AppState   Business    HTTP requests                     │
│  (RwLock)   Logic       to sidecar                        │
└─────────────────────────┬────────────────────────────────┘
                          │ HTTP (localhost:8080)
┌─────────────────────────▼────────────────────────────────┐
│              archivist-node Sidecar                       │
│                                                           │
│  REST API │ P2P Network │ Storage │ CID Management       │
└──────────────────────────────────────────────────────────┘
```

## Archivist-Node API Reference

### Base URL
`http://127.0.0.1:8080/api/archivist/v1`

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/debug/info` | GET | Node info, peer ID, addresses |
| `/spr` | GET | Signed Peer Record |
| `/peerid` | GET | Node peer identifier |
| `/data` | GET | List stored CIDs |
| `/data` | POST | Upload file (raw binary body) |
| `/data/{cid}` | GET | Download file |
| `/data/{cid}` | DELETE | Delete file |
| `/data/{cid}/network` | POST | Download from network (async) |
| `/data/{cid}/network/stream` | GET | Stream download from network |
| `/data/{cid}/network/manifest` | GET | Get network manifest |
| `/space` | GET | Storage space summary |
| `/connect/{peerId}` | GET | Connect to peer (optional `?addrs[]=/ip4/.../tcp/...`) |
| `/sales/slots` | GET | Get active storage slots |
| `/sales/availability` | GET/POST | Manage storage availability |
| `/storage/request/{cid}` | POST | Create storage request |
| `/storage/purchases` | GET | List purchases |

### Upload Format

**IMPORTANT:** Raw binary body (not multipart/form-data)

- `Content-Type`: MIME type (e.g., `application/octet-stream`)
- `Content-Disposition`: `attachment; filename="example.txt"`
- Response: CID as plain text (e.g., `zdj7W...`)

### Key Response Models

#### NodeInfo (from /debug/info)

**Important:** The Desktop app's `NodeInfo` struct must match this format.

```json
{
  "id": "16Uiu2HAmXYZ...",
  "addrs": ["/ip4/127.0.0.1/tcp/8070", "/ip4/192.168.0.1/tcp/8070"],
  "repo": "/home/user/.local/share/archivist/node",
  "spr": "spr:CiUIAhI...",
  "announceAddresses": ["/ip4/192.168.0.1/tcp/8070"],
  "ethAddress": "0x...",
  "archivist": { "version": "v0.1.0", "revision": "abc123", "contracts": "def456" }
}
```

**Rust struct (in `src-tauri/src/node_api.rs`):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub id: String,
    #[serde(default)]
    pub addrs: Vec<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub spr: Option<String>,
    #[serde(default, rename = "announceAddresses")]
    pub announce_addresses: Vec<String>,
    #[serde(default, rename = "ethAddress")]
    pub eth_address: Option<String>,
    #[serde(default)]
    pub archivist: Option<ArchivistInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivistInfo {
    pub version: String,
    #[serde(default)]
    pub revision: Option<String>,
    #[serde(default)]
    pub contracts: Option<String>,
}
```

#### DataItem / DataList
```json
{ "cid": "string", "manifest": { "treeCid": "string", "datasetSize": 0, "blockSize": 0, "protected": false, "filename": "string?", "mimetype": "string?" } }
// DataList: { "content": [ DataItem, ... ] }
```

#### Space
```json
{ "totalBlocks": 1000, "quotaMaxBytes": 10737418240, "quotaUsedBytes": 1073741824, "quotaReservedBytes": 0 }
```

## Tauri Commands

```typescript
import { invoke } from '@tauri-apps/api/core';
const status = await invoke<NodeStatus>('get_node_status');
```

| Command | Description |
|---------|-------------|
| `start_node` | Start archivist-node sidecar |
| `stop_node` | Stop sidecar process |
| `restart_node` | Restart sidecar |
| `get_node_status` | Get running state, PID, storage |
| `run_node_diagnostics` | Run connectivity diagnostics |
| `get_node_config` / `set_node_config` | Node configuration |
| `get_node_logs` | Get last N lines of node logs |
| `get_node_log_path` | Get path to node log file |
| `list_files` | List stored files |
| `upload_file` | Upload file to node |
| `download_file` | Download file by CID |
| `get_sync_status` | Sync queue and folder states |
| `add_watch_folder` / `remove_watch_folder` | Manage watched folders |
| `sync_now` | Trigger manual sync |
| `get_peers` | List connected peers |
| `connect_peer` / `disconnect_peer` | Peer management |
| `get_features` | Runtime feature flags |
| `check_media_binaries` | Check yt-dlp/ffmpeg install status |
| `install_yt_dlp` / `install_ffmpeg` | Download and install binaries |
| `update_yt_dlp` | Update yt-dlp to latest version |
| `fetch_media_metadata` | Fetch video/audio metadata from URL |
| `queue_media_download` | Queue a media download task |
| `cancel_media_download` | Cancel an active download |
| `remove_media_task` | Remove task from queue |
| `clear_completed_downloads` | Clear all completed/failed tasks |
| `get_download_queue` | Get current download queue state |

## Feature Flags

### Compile-time (Cargo.toml)

```toml
[features]
default = []
marketplace = ["ethers", "alloy"]  # V2 blockchain
zk-proofs = []                      # V2 ZK verification
```

### Runtime Detection

```rust
// Backend: features.rs
pub struct Features {
    pub marketplace: bool,  // cfg!(feature = "marketplace")
    pub zk_proofs: bool,
    pub analytics: bool,
}
```

```typescript
// Frontend: useFeatures hook
const { marketplaceEnabled, zkProofsEnabled } = useFeatures();
```

## Configuration

### Node Config (NodeConfig struct)

| Field | Default | Description |
|-------|---------|-------------|
| `data_dir` | `~/.local/share/archivist/node` | Node data directory |
| `api_port` | `8080` | REST API port |
| `discovery_port` | `8090` | UDP port for DHT/mDNS peer discovery |
| `listen_port` | `8070` | TCP port for P2P connections |
| `max_storage_bytes` | 10GB | Storage quota |
| `auto_start` | `false` | Start node on app launch |
| `auto_restart` | `true` | Restart on failure |

### Sync Config

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable sync |
| `interval_secs` | `30` | Sync check interval |
| `batch_size` | `5` | Files per batch |

### Port Architecture

| Port | Protocol | Default | Purpose |
|------|----------|---------|---------|
| Listen Port | TCP | 8070 | P2P connections and file transfers |
| Discovery Port | UDP | 8090 | DHT/mDNS peer discovery |
| Manifest Server | TCP | 8085 | Exposes folder manifests for backup (source only) |
| Backup Trigger | TCP | 8086 | Receives backup notifications (backup server only) |

Multiaddr format uses the listen port: `/ip4/192.168.1.100/tcp/8070/p2p/16Uiu2HAm...`

Sidecar startup flags:
```bash
archivist --api-port=8080 --disc-port=8090 --listen-addrs=/ip4/0.0.0.0/tcp/8070 --nat=upnp
```

### Config File Locations

- **Linux**: `~/.config/archivist/config.toml`
- **macOS**: `~/Library/Application Support/archivist/config.toml`
- **Windows**: `%APPDATA%\archivist\config.toml`

### Configuration Synchronization

The app maintains two config structures that must stay in sync:
- **AppConfig** (persistent, on disk via `ConfigService` in `services/config.rs`) — user preferences
- **NodeConfig** (runtime, in-memory in `NodeService` in `services/node.rs`) — active sidecar config

Sync points: `AppState::new()` loads from disk → converts `NodeSettings` → `NodeConfig`. `save_config()` updates both disk and in-memory. Config changes require node restart to take effect.

## Development

```bash
# Frontend only
pnpm dev              # Vite dev server (port 1420)
pnpm build && pnpm lint && pnpm test

# Backend only
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# Full app
pnpm tauri dev        # Dev mode with hot reload
pnpm tauri build      # Production build
```

### Sidecar Binary

Download from durability-labs/archivist-node releases:
```bash
pnpm download-sidecar
# Or: bash scripts/download-sidecar.sh x86_64-pc-windows-msvc
```

| Platform | Release Archive | Sidecar Filename |
|----------|-----------------|------------------|
| Linux x64 | `archivist-v0.1.0-linux-amd64.tar.gz` | `archivist-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `archivist-v0.1.0-linux-arm64.tar.gz` | `archivist-aarch64-unknown-linux-gnu` |
| macOS Intel | `archivist-v0.1.0-darwin-amd64.tar.gz` | `archivist-x86_64-apple-darwin` |
| macOS ARM | `archivist-v0.1.0-darwin-arm64.tar.gz` | `archivist-aarch64-apple-darwin` |
| Windows x64 | `archivist-v0.1.0-windows-amd64-libs.zip` | `archivist-x86_64-pc-windows-msvc.exe` |

## Testing

```bash
# Frontend (Vitest + React Testing Library)
pnpm test              # Run tests
pnpm test:coverage     # Coverage report
# Config: vitest.config.ts | Tests: src/test/*.test.tsx | Setup: src/test/setup.ts

# Backend (Cargo Test)
cargo test --manifest-path src-tauri/Cargo.toml
# Unit tests: src-tauri/src/**/*.rs (#[cfg(test)]) | Integration: src-tauri/tests/*.rs
# Dev deps: tokio-test, mockall, tempfile, rstest, wiremock
```

Pre-commit hooks (Husky): TypeScript type check, ESLint, frontend tests, cargo fmt, clippy, backend tests. Bypass: `git commit --no-verify -m "message"`

## Windows Development

### MSVC Linker Conflict with Git

Git's `link.exe` can shadow the MSVC linker. Fix: create `src-tauri/.cargo/config.toml` (gitignored, machine-specific) with explicit MSVC paths:

```toml
[target.x86_64-pc-windows-msvc]
linker = "C:\\...\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe"
rustflags = [
    "-C", "link-arg=/LIBPATH:C:\\...\\Windows Kits\\10\\Lib\\10.0.26100.0\\um\\x64",
    "-C", "link-arg=/LIBPATH:C:\\...\\Windows Kits\\10\\Lib\\10.0.26100.0\\ucrt\\x64",
    "-C", "link-arg=/LIBPATH:C:\\...\\MSVC\\14.44.35207\\lib\\x64"
]
```

### File Locking (Error 32)

Windows locks files strictly. Log reading in `src-tauri/src/commands/node.rs` uses `FILE_SHARE_READ | FILE_SHARE_WRITE` flags via `OpenOptionsExt::share_mode(0x00000003)` to read logs while the sidecar writes.

## User Experience Features

### Onboarding System

**Files:** `src/pages/Onboarding.tsx`, `src/hooks/useOnboarding.ts`, `src/styles/Onboarding.css`

5-step flow: Splash → Welcome → Node Starting → Folder Selection → Syncing Progress. Goal: first backup in ≤30 seconds with ≤3 decisions.

**Key patterns:**
- **Video splash with CSS fallback**: Linux gets CSS fallback immediately (WebKitGTK unreliable). Windows/macOS play video via WebView2/Safari. Timeout: 2s before CSS fallback on non-Linux. Video loaded as blob URL to bypass Tauri asset protocol differences between debug/release builds.
- **Quickstart folder**: Creates `~/Documents/Archivist Quickstart/` with `welcome.txt`. Silently ignores "already being watched" errors on re-run.
- **State management**: `useOnboarding` hook uses `localStorage('onboarding_complete')` for first-run detection. Steps: `'splash' | 'welcome' | 'node-starting' | 'folder-select' | 'syncing'`.
- **Post-onboarding redirect**: Uses `localStorage` flag (`archivist_redirect_to_dashboard`) to communicate across Router context switches (onboarding vs main app use separate Router contexts). `OnboardingRedirect` component in `App.tsx` handles it.
- **Reset**: Settings → Developer → "Reset Onboarding" clears flag and reloads.
- **CSP for video**: `media-src` includes `blob: data:` for bundled builds.

### Auto-Trigger Download on CID Paste

**Files:** `src/pages/Files.tsx`, `src/lib/cidValidation.ts`

Paste CID → auto-triggers save dialog after 300ms validation. Uses `onPaste` handler (not `useEffect`) for clear user intent. CID validation: starts with `z` (CIDv1) or `Q` (CIDv0), 46-100 chars, base58 only. Green/red border feedback. Manual download button remains as fallback.

### Sound Notifications

**Files:** `src/hooks/useSoundNotifications.ts`

Web Audio API generates tones for three Tauri events emitted from Rust backend:
- `node-started` → C5-E5-G5 chord (from `services/node.rs`)
- `peer-connected` → A4-C#5 sequence (from `commands/peers.rs`)
- `file-downloaded` → A5-B5 sequence (from `commands/files.rs`)

Config in `NotificationSettings` struct (`services/config.rs`): master toggle, per-event toggles, volume slider.

### Navigation Structure

- **Primary**: Dashboard, Backups (renamed from Sync), Restore (renamed from Files), Media Download
- **Devices**: My Devices, Add Device
- **Advanced**: Collapsible accordion (Logs, Backup Server, Settings)
- Peers page consolidated into Devices page (route kept at `/peers` for backwards compat)
- Dashboard uses `usePeers` hook for actual connected peer count (not `status.peerCount` which is never populated)

### Media Download (yt-dlp Integration)

**Files:** `src/pages/MediaDownload.tsx`, `src/hooks/useMediaDownload.ts`, `src/styles/MediaDownload.css`, `src-tauri/src/services/binary_manager.rs`, `src-tauri/src/services/media_download.rs`, `src-tauri/src/commands/media.rs`

Download video/audio from hundreds of sites (YouTube, etc.) using yt-dlp and ffmpeg. Binaries are downloaded at runtime on first use (not bundled), keeping the installer small.

**Key patterns:**
- **Binary management**: `BinaryManager` downloads yt-dlp/ffmpeg to `~/.local/share/archivist/bin/`. Platform-specific binary names and download URLs from GitHub releases. Emits `binary-download-progress` events for UI feedback.
- **Metadata fetch**: Spawns `yt-dlp -j --no-playlist --no-warnings <url>`, parses JSON into `MediaMetadata` with `formats` array. Quality labels computed from resolution/bitrate.
- **Download queue**: `MediaDownloadService` manages concurrent downloads (default max 3). Background loop in `lib.rs` calls `process_queue()` every 1s. Each download spawns `yt-dlp` with `--newline` flag and monitors stdout for progress (`[download] XX.X% of ~YYY at ZZZ ETA MM:SS`).
- **Cancellation**: Stores PIDs in `HashMap<String, u32>`. Uses `libc::kill` (Unix) or `taskkill /F /PID` (Windows) for cross-platform process termination.
- **Audio extraction**: `yt-dlp -x --audio-format <fmt>` with ffmpeg for MP3/M4A/OPUS/WAV.
- **Events**: `media-download-progress` (progress/speed/eta), `media-download-state-changed` (state transitions).
- **Config**: `MediaDownloadSettings` in `services/config.rs` — `max_concurrent_downloads` (3), `default_video_format` ("best"), `default_audio_format` ("mp3").
- **State**: `Arc<RwLock<MediaDownloadService>>` in `AppState`, same pattern as other services.

**UI sections:**
1. Setup banner (if yt-dlp not installed) with install button
2. URL input + metadata preview (thumbnail, title, duration, format selector, audio-only toggle)
3. Download queue with progress bars, state badges, cancel/remove/clear buttons

**Binary locations:**
- Linux: `~/.local/share/archivist/bin/yt-dlp`, `~/.local/share/archivist/bin/ffmpeg`
- macOS: `~/Library/Application Support/archivist/bin/yt-dlp_macos`, `~/Library/Application Support/archivist/bin/ffmpeg`
- Windows: `%APPDATA%\archivist\bin\yt-dlp.exe`, `%APPDATA%\archivist\bin\ffmpeg.exe`

## Backup System

Manifest-based backup from source peer(s) to a designated backup server. Full architecture details: see [CLAUDE-FULL.md](CLAUDE-FULL.md).

**Key services:**
- `services/backup_daemon.rs` (~780 lines): Polls source peers for manifests, downloads files concurrently, state persistence in `backup-daemon-state.json`
- `services/manifest_server.rs`: HTTP server with IP whitelist exposing folder manifest CIDs
- `services/sync.rs`: Manifest generation, deletion tracking (tombstones), change counting with threshold trigger

**Daemon commands:** `enable_backup_daemon`, `disable_backup_daemon`, `pause_backup_daemon`, `resume_backup_daemon`, `get_backup_daemon_state`, `retry_failed_manifest`. Enable/disable persists to config file (not just in-memory).

**Dashboard UI:** `src/pages/BackupServer.tsx` — stats cards, in-progress/failed/processed manifests tables, auto-refresh every 5s.

## Key Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/node_api.rs` | HTTP client for sidecar API |
| `src-tauri/src/services/sync.rs` | File watching + upload queue |
| `src-tauri/src/services/node.rs` | Sidecar process management |
| `src-tauri/src/services/config.rs` | Settings persistence and configuration |
| `src-tauri/src/services/backup_daemon.rs` | Backup daemon that polls source peers for manifests |
| `src-tauri/src/services/manifest_server.rs` | HTTP manifest discovery server with IP whitelist |
| `src-tauri/src/services/binary_manager.rs` | yt-dlp/ffmpeg binary download and version management |
| `src-tauri/src/services/media_download.rs` | Media download queue, progress tracking, metadata |
| `src-tauri/src/commands/media.rs` | Media download Tauri commands |
| `src-tauri/src/commands/node.rs` | Node control commands including diagnostics and logs |
| `src-tauri/src/commands/files.rs` | File upload/download commands with event emissions |
| `src-tauri/src/commands/peers.rs` | Peer connection commands with event emissions |
| `src-tauri/src/state.rs` | AppState initialization and config sync |
| `src/hooks/useNode.ts` | Node state management hook |
| `src/hooks/useSync.ts` | Sync state management hook |
| `src/hooks/useOnboarding.ts` | Onboarding state management (first-run detection, steps) |
| `src/hooks/useSoundNotifications.ts` | Sound notification event listener hook |
| `src/lib/cidValidation.ts` | CID format validation utility |
| `src/pages/Dashboard.tsx` | Main UI with diagnostics panel and NextSteps |
| `src/pages/Files.tsx` | File management with auto-download on paste |
| `src/pages/Onboarding.tsx` | First-run wizard with video/CSS splash |
| `src/pages/Devices.tsx` | Device management (this device + connected devices) |
| `src/pages/AddDevice.tsx` | Step-by-step device pairing wizard |
| `src/pages/Logs.tsx` | Real-time node logs viewer |
| `src/pages/Settings.tsx` | App configuration with notification settings |
| `src/pages/MediaDownload.tsx` | Media download UI (URL input, metadata, queue) |
| `src/hooks/useMediaDownload.ts` | Media download state management and polling |
| `src/styles/MediaDownload.css` | Media download terminal aesthetic styling |
| `src/pages/BackupServer.tsx` | Backup daemon monitoring dashboard |
| `src/components/NextSteps.tsx` | Post-onboarding guidance cards |
| `src/components/NavAccordion.tsx` | Collapsible navigation section |
| `src/styles/Onboarding.css` | Onboarding styles with CSS fallback animation |
| `src/styles/App.css` | Global styles, CID validation styling |
| `scripts/download-sidecar.sh` | Sidecar binary downloader |
| `src-tauri/tauri.conf.json` | Tauri app configuration |

## Error Handling

Rust errors are defined in `src-tauri/src/error.rs`:

```rust
pub enum ArchivistError {
    NodeNotRunning,
    NodeAlreadyRunning,
    NodeStartFailed(String),
    FileNotFound(String),
    ApiError(String),
    SyncError(String),
    MediaDownloadError(String),
    BinaryNotFound(String),
    // ... etc
}
```

All errors serialize to JSON for frontend consumption.
