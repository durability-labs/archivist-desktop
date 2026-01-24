# Archivist Desktop

A cross-platform desktop application for decentralized file storage, built with Tauri v2, React, and TypeScript.

> **WARNING: Alpha Software - Pilot Program**
>
> This software is in **alpha stage** and is part of the pilot program. **Do not use this for mission-critical data or personal files that you cannot afford to lose.**
>
> - Data loss may occur due to bugs, incomplete features, or network issues
> - There is no guarantee of data persistence or recovery
> - Always maintain separate backups of important files
> - This software is provided "as-is" without warranty of any kind
>
> By using this software, you acknowledge and accept these risks.

## Features

- **Guided Onboarding**: First-run wizard to get your first backup in under 30 seconds
- **File Management**: Upload, download, and manage files on the decentralized network
- **Folder Sync**: Watch folders and automatically sync changes to the network
- **Backup Server**: Automatic continuous backup to designated peers
- **Peer Network**: Connect with peers, share SPR records, and monitor network stats
- **Node Logs**: Built-in real-time log viewer with auto-refresh and auto-scroll
- **System Tray**: Runs in the background with quick access from the system tray
- **Auto-Update**: Automatic updates from GitHub releases
- **Sound Notifications**: Audio feedback for node startup, peer connections, and downloads

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Rust + Tauri v2 |
| Sidecar | archivist-node (P2P storage daemon) |
| Package Manager | pnpm v10 |
| Node.js | v20 |
| Rust | 1.77.2+ stable |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│              Archivist Desktop (Tauri App)               │
│                                                          │
│  ┌────────────────────┐      ┌────────────────────────┐ │
│  │  React Frontend    │      │   Rust Backend         │ │
│  │  (Webview)         │◄────►│   (Native Process)     │ │
│  │                    │ IPC  │                        │ │
│  │ • Dashboard        │      │ • Node Management      │ │
│  │ • Backups          │      │ • File Operations      │ │
│  │ • Restore          │      │ • Folder Watching      │ │
│  │ • Devices          │      │ • Peer Management      │ │
│  │ • Peers            │      │ • Backup Daemon        │ │
│  │ • Logs             │      │ • Configuration        │ │
│  │ • Settings         │      │ • HTTP Client          │ │
│  └────────────────────┘      └───────────┬────────────┘ │
│                                          │              │
└──────────────────────────────────────────┼──────────────┘
                                           │
                                  HTTP (localhost:8080)
                                           │
┌──────────────────────────────────────────▼──────────────┐
│           archivist-node Sidecar (Separate Process)     │
│                                                          │
│  • REST API (port 8080)                                 │
│  • File Storage & CID Management                        │
│  • P2P Network (libp2p)                                 │
│  • Discovery (DHT/mDNS, UDP port 8090)                  │
│  • Listen (TCP port 8070)                               │
│  • Peer Connections                                     │
│  • Data Replication                                     │
└──────────────────────────────────────────┬──────────────┘
                                           │
                                   P2P (encrypted)
                                           │
                              ┌────────────▼────────────┐
                              │   External Peers        │
                              │   (libp2p network)      │
                              └─────────────────────────┘
```

### How It Works

1. **User Interface**: React frontend provides the UI (Dashboard, Backups, Restore, Devices, Peers, Logs, Settings)
2. **Tauri Backend**: Rust backend handles:
   - Starting/stopping the archivist-node sidecar process
   - Managing file system operations (uploads, downloads, folder watching)
   - Proxying requests to the node's REST API
   - Persisting application configuration
   - Running the backup daemon for continuous sync
3. **Archivist Node**: Standalone sidecar process that:
   - Exposes REST API on localhost:8080
   - Manages content-addressed storage (CIDs)
   - Handles P2P networking via libp2p
   - Discovers peers via DHT/mDNS on UDP port 8090
   - Accepts peer connections on TCP port 8070
   - Replicates data across the network
4. **P2P Network**: Encrypted libp2p connections between peers for file transfer and discovery

## Development

### Prerequisites

- Node.js 20+
- pnpm v10+
- Rust 1.77.2+ stable
- Platform-specific dependencies for Tauri (see [Tauri Prerequisites](https://tauri.app/start/prerequisites/))

### Setup

```bash
# Quick setup (install deps + download sidecar binary)
pnpm setup

# Or step by step:
pnpm install
pnpm download-sidecar  # Downloads archivist-node for your platform

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

### Cross-Platform Builds

The sidecar binary must match your target platform. To download for cross-compilation:

```bash
# macOS
bash scripts/download-sidecar.sh x86_64-apple-darwin      # Intel
bash scripts/download-sidecar.sh aarch64-apple-darwin     # Apple Silicon

# Linux
bash scripts/download-sidecar.sh x86_64-unknown-linux-gnu   # x64
bash scripts/download-sidecar.sh aarch64-unknown-linux-gnu  # ARM64

# Windows
bash scripts/download-sidecar.sh x86_64-pc-windows-msvc
```

### Project Structure

```
archivist-desktop/
├── src/                          # React frontend
│   ├── components/               # Reusable UI components
│   │   ├── NavAccordion.tsx     # Collapsible navigation sections
│   │   └── NextSteps.tsx        # Post-onboarding guidance
│   ├── hooks/                    # Custom React hooks
│   │   ├── useNode.ts           # Node lifecycle (start/stop/status)
│   │   ├── useSync.ts           # Folder watching + sync queue
│   │   ├── usePeers.ts          # Peer connections
│   │   ├── useOnboarding.ts     # First-run onboarding state
│   │   ├── useSoundNotifications.ts  # Audio feedback
│   │   └── useFeatures.ts       # Feature flag detection
│   ├── pages/                    # Route components
│   │   ├── Dashboard.tsx        # Main status overview
│   │   ├── Onboarding.tsx       # First-run wizard
│   │   ├── Files.tsx            # Upload/download/restore files
│   │   ├── Sync.tsx             # Watched folder management
│   │   ├── Devices.tsx          # Device management
│   │   ├── AddDevice.tsx        # Device pairing wizard
│   │   ├── Peers.tsx            # P2P network view
│   │   ├── BackupServer.tsx     # Backup daemon dashboard
│   │   ├── Logs.tsx             # Node logs viewer
│   │   └── Settings.tsx         # App configuration
│   ├── lib/                      # Utilities and types
│   │   ├── cidValidation.ts     # CID format validation
│   │   └── tauri.ts             # Tauri invoke helpers
│   ├── styles/                   # CSS files (terminal aesthetic)
│   ├── App.tsx                   # Router + layout
│   └── main.tsx                  # Entry point
│
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs              # App entry (delegates to lib.rs)
│   │   ├── lib.rs               # Tauri setup, commands, tray
│   │   ├── error.rs             # ArchivistError enum
│   │   ├── state.rs             # AppState (service container)
│   │   ├── node_api.rs          # HTTP client for sidecar
│   │   ├── commands/            # Tauri command handlers
│   │   │   ├── node.rs          # start/stop/restart/status/logs
│   │   │   ├── files.rs         # upload/download/list/delete
│   │   │   ├── sync.rs          # watch folders, sync queue, manifests
│   │   │   ├── peers.rs         # connect/disconnect/list
│   │   │   └── system.rs        # config, platform info
│   │   └── services/            # Business logic
│   │       ├── node.rs          # Sidecar process management
│   │       ├── sync.rs          # File watching (notify crate)
│   │       ├── config.rs        # Settings persistence
│   │       ├── backup_daemon.rs # Backup daemon (polls source peers)
│   │       └── manifest_server.rs # HTTP manifest discovery server
│   ├── resources/               # Bundled assets (video files)
│   ├── sidecars/                # archivist-node binaries (gitignored)
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri configuration
│
├── public/                       # Static assets
│   └── logos/                   # Branding assets
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

## Configuration

### Config File Locations

- **Linux**: `~/.config/archivist/config.toml`
- **macOS**: `~/Library/Application Support/archivist/config.toml`
- **Windows**: `%APPDATA%\archivist\config.toml`

### Node Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `data_dir` | Platform-specific | Node data directory |
| `api_port` | `8080` | REST API port |
| `discovery_port` | `8090` | UDP port for DHT/mDNS peer discovery |
| `listen_port` | `8070` | TCP port for P2P connections |
| `max_storage_bytes` | 10 GB | Storage quota |
| `auto_start` | `false` | Start node on app launch |
| `auto_restart` | `true` | Restart on failure |

**Note**: Configuration changes require a node restart to take effect.

### Backup Server Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Enable backup daemon |
| `poll_interval_secs` | `30` | Check for new manifests every N seconds |
| `max_concurrent_downloads` | `3` | Parallel file downloads |
| `max_retries` | `3` | Retry failed downloads |
| `auto_delete_tombstones` | `true` | Process file deletions |

## Network Setup

The application uses multiple ports for P2P networking and backup functionality:

| Port | Protocol | Purpose | Required On |
|------|----------|---------|-------------|
| 8070 | TCP | P2P connections and file transfers | Both machines |
| 8090 | UDP | Discovery via DHT/mDNS | Both machines |
| 8085 | TCP | Manifest server (backup source) | Source machine only |
| 8086 | TCP | Backup trigger endpoint | Backup server only |

**Minimum required**: Open ports 8070 (TCP) and 8090 (UDP) for basic P2P functionality.

**For backup system**: Also open 8085 on the source machine and 8086 on the backup server.

### Linux (UFW)

```bash
# Required for P2P
sudo ufw allow 8070/tcp  # P2P connections
sudo ufw allow 8090/udp  # Discovery

# For backup source (Machine A)
sudo ufw allow 8085/tcp  # Manifest server

# For backup server (Machine B)
sudo ufw allow 8086/tcp  # Backup trigger
```

### macOS

The firewall will prompt you to allow connections when the app first runs. Click "Allow" to enable P2P connectivity.

### Windows (PowerShell as Administrator)

```powershell
# Required for P2P
netsh advfirewall firewall add rule name="Archivist P2P" dir=in action=allow protocol=tcp localport=8070
netsh advfirewall firewall add rule name="Archivist Discovery" dir=in action=allow protocol=udp localport=8090

# For backup source (Machine A)
netsh advfirewall firewall add rule name="Archivist Manifest Server" dir=in action=allow protocol=tcp localport=8085

# For backup server (Machine B)
netsh advfirewall firewall add rule name="Archivist Backup Trigger" dir=in action=allow protocol=tcp localport=8086
```

If you change the ports in Settings → Advanced, update your firewall rules accordingly.

## Backup Server Flow

The backup server daemon enables automatic continuous backup from source peers to a designated backup server.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MACHINE A (Source Peer)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐                                                  │
│  │  Watch Folder    │  1. User adds files                              │
│  │  ~/Documents/    │────────────────┐                                 │
│  └──────────────────┘                │                                 │
│           │                           ▼                                 │
│           │ 2. File watcher      ┌────────────────┐                    │
│           │    detects changes   │  Sync Service  │                    │
│           └─────────────────────►│  (Desktop App) │                    │
│                                  └────────┬───────┘                    │
│                                           │ 3. Upload files             │
│                                           │    (POST /data)             │
│                                           ▼                             │
│                                  ┌────────────────┐                    │
│                                  │ archivist-node │                    │
│                                  │  (Port 8080)   │                    │
│                                  └────────┬───────┘                    │
│                                           │                             │
│                                           │ 4. Store files as CIDs      │
│                                           │    file1.txt → zdj7W...    │
│                                           │    file2.pdf → zDvZR...    │
│                                           │                             │
│  ┌──────────────────────────────┐        │                             │
│  │ After 10 file changes:       │◄───────┘ 5. Threshold reached        │
│  │                              │                                       │
│  │ Generate manifest file:      │                                       │
│  │ .archivist-manifest-{id}.json│                                       │
│  │                              │                                       │
│  │ {                            │                                       │
│  │   "source_peer_id": "16Uiu..│                                       │
│  │   "sequence_number": 1,      │                                       │
│  │   "files": [                 │                                       │
│  │     {"path": "file1.txt",    │                                       │
│  │      "cid": "zdj7W..."},     │                                       │
│  │     {"path": "file2.pdf",    │                                       │
│  │      "cid": "zDvZR..."}      │                                       │
│  │   ]                          │                                       │
│  │ }                            │                                       │
│  └──────────────┬───────────────┘                                       │
│                 │                                                       │
│                 │ 6. Upload manifest                                    │
│                 │    (POST /data)                                       │
│                 ▼                                                       │
│        ┌────────────────┐                                              │
│        │ archivist-node │                                              │
│        │  Manifest CID: │                                              │
│        │  zDvZRwzm...   │                                              │
│        └────────┬───────┘                                              │
│                 │                                                       │
│                 │ 7. Create storage request                            │
│                 │    for backup peer                                   │
│                 │                                                       │
└─────────────────┼───────────────────────────────────────────────────────┘
                  │
                  │ 8. P2P Network
                  │    (libp2p encrypted)
                  │
┌─────────────────▼───────────────────────────────────────────────────────┐
│                        MACHINE B (Backup Server)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────────────────┐                                │
│  │      Backup Daemon (Background)    │                                │
│  │   ┌────────────────────────────┐   │                                │
│  │   │ Every 30 seconds:          │   │  9. Poll for manifests         │
│  │   │ GET /data                  │───┼─────────────┐                  │
│  │   │ Filter: *.manifest*.json   │   │             │                  │
│  │   └────────────────────────────┘   │             │                  │
│  └────────────────┬───────────────────┘             │                  │
│                   │                                  ▼                  │
│                   │ 10. Manifest     ┌───────────────────────┐         │
│                   │     discovered   │   archivist-node      │         │
│                   │                  │   (Port 8080)         │         │
│                   │                  │                       │         │
│                   │                  │ Files stored:         │         │
│                   │                  │ • manifest.json       │         │
│                   │                  │ • file1.txt (zdj7W)   │         │
│                   │                  │ • file2.pdf (zDvZR)   │         │
│                   │                  └───────────────────────┘         │
│                   │                                                     │
│                   │ 11. Parse manifest                                 │
│                   │     Extract CID list                               │
│                   │                                                     │
│                   ▼                                                     │
│  ┌────────────────────────────────┐                                    │
│  │  Download missing files        │  12. For each CID:                 │
│  │  (3 concurrent downloads)      │      POST /data/{cid}/network      │
│  │                                │                                    │
│  │  zdj7W... ▓▓▓▓▓▓▓▓░░ 80%      │      (Download from network        │
│  │  zDvZR... ▓▓▓▓▓▓▓▓▓▓ 100%     │       via P2P from Machine A)      │
│  │  zDpuA... ▓░░░░░░░░░ 10%      │                                    │
│  └────────────────┬───────────────┘                                    │
│                   │                                                     │
│                   │ 13. Update state                                   │
│                   ▼                                                     │
│  ┌────────────────────────────────┐                                    │
│  │  backup-daemon-state.json      │                                    │
│  │                                │                                    │
│  │  {                             │                                    │
│  │    "processed_manifests": {    │                                    │
│  │      "zDvZRwzm...": {          │                                    │
│  │        "source_peer_id": "...", │                                    │
│  │        "sequence_number": 1,   │                                    │
│  │        "file_count": 15,       │                                    │
│  │        "total_size_bytes": ... │                                    │
│  │      }                          │                                    │
│  │    },                           │                                    │
│  │    "stats": {                   │                                    │
│  │      "total_manifests": 1,     │                                    │
│  │      "total_files": 15,        │                                    │
│  │      "total_bytes": ...        │                                    │
│  │    }                            │                                    │
│  │  }                             │                                    │
│  └────────────────────────────────┘                                    │
│                                                                         │
│  ┌────────────────────────────────┐                                    │
│  │  Backup Server Dashboard       │  14. User views status             │
│  │  (http://localhost:1420)       │                                    │
│  │                                │                                    │
│  │  Manifests Processed: 1        │                                    │
│  │  Files Downloaded: 15          │                                    │
│  │  Total Size: 2.4 MB            │                                    │
│  │                                │                                    │
│  │  Processed Manifests           │                                    │
│  │  Source: 16Uiu2HAm... (Seq #1) │                                    │
│  │  Files: 15 | Size: 2.4 MB      │                                    │
│  └────────────────────────────────┘                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Process

**Machine A (Source Peer)**:

1. User adds files to watched folder
2. File watcher detects changes (create/modify/delete)
3. Sync service uploads files to local archivist-node via POST `/data`
4. Node stores files and returns CIDs (content identifiers)
5. After 10 file changes (configurable threshold), manifest is generated
6. Manifest file created: `.archivist-manifest-{peer_id}.json` containing:
   - Source peer ID
   - Sequence number (increments with each update)
   - List of all files with their CIDs
   - Deleted files (tombstones for cleanup)
7. Manifest uploaded to local node, gets its own CID
8. Storage request created for backup peer (if configured)

**P2P Network**:

- Manifest propagates through libp2p network
- Peers exchange data using encrypted connections
- Content-addressed storage ensures data integrity

**Machine B (Backup Server)**:

9. Backup daemon polls `/data` endpoint every 30 seconds
10. Discovers new manifest files (filter: `*.manifest*.json`)
11. Downloads and parses manifest to extract CID list
12. For each CID in manifest:
    - Check if already stored locally
    - If missing: POST `/data/{cid}/network` to download from network
    - Downloads happen concurrently (3 at a time by default)
13. Updates daemon state file with:
    - Processed manifests
    - Statistics (files downloaded, bytes, etc.)
    - Failed downloads (for retry)
14. Dashboard displays real-time backup status

### Source Peer Configuration

```toml
# In config.toml on Machine A
[sync]
backup_enabled = true
backup_peer_address = "spr:CiUIAhIhAml6..."  # Machine B's SPR
backup_manifest_enabled = true
backup_auto_notify = true
manifest_update_threshold = 10  # Generate manifest after N file changes
```

### Backup Server Configuration

```toml
# In config.toml on Machine B
[backup_server]
enabled = true
poll_interval_secs = 30          # Check for new manifests every 30s
max_concurrent_downloads = 3     # Download 3 files at once
max_retries = 3                  # Retry failed downloads 3 times
auto_delete_tombstones = true    # Process file deletions
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Event-Driven** | Manifests generated automatically after threshold reached |
| **Continuous Sync** | New files trigger manifest updates without manual intervention |
| **Deletion Tracking** | Deleted files tracked in manifest for proper cleanup |
| **Sequence Numbers** | Detect gaps and ensure proper ordering |
| **Retry Mechanism** | Failed downloads automatically retried with backoff |
| **Concurrent Downloads** | Multiple files downloaded in parallel for speed |
| **State Persistence** | Daemon state saved to disk, survives restarts |
| **Real-Time Dashboard** | Monitor backup progress with auto-refreshing UI |
| **n:1 Fan-In** | Multiple source peers can backup to single server |
| **Content Deduplication** | Same file content = same CID = stored once |

### Network Requirements

For cross-network backup (Machine A → Internet → Machine B):

1. **Machine A (Source)** port forwarding:
   - Forward external port 8070 (TCP) → Machine A's local IP:8070 (P2P)
   - Forward external port 8085 (TCP) → Machine A's local IP:8085 (Manifest server)

2. **Machine B (Backup Server)** port forwarding:
   - Forward external port 8070 (TCP) → Machine B's local IP:8070 (P2P)
   - Forward external port 8086 (TCP) → Machine B's local IP:8086 (Backup trigger, optional)

3. **Firewall rules**:
   - **Machine A**: Allow TCP 8070, 8085 and UDP 8090
   - **Machine B**: Allow TCP 8070, 8086 and UDP 8090

4. **Connection tip**: If NAT traversal fails in one direction, try connecting from the other machine first. The machine with more permissive NAT/firewall should initiate the P2P connection.

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Port 8080 in use | Change API port in Settings → Advanced |
| Sidecar not found | Run `pnpm download-sidecar` |
| 0 addresses found | Check firewall allows ports 8090 (UDP) and 8070 (TCP) |
| Peer connects then disconnects | Check NAT timeout, try reconnecting with fresh SPR |

### Logs

Node logs are written to:

- **Linux**: `~/.local/share/archivist/node.log`
- **macOS**: `~/Library/Application Support/archivist/node.log`
- **Windows**: `%APPDATA%\archivist\node.log`

Use the built-in Logs page for real-time viewing with auto-refresh.

## Resources

- **GitHub Repository**: https://github.com/durability-labs/archivist-desktop
- **Sidecar Repository**: https://github.com/durability-labs/archivist-node
- **Developer Documentation**: See [CLAUDE.md](CLAUDE.md) for comprehensive technical docs

## License

MIT

---

*This software is provided for evaluation and testing purposes as part of the pilot program. See the warning at the top of this document regarding data safety.*
