# Archivist Desktop

Tauri v2 desktop application for decentralized file storage with P2P sync capabilities.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
5. [Archivist-Node API Reference](#archivist-node-api-reference)
6. [Tauri Commands](#tauri-commands)
7. [Feature Flags](#feature-flags)
8. [Configuration](#configuration)
9. [Development](#development)
10. [Testing & Quality](#testing--quality)
11. [CI/CD Pipeline](#cicd-pipeline)
12. [Build & Release](#build--release)
13. [P2P Testing Guide](#p2p-testing-guide)
14. [Backup to Designated Peer with Continuous Sync](#backup-to-designated-peer-with-continuous-sync)
15. [Backup Server Daemon](#backup-server-daemon)
16. [Windows Development](#windows-development)
17. [User Experience Features](#user-experience-features)
    - [Onboarding System](#onboarding-system)
    - [Auto-Trigger Download on CID Paste](#auto-trigger-download-on-cid-paste)
    - [Sound Notifications](#sound-notifications)
18. [Troubleshooting](#troubleshooting)
19. [Security](#security)
20. [Version History](#version-history)

---

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
│   │   └── useWallet.ts         # V2 wallet (stub)
│   ├── pages/                    # Route components
│   │   ├── Dashboard.tsx        # Main status overview
│   │   ├── Files.tsx            # Upload/download/list files
│   │   ├── Sync.tsx             # Watched folder management
│   │   ├── Peers.tsx            # P2P network view
│   │   ├── Logs.tsx             # Node logs viewer
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
│   │   │   └── system.rs        # config, platform info
│   │   └── services/            # Business logic
│   │       ├── node.rs          # Sidecar process management
│   │       ├── files.rs         # File operations via API
│   │       ├── sync.rs          # File watching (notify crate)
│   │       ├── peers.rs         # Peer management
│   │       ├── config.rs        # Settings persistence
│   │       ├── backup_daemon.rs # Backup daemon (polls source peers)
│   │       └── manifest_server.rs # HTTP manifest discovery server
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

### Quick Reference

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
| `/connect/{peerId}` | GET | Connect to peer |
| `/sales/slots` | GET | Get active storage slots |
| `/sales/availability` | GET/POST | Manage storage availability |
| `/storage/request/{cid}` | POST | Create storage request |
| `/storage/purchases` | GET | List purchases |

### Upload Format

**IMPORTANT:** Raw binary body (not multipart/form-data)

```bash
curl -X POST \
  -H "Content-Type: application/octet-stream" \
  -H "Content-Disposition: attachment; filename=\"test.txt\"" \
  --data-binary @test.txt \
  http://127.0.0.1:8080/api/archivist/v1/data
```

**Headers:**
- `Content-Type`: MIME type (e.g., `text/plain`, `application/octet-stream`)
- `Content-Disposition`: `attachment; filename="example.txt"`

**Response:** CID as plain text (e.g., `zdj7W...`)

### Key Endpoints Detail

#### Get Debug Info
```bash
curl http://127.0.0.1:8080/api/archivist/v1/debug/info
```

**Response:**
```json
{
  "id": "16Uiu2HAmXYZ...",
  "addrs": ["/ip4/127.0.0.1/tcp/8070", "/ip4/192.168.0.1/tcp/8070"],
  "repo": "/home/user/.local/share/archivist/node",
  "spr": "spr:CiUIAhI...",
  "announceAddresses": [...],
  "ethAddress": "0x...",
  "archivist": {
    "version": "v0.1.0",
    "revision": "abc123",
    "contracts": "def456"
  }
}
```

#### Get Storage Space
```bash
curl http://127.0.0.1:8080/api/archivist/v1/space
```

**Response:**
```json
{
  "totalBlocks": 1000,
  "quotaMaxBytes": 10737418240,
  "quotaUsedBytes": 1073741824,
  "quotaReservedBytes": 0
}
```

#### Connect to Peer
```bash
# Using peer discovery
curl "http://127.0.0.1:8080/api/archivist/v1/connect/16Uiu2HAmXYZ..."

# With specific address
curl "http://127.0.0.1:8080/api/archivist/v1/connect/16Uiu2HAmXYZ...?addrs[]=/ip4/192.168.0.42/tcp/37311"
```

### Response Models

#### DataItem
```json
{
  "cid": "string",
  "manifest": {
    "treeCid": "string",
    "datasetSize": "integer",
    "blockSize": "integer",
    "protected": "boolean",
    "filename": "string (optional)",
    "mimetype": "string (optional)"
  }
}
```

#### DataList
```json
{
  "content": [
    {
      "cid": "string",
      "manifest": {...}
    }
  ]
}
```

#### NodeInfo (from /debug/info)
**Important:** This is the actual response from archivist-node v0.2.0. The Desktop app's `NodeInfo` struct must match this format.

```json
{
  "id": "16Uiu2HAmXYZ...",
  "addrs": [
    "/ip4/127.0.0.1/tcp/8070",
    "/ip4/192.168.0.1/tcp/8070"
  ],
  "repo": "/home/user/.local/share/archivist/node",
  "spr": "spr:CiUIAhI...",
  "announceAddresses": [
    "/ip4/192.168.0.1/tcp/8070"
  ],
  "ethAddress": "0x...",
  "archivist": {
    "version": "v0.1.0",
    "revision": "abc123",
    "contracts": "def456"
  }
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

**Usage:**
```rust
// Get peer ID for manifest generation
let node_info = api_client.get_info().await?;
let peer_id = node_info.id;  // Direct access to id field

// Get addresses
let addresses = node_info.addrs;

// Get version
let version = node_info.archivist
    .as_ref()
    .map(|a| a.version.clone());
```

## Tauri Commands

Commands are invoked from frontend via `@tauri-apps/api`:

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

## Feature Flags

### Compile-time (Cargo.toml)

```toml
[features]
default = []
marketplace = ["ethers", "alloy"]  # V2 blockchain
zk-proofs = []                      # V2 ZK verification
```

Build with: `cargo build --features marketplace`

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

The application uses **four ports** for P2P networking and backup functionality:

| Port | Protocol | Default | Purpose |
|------|----------|---------|---------|
| Listen Port | TCP | 8070 | P2P connections and file transfers |
| Discovery Port | UDP | 8090 | DHT/mDNS peer discovery |
| Manifest Server | TCP | 8085 | Exposes folder manifests for backup (Machine A) |
| Backup Trigger | TCP | 8086 | Receives backup notifications (Machine B) |

#### Listen Port (TCP - Default: 8070)
- **Purpose**: Actual P2P data connections and file transfers
- **Protocol**: TCP
- **Command-line flag**: `--listen-addrs=/ip4/0.0.0.0/tcp/8070`
- **Used for**: Establishing connections, transferring files, syncing data
- **Configuration**: `listen_port` in NodeConfig/NodeSettings

#### Discovery Port (UDP - Default: 8090)
- **Purpose**: Peer discovery via DHT (Distributed Hash Table) and mDNS
- **Protocol**: UDP
- **Command-line flag**: `--disc-port=8090`
- **Used for**: Finding other nodes on the network, announcing presence
- **Configuration**: `discovery_port` in NodeConfig/NodeSettings

#### Manifest Server Port (TCP - Default: 8085)
- **Purpose**: HTTP server exposing folder manifest CIDs for backup discovery
- **Protocol**: TCP (HTTP)
- **Used for**: Backup server polling for new manifests from source peers
- **Configuration**: Settings → Manifest Server → Port
- **Security**: IP whitelist restricts access to authorized backup servers
- **Required on**: Machine A (source/primary) only

#### Backup Trigger Port (TCP - Default: 8086)
- **Purpose**: Receives backup trigger notifications from source peers
- **Protocol**: TCP (HTTP)
- **Used for**: Immediate backup notification when new manifest available
- **Configuration**: Settings → Backup Server
- **Required on**: Machine B (backup server) only

#### Why Multiple Ports?

1. **Protocol Separation**: UDP for lightweight discovery, TCP for reliable data transfer
2. **Network Flexibility**: Some networks may treat UDP and TCP differently
3. **Firewall Optimization**: Allows granular control over discovery vs data traffic
4. **Port Forwarding**: Can forward only the listen port for direct connections while using discovery locally
5. **Backup Architecture**: Separate ports for manifest discovery (8085) and backup triggering (8086)

#### Multiaddr Format

When connecting to peers, the multiaddr includes the **listen port** (TCP):
```
/ip4/192.168.1.100/tcp/8070/p2p/16Uiu2HAm...
```

The discovery port is not included in multiaddrs as it's used automatically by the DHT.

#### Sidecar Startup

The archivist-node sidecar receives both ports:
```bash
archivist \
  --api-port=8080 \
  --disc-port=8090 \
  --listen-addrs=/ip4/0.0.0.0/tcp/8070 \
  --nat=upnp
```

### Config File Locations

- **Linux**: `~/.config/archivist/config.toml`
- **macOS**: `~/Library/Application Support/archivist/config.toml`
- **Windows**: `%APPDATA%\archivist\config.toml`

### Configuration Synchronization

The application maintains two configuration structures that must stay synchronized:

#### AppConfig (Persistent Storage)
- **Location**: Saved to disk in `config.toml`
- **Managed by**: `ConfigService` in `src-tauri/src/services/config.rs`
- **Contains**: `NodeSettings` (user-configurable fields)
- **Purpose**: Persists user preferences across app restarts

#### NodeConfig (Runtime Configuration)
- **Location**: In-memory in `NodeService`
- **Managed by**: `NodeService` in `src-tauri/src/services/node.rs`
- **Contains**: Full node configuration including runtime fields
- **Purpose**: Active configuration used when starting the sidecar

#### Synchronization Points

1. **App Startup** ([src-tauri/src/state.rs](src-tauri/src/state.rs#L17-L30))
   - `AppState::new()` loads `AppConfig` from disk via `ConfigService`
   - Converts `NodeSettings` → `NodeConfig` using `NodeConfig::from_node_settings()`
   - Initializes `NodeService` with the loaded configuration

2. **Settings Save** ([src-tauri/src/commands/system.rs](src-tauri/src/commands/system.rs#L13-L32))
   - `save_config()` command updates both:
     - Saves `AppConfig` to disk (persistent)
     - Syncs to `NodeService.config` (in-memory)
   - Logs the synchronized configuration

3. **Settings Reset** ([src-tauri/src/commands/system.rs](src-tauri/src/commands/system.rs#L36-L50))
   - `reset_config()` resets both:
     - Resets `AppConfig` to defaults on disk
     - Syncs defaults to `NodeService`

#### Configuration Flow Diagram

```
User Changes Settings in UI
        ↓
save_config(AppConfig)
        ↓
    ┌───────────────┬────────────────┐
    ↓               ↓                ↓
ConfigService  →  Disk        NodeService
(update)      (config.toml)   (set_config)
    ↓               ↓                ↓
Persistent    File System    In-Memory Config
Storage         Write          Used by Node
                                 ↓
                           Node Restart Required
                           to Apply Changes
```

**Important**: Configuration changes require a node restart to take effect. The node uses the `NodeConfig` values captured at startup time.

## Development

### Commands

```bash
# Frontend only
pnpm dev              # Vite dev server (port 1420)
pnpm build            # Build frontend
pnpm lint             # ESLint
pnpm test             # Vitest

# Backend only
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# Full app
pnpm tauri dev        # Dev mode with hot reload
pnpm tauri build      # Production build
```

### Sidecar Binary Management

The archivist-node sidecar is downloaded from the durability-labs/archivist-node releases.

#### Automatic Download

```bash
# Download for current platform
pnpm download-sidecar

# Or for specific target
bash scripts/download-sidecar.sh x86_64-apple-darwin
bash scripts/download-sidecar.sh aarch64-apple-darwin
bash scripts/download-sidecar.sh x86_64-pc-windows-msvc
```

#### Platform Mappings

| Platform | Release Archive | Sidecar Filename |
|----------|-----------------|------------------|
| Linux x64 | `archivist-v0.1.0-linux-amd64.tar.gz` | `archivist-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `archivist-v0.1.0-linux-arm64.tar.gz` | `archivist-aarch64-unknown-linux-gnu` |
| macOS Intel | `archivist-v0.1.0-darwin-amd64.tar.gz` | `archivist-x86_64-apple-darwin` |
| macOS Apple Silicon | `archivist-v0.1.0-darwin-arm64.tar.gz` | `archivist-aarch64-apple-darwin` |
| Windows x64 | `archivist-v0.1.0-windows-amd64-libs.zip` | `archivist-x86_64-pc-windows-msvc.exe` |

## Testing & Quality

### Test Infrastructure

#### Frontend (Vitest + React Testing Library)

```bash
pnpm test              # Run tests
pnpm test:ui           # Visual test runner
pnpm test:coverage     # Coverage report
```

**Configuration:** `vitest.config.ts`
**Tests:** `src/test/*.test.tsx`
**Setup:** `src/test/setup.ts` (Tauri API mocks)

#### Backend (Cargo Test)

```bash
cd src-tauri
cargo test             # Run all tests
cargo test --verbose   # Detailed output
```

**Unit tests:** Within `src-tauri/src/**/*.rs` using `#[cfg(test)]`
**Integration tests:** `src-tauri/tests/*.rs`

**Dev dependencies:**
- `tokio-test` - Async testing
- `mockall` - Mocking framework
- `tempfile` - Temporary file utilities
- `rstest` - Fixture-based testing
- `wiremock` - HTTP mocking

### Writing Tests

#### Frontend Example

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useNode } from './useNode';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core');

describe('useNode', () => {
  it('fetches node status', async () => {
    const mockStatus = { state: 'running', uptime: 3600 };
    vi.mocked(invoke).mockResolvedValue(mockStatus);

    const { result } = renderHook(() => useNode());

    await waitFor(() => {
      expect(result.current.status?.state).toBe('running');
    });
  });
});
```

#### Backend Example

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_node_state_transitions() {
        let mut service = NodeService::new();
        assert_eq!(service.state, NodeState::Stopped);

        service.start();
        assert_eq!(service.state, NodeState::Running);
    }

    #[tokio::test]
    async fn test_health_check() {
        let service = NodeService::new();
        let result = service.health_check().await;
        assert!(result.is_ok());
    }
}
```

### Pre-commit Hooks

Automatically runs before each commit via Husky:
- TypeScript type checking
- ESLint
- Frontend tests
- Rust formatting check
- Clippy linting
- Backend tests

Setup:
```bash
pnpm install  # Installs hooks automatically
```

Bypass (not recommended):
```bash
git commit --no-verify -m "message"
```

## CI/CD Pipeline

### CI Workflow (`.github/workflows/ci.yml`)

Runs on every push and pull request to `main` and `develop` branches.

**Jobs:**

1. **frontend-test** - TypeScript/React testing
   - Type checking (`tsc`)
   - Linting (ESLint)
   - Unit tests (Vitest)

2. **backend-test** - Rust testing (Linux, macOS, Windows)
   - Format checking (`cargo fmt`)
   - Linting (`cargo clippy`)
   - Unit tests (`cargo test`)
   - Build verification

3. **security-audit** - Security scanning
   - Rust dependencies (`cargo audit`)
   - npm packages (`pnpm audit`)

4. **integration-build** - Full app build test
   - Downloads sidecar binary
   - Builds complete Tauri application

5. **coverage** - Code coverage reporting
   - Generates coverage with `cargo-tarpaulin`
   - Uploads to Codecov

### Release Workflow (`.github/workflows/release.yml`)

Triggered on tag push matching `v*.*.*` or manual dispatch.

**Jobs:**
1. **create-release** - Creates draft GitHub release
2. **build-tauri** - Builds for all platforms (matrix)
3. **publish-release** - Marks release as non-draft

### Creating a Release

```bash
# 1. Update version
vim src-tauri/Cargo.toml  # Change version
vim package.json           # Change version

# 2. Commit version bump
git add .
git commit -m "chore: bump version to 0.2.0"

# 3. Create and push tag
git tag v0.2.0
git push origin main --tags

# 4. Watch the release workflow build
# Go to: https://github.com/basedmint/archivist-desktop/actions
```

### Manual Release Build (Testing)

To build release artifacts from any branch without creating a version tag:

```bash
# Trigger release workflow manually from current branch
gh workflow run release.yml --ref feature/your-branch

# Check workflow status
gh run list --workflow=release.yml --limit 3

# Watch the build progress
gh run watch <run-id>
```

This is useful for:
- Testing release builds before tagging a final version
- Creating release candidates from feature branches
- Debugging platform-specific build issues

The workflow builds for all 4 platforms:
- macOS ARM64 (`aarch64-apple-darwin`)
- macOS Intel (`x86_64-apple-darwin`)
- Linux x64 (`x86_64-unknown-linux-gnu`)
- Windows x64 (`x86_64-pc-windows-msvc`)

### Running CI Checks Locally

```bash
# Frontend
pnpm tsc --noEmit     # Type check
pnpm lint              # Lint
pnpm test              # Test

# Backend
cd src-tauri
cargo fmt --check      # Format check
cargo clippy -- -D warnings  # Lint
cargo test             # Test
cargo build            # Build
```

## Build & Release

### Build Targets

| Platform | Target Triple | Output |
|----------|--------------|--------|
| Linux x64 | `x86_64-unknown-linux-gnu` | AppImage, .deb |
| Linux ARM | `aarch64-unknown-linux-gnu` | AppImage, .deb |
| macOS Intel | `x86_64-apple-darwin` | .dmg, .app |
| macOS ARM | `aarch64-apple-darwin` | .dmg, .app |
| Windows | `x86_64-pc-windows-msvc` | .msi, .exe |

Cross-compile with:
```bash
pnpm tauri build --target aarch64-apple-darwin
```

### Build Outputs

After `pnpm tauri build`, artifacts are in:
```
src-tauri/target/release/bundle/
├── appimage/           # Linux AppImage
├── deb/               # Linux .deb package
├── dmg/               # macOS disk image
├── macos/             # macOS .app bundle
├── msi/               # Windows installer
└── nsis/              # Windows NSIS installer
```

### System Dependencies

#### Linux (Ubuntu/Debian)

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libgtk-3-dev
```

#### macOS

- Xcode Command Line Tools
- No additional packages needed (webkit is built-in)

#### Windows

- Visual Studio Build Tools with C++ workload
- WebView2 runtime (downloaded during build if needed)

## P2P Testing Guide

### Quick Test: Same Network

**Machine A**:
1. Start Archivist Desktop
2. Click "Start Node"
3. Go to Peers page
4. Click "Copy SPR"

**Machine B**:
1. Start Archivist Desktop
2. Click "Start Node"
3. Go to Peers page
4. Paste Machine A's SPR into "Connect to Peer"
5. Click "Connect"

**Verify**:
- Both machines should show 1 connected peer on Dashboard
- Peers page shows the other peer in "Connected Peers"

### Testing File Transfer

**Machine A**:
1. Go to Files page
2. Upload a test file
3. Copy the CID

**Machine B**:
1. Go to Files page
2. Paste the CID in "Download from Network"
3. Click "Download"
4. File should download via P2P from Machine A

### Connection Diagnostics

A diagnostics panel is available on the Dashboard:

1. Start your node
2. On the Dashboard, click "Show Diagnostics"
3. Click "Run Diagnostics"
4. Review the results:
   - ✓ API Reachable: Yes/No
   - Node Version: v0.1.0
   - Peer ID: 12D3Koo...
   - Network Addresses: X found

### Firewall Configuration

Open the following ports in your firewall for full functionality:

**Core P2P (All Machines):**
- **Port 8070 (TCP)**: P2P connections and file transfers
- **Port 8090 (UDP)**: Discovery/DHT

**Backup System (Optional):**
- **Port 8085 (TCP)**: Manifest server (Machine A/Source only)
- **Port 8086 (TCP)**: Backup trigger (Machine B/Backup Server only)

#### Linux (UFW)
```bash
# Core P2P ports (all machines)
sudo ufw allow 8070/tcp  # P2P connections
sudo ufw allow 8090/udp  # Discovery

# Backup ports (optional - based on role)
sudo ufw allow 8085/tcp  # Machine A: Manifest server
sudo ufw allow 8086/tcp  # Machine B: Backup trigger
```

#### macOS
System Preferences → Security & Privacy → Firewall → Allow Archivist Desktop

#### Windows
```powershell
# Run as Administrator
# Core P2P ports (all machines)
netsh advfirewall firewall add rule name="Archivist P2P" dir=in action=allow protocol=tcp localport=8070
netsh advfirewall firewall add rule name="Archivist Discovery" dir=in action=allow protocol=udp localport=8090

# Backup ports (optional - based on role)
netsh advfirewall firewall add rule name="Archivist Manifest" dir=in action=allow protocol=tcp localport=8085
netsh advfirewall firewall add rule name="Archivist Backup" dir=in action=allow protocol=tcp localport=8086
```

### Cross-Network Testing

For internet connections, configure port forwarding on your router:

**All Machines:**
1. Forward core P2P ports to your machine's local IP:
   - Port 8070 (TCP) - P2P connections
   - Port 8090 (UDP) - Discovery
2. Find your public IP: `curl ifconfig.me`
3. Your multiaddr uses the **listen port** (TCP): `/ip4/YOUR_PUBLIC_IP/tcp/8070/p2p/YOUR_PEER_ID`

**Backup System (if using):**
- **Machine A (Source):** Also forward port 8085 (TCP) for manifest server
- **Machine B (Backup Server):** Also forward port 8086 (TCP) for backup trigger

**Note**: The multiaddr only includes the listen port (8070). The discovery port (8090) is used automatically by DHT and doesn't appear in multiaddrs.

### Diagnostic Commands

```bash
# Get node info
curl http://127.0.0.1:8080/api/archivist/v1/debug/info

# Get SPR
curl http://127.0.0.1:8080/api/archivist/v1/spr

# List connected peers
curl http://127.0.0.1:8080/api/archivist/v1/peers

# Check if ports are open
lsof -i :8070  # Listen port (TCP) - macOS/Linux
lsof -i :8090  # Discovery port (UDP) - macOS/Linux
netstat -ano | findstr "8070"  # Windows (listen)
netstat -ano | findstr "8090"  # Windows (discovery)
```

### Common P2P Issues

#### "Connection failed" or "Peer not found"
- Verify peer is running
- Test network connectivity (ping)
- Check firewall rules on both machines

#### Peer connects then disconnects
- NAT timeout
- Node restart
- Network instability
- Try reconnecting with fresh SPR

#### Can't download files from peer
- Verify CID is correct
- Ensure peers are still connected
- Check source machine still has file

#### Works on LAN but not over internet
- Configure port forwarding
- ISP may block P2P traffic
- Consider using VPN to create virtual LAN

## Backup to Designated Peer with Continuous Sync

### Overview

The backup peer notification feature enables automatic backup of synced files to a designated trusted peer (such as a home server). This feature addresses the common use case where users want their desktop files automatically backed up to a specific server without manual intervention.

**Key Capabilities:**
- **Primary use case**: Backup from one desktop to ONE specific trusted peer (1:1 backup)
- **Advanced use case**: Support n:1 fan-in (multiple source peers → single backup server)
- **Event-driven**: Manifest generation triggered automatically after threshold of file changes
- **Source of truth**: Manifest files track complete state with sequence numbers for ordering
- **Content deduplication**: Same file content = same CID = stored once across all sources
- **Deletion tracking**: Tombstones in manifests track removed files

### Architecture

#### Notification Flow

```
Primary Desktop (Source)
  1. Watch folder detects file changes (create/modify/delete)
  2. Upload files to local node → Generate CIDs
  3. Track changes in counter (threshold: 10 changes by default)
  4. When threshold reached:
     a. Build manifest JSON with current files + deleted files
     b. Increment sequence number
     c. Upload manifest to local node → Get manifest CID
     d. Create storage request for manifest CID
     e. Backup peer downloads manifest from network
  5. If notification fails:
     a. Mark as pending_retry
     b. Retry every 5 minutes (configurable)
     c. Max 5 retry attempts (configurable)

Backup Server (Remote)
  1. Receives manifest file via P2P storage request
  2. Downloads manifest from network
  3. (Future) Parse manifest and download each CID
  4. (Future) Enforce deletions based on tombstones
  5. (Future) Send acknowledgment to source peer
```

#### Planes of Operation

**Notification Plane** (Event-driven):
- File watcher detects changes
- Change counter increments
- Threshold triggers manifest generation
- Storage request sent to backup peer
- Retry mechanism for failed deliveries

**Source of Truth Plane** (What is authoritative):
- Each manifest = complete state at sequence number N
- Includes `files` array (current state) and `deleted_files` array (tombstones)
- Sequence numbers enable ordering and gap detection
- Eventually consistent model with idempotent operations

### Manifest File Format

**Location**: `.archivist-manifest-{peer_id}.json` in watched folder root

**Filename Format**: Uses first 12 characters of source peer ID for uniqueness in n:1 scenarios

**Complete JSON Schema**:

```json
{
  "version": "1.0",
  "folder_id": "uuid-of-watched-folder",
  "folder_path": "/absolute/path/to/watched/folder",
  "source_peer_id": "16Uiu2HAmXYZ123...",
  "sequence_number": 42,
  "last_updated": "2026-01-19T10:30:00Z",
  "manifest_cid": "zdj7WaB3C...",
  "files": [
    {
      "path": "documents/report.pdf",
      "cid": "zdj7W1a2b3c...",
      "size_bytes": 102400,
      "mime_type": "application/pdf",
      "uploaded_at": "2026-01-19T10:25:00Z"
    },
    {
      "path": "images/photo.jpg",
      "cid": "zdj7W4d5e6f...",
      "size_bytes": 2048000,
      "mime_type": "image/jpeg",
      "uploaded_at": "2026-01-19T10:28:00Z"
    }
  ],
  "deleted_files": [
    {
      "path": "old/file.txt",
      "cid": "zdj7W7g8h9i...",
      "deleted_at": "2026-01-19T10:27:00Z"
    }
  ],
  "stats": {
    "total_files": 2,
    "total_size_bytes": 2150400
  }
}
```

**Field Descriptions**:
- `version`: Manifest schema version (currently "1.0")
- `folder_id`: UUID identifying the watched folder
- `folder_path`: Absolute path on source peer
- `source_peer_id`: Peer ID of source (for n:1 attribution)
- `sequence_number`: Incremental counter (detects gaps/missed updates)
- `last_updated`: Timestamp of manifest generation
- `manifest_cid`: Self-referencing CID of this manifest file
- `files`: Array of currently existing files (current state)
- `deleted_files`: Tombstones for files removed since last manifest
- `stats`: Aggregated statistics

### Configuration

**Settings → Sync → Backup to Peer**:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Enable automatic backup | Checkbox | false | Master switch for backup feature |
| Backup Peer Address | Text | null | Multiaddr of backup server |
| Backup Peer Nickname | Text | null | Optional friendly name for backup peer |
| Generate manifest files | Checkbox | true | Create .archivist-manifest-{peer_id}.json files |
| Automatically notify backup peer | Checkbox | false | Auto-create storage requests after manifest generation |

**Advanced Settings** (in config.toml):

| Setting | Field | Default | Description |
|---------|-------|---------|-------------|
| Manifest Update Threshold | `manifest_update_threshold` | 10 | Generate manifest after N file changes |
| Retry Interval | `manifest_retry_interval_secs` | 300 | Retry failed notifications every N seconds (5 min) |
| Max Retries | `manifest_max_retries` | 5 | Give up after N retry attempts |

### Setup Instructions

#### Primary Desktop (Source Peer)

1. **Enable Backup**
   - Open Settings → Sync → Backup to Peer
   - Check "Enable automatic backup to designated peer"

2. **Configure Backup Server Address**
   - Enter backup server's multiaddr in "Backup Peer Address"
   - Format: `/ip4/<public-ip>/tcp/8070/p2p/<peer-id>`
   - Example: `/ip4/192.168.1.100/tcp/8070/p2p/16Uiu2HAm...`

3. **Optional: Set Nickname**
   - Enter friendly name like "Home Server" for identification

4. **Configure Manifest Settings**
   - Check "Generate manifest files" (recommended: enabled)
   - Check "Automatically notify backup peer" to enable auto-backup

5. **Configure Thresholds** (optional, edit config.toml):
   ```toml
   [sync]
   manifest_update_threshold = 10  # Generate manifest after 10 file changes
   manifest_retry_interval_secs = 300  # Retry every 5 minutes
   manifest_max_retries = 5  # Max 5 retry attempts
   ```

6. **Add Watch Folder**
   - Go to Sync page
   - Click "Add Watch Folder"
   - Select folder to backup

7. **Automatic Operation**
   - Files sync automatically
   - After 10 file changes (default threshold), manifest generates
   - Backup peer receives notification
   - Files download to backup server

#### Backup Server

1. **Install Archivist Desktop**
   - Install on remote server (Linux, macOS, or Windows)

2. **Start Node**
   - Launch Archivist Desktop
   - Click "Start Node" on Dashboard

3. **Get Server Address**
   - Dashboard → Copy SPR
   - Or via API: `curl http://127.0.0.1:8080/api/archivist/v1/spr`
   - Or get multiaddr from Dashboard → Show Diagnostics → Network Addresses

4. **Configure Firewall**
   - Allow UDP port 8090 (discovery)
   - Allow TCP port 8070 (P2P connections)
   - Example (Linux UFW):
     ```bash
     sudo ufw allow 8090/udp
     sudo ufw allow 8070/tcp
     ```

5. **Use Address in Primary Desktop**
   - Copy multiaddr from Dashboard (includes peer ID)
   - Enter in primary desktop's backup peer address setting

6. **Automatic Reception**
   - Manifests download automatically via P2P
   - Files download automatically (future enhancement)
   - Currently: Manual manifest inspection and file downloads

### How It Works

#### Event-Driven Manifest Generation

1. **Change Tracking**
   - File watcher detects create/modify/delete events
   - Each change increments `changes_since_manifest` counter for the folder

2. **Threshold Trigger**
   - When counter reaches threshold (default: 10 changes)
   - Manifest generation process starts automatically

3. **Manifest Generation**
   - Gather all current files with their CIDs
   - Gather all deleted files since last manifest (tombstones)
   - Increment sequence number
   - Build ManifestFile JSON structure
   - Write to `.archivist-manifest-{peer_id}.json` in folder root
   - Upload manifest to local node → get manifest CID

4. **Backup Notification**
   - Create storage request: `POST /storage/request/{manifest_cid}`
   - Backup server receives notification via P2P
   - Backup server downloads manifest from network

5. **Retry Mechanism**
   - If notification fails, mark as `pending_retry`
   - Background loop checks every 5 minutes for pending retries
   - Re-attempt storage request
   - After 5 failures, log warning and give up

#### Deletion Tracking

- When file deleted from watched folder:
  - Retrieve CID from `file_cid_mappings`
  - Add to `deleted_files` HashMap as tombstone
  - Remove from `file_cid_mappings`
  - Increment `changes_since_manifest` counter

- Next manifest includes:
  - `deleted_files` array with tombstone entries
  - Each entry: `{path, cid, deleted_at}`

- Backup server should (future):
  - Process `deleted_files` array
  - Remove CIDs from storage or mark for garbage collection
  - **v0.1 Limitation**: Deletion enforcement not automatic

#### n:1 Fan-In Support

**Multiple Sources → Single Backup**:
- Each source peer generates manifest with unique peer ID in filename
- Example on backup server:
  - `.archivist-manifest-16Uiu2HAm123.json` (from desktop 1)
  - `.archivist-manifest-16Uiu2HAm456.json` (from desktop 2)
  - `.archivist-manifest-16Uiu2HAm789.json` (from laptop)

**Content Deduplication**:
- Same file content → same CID → stored once
- Multiple sources may reference same CID
- Storage efficient: Only one copy regardless of source count

**Source Attribution**:
- Each manifest tracks `source_peer_id`
- Backup server can determine which peers have which files
- Enables selective restore by source

### Manual Operations

#### Manual Backup Trigger

**Via UI** (Sync Page):
1. Navigate to Sync page
2. Find watched folder in list
3. Click "Backup Now" button (visible if backup enabled and manifest exists)
4. Notification sent immediately to backup peer

**Via API** (for automation):
```bash
# Generate manifest for folder
curl -X POST http://127.0.0.1:8080/api/local/generate_folder_manifest \
  -H "Content-Type: application/json" \
  -d '{"folder_id": "uuid-of-folder"}'

# Notify backup peer
curl -X POST http://127.0.0.1:8080/api/local/notify_backup_peer \
  -H "Content-Type: application/json" \
  -d '{"folder_id": "uuid-of-folder"}'
```

#### Manual Manifest Inspection

Manifests are plain JSON files:
```bash
# View manifest
cat /path/to/watched/folder/.archivist-manifest-16Uiu2HAm.json | jq

# Check sequence number
jq '.sequence_number' /path/to/watched/folder/.archivist-manifest-*.json

# List all files
jq '.files[] | .path' /path/to/watched/folder/.archivist-manifest-*.json

# List deleted files
jq '.deleted_files[] | .path' /path/to/watched/folder/.archivist-manifest-*.json

# Get statistics
jq '.stats' /path/to/watched/folder/.archivist-manifest-*.json
```

### Verification & Testing

#### Single-Peer Backup

1. **Setup**
   - Configure backup peer address in Settings
   - Enable backup and auto-notify
   - Add watch folder

2. **Upload Files**
   - Add 10+ test files to watched folder
   - Observe manifest generation (check folder for `.archivist-manifest-*.json`)

3. **Verify Manifest**
   - Open manifest file
   - Check `sequence_number` starts at 1
   - Verify `files` array contains all uploaded files
   - Verify `source_peer_id` matches your peer ID

4. **Check Backup Server**
   - Navigate to backup server
   - Verify manifest file received via P2P
   - (Future) Verify files downloaded

5. **Test Deletion Tracking**
   - Delete 3 files from watched folder
   - Wait for threshold or manually trigger backup
   - New manifest should have `sequence_number: 2`
   - Check `deleted_files` array contains 3 tombstones

#### Multi-Peer Fan-In

1. **Setup Multiple Sources**
   - Install on 2+ desktops/laptops
   - Configure same backup server address on all sources
   - Add watch folders on each source

2. **Upload Different Files**
   - Source 1: Upload photos
   - Source 2: Upload documents
   - Source 3: Upload videos

3. **Verify Unique Manifests**
   - Check backup server for multiple manifest files
   - Each should have different peer ID in filename
   - Each should track different files

4. **Test Deduplication**
   - Upload same file (identical content) from two sources
   - Both manifests should reference same CID
   - Backup server stores CID only once

5. **Verify Sequence Numbers**
   - Each source maintains independent sequence
   - Source 1 may be at sequence 5, Source 2 at sequence 3, etc.

#### Retry Mechanism

1. **Simulate Offline Backup Peer**
   - Stop node on backup server

2. **Trigger Manifest Generation**
   - Upload files on primary desktop
   - Manifest generates, notification fails

3. **Check Logs**
   - Look for retry attempts logged every 5 minutes
   - Verify max retries respected (gives up after 5)

4. **Bring Backup Online**
   - Start backup server node
   - Wait for retry interval
   - Verify manifest delivered on next retry

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| **Manifest not generating** | Below threshold | Upload more files or lower `manifest_update_threshold` in config |
| **Backup peer not receiving** | Peer offline or firewall blocking | Check connection, verify ports 8090/8070 open |
| **Deletions not tracked** | Manifest not regenerated yet | Wait for threshold or trigger manual backup |
| **Sequence number gaps** | Missed manifests due to failures | Check retry logs, backup server may need to request missing |
| **"Backup Now" button disabled** | No manifest generated yet | Wait for threshold or check if backup enabled |
| **Retry exhausted** | Backup peer unreachable for extended time | Check backup server status, increase `manifest_max_retries` |
| **Multiple manifests conflict** | Should not happen (unique peer IDs) | Each source has unique peer ID, verify peer ID in manifest |
| **Manifest CID not showing** | Manifest generation failed | Check logs for errors, verify node running |

### API Reference

#### Tauri Commands

**Generate Manifest**:
```typescript
import { invoke } from '@tauri-apps/api/core';

// Generate manifest for folder, returns manifest CID
const manifestCid = await invoke<string>('generate_folder_manifest', {
  folderId: 'uuid-of-folder'
});
```

**Notify Backup Peer**:
```typescript
// Trigger manual backup notification
await invoke('notify_backup_peer', {
  folderId: 'uuid-of-folder'
});
```

**Test Backup Peer Connection**:
```typescript
// Test if backup peer is reachable
const connected = await invoke<boolean>('test_backup_peer_connection', {
  peerAddress: '/ip4/<public-ip>/tcp/8070/p2p/<peer-id>'
});
```

#### Node API Endpoints

**Create Storage Request**:
```bash
POST /api/archivist/v1/storage/request/{cid}

# Example
curl -X POST http://127.0.0.1:8080/api/archivist/v1/storage/request/zdj7W...
```

Triggers backup server to download the specified CID from the network.

#### Manifest File Location

- **Primary Desktop**: `{watched_folder}/.archivist-manifest-{peer_id}.json`
- **Backup Server**: Downloads via P2P, stored in node data directory

### Security Considerations

#### Manifest Visibility

**Unencrypted Metadata**:
- Manifests are plain JSON (not encrypted)
- Contains: file paths, CIDs, sizes, MIME types, timestamps
- Anyone with manifest CID can read metadata
- **Recommendation**: Don't sync sensitive folder structures

#### Backup Peer Trust

**Manual Configuration Required**:
- User manually configures backup peer address
- Implicit trust: Backup peer can see all file metadata
- Backup peer can download all files
- **Recommendation**: Only use trusted servers you control

#### Network Security

- Manifests transmitted via libp2p (encrypted P2P channels)
- No cleartext transmission over public internet
- Content-addressed: CIDs are cryptographic hashes

#### Future Security Enhancements

- Authentication tokens (require token to accept backups)
- End-to-end encryption for sensitive files
- Access control lists (which peers can backup to which servers)
- Audit logs for all backup operations

### Limitations (v0.1)

#### Primary Peer (Implemented)

- ✅ Manifest generation with sequence numbers
- ✅ Deletion tracking as tombstones
- ✅ Retry mechanism for failed notifications
- ✅ Event-driven manifest updates (threshold-based)
- ✅ n:1 fan-in support with peer ID namespacing
- ✅ Manual backup trigger via UI

#### Backup Server (Not Implemented - Future)

- ❌ Automatic manifest processing
- ❌ Deletion enforcement based on tombstones
- ❌ Sequence gap detection and recovery
- ❌ Acknowledgment back to source peer
- ❌ UI for viewing all sources and their states
- ❌ Multi-manifest reconciliation

#### Manual Workflow for v0.1

**Current workflow**:
1. Primary peer generates and uploads manifests ✅
2. Backup server downloads manifests via P2P ✅
3. User manually inspects manifests to see file list ⚠️
4. User manually initiates downloads for missing CIDs ⚠️
5. User manually deletes files based on tombstones ⚠️

**Future automated workflow**:
- Backup server daemon auto-watches for new manifest CIDs
- Auto-parses and applies manifests
- Auto-downloads missing files
- Auto-enforces deletions
- Sends acknowledgments to source peers
- Provides dashboard UI for multi-source management

### Future Enhancements

These features are planned for future releases but not included in v0.1:

#### Backup Server Daemon
- **Automatic manifest monitoring**: Watch for new manifest CIDs from configured sources
- **Auto-download**: Parse manifest and download missing file CIDs automatically
- **Deletion enforcement**: Process tombstones and remove deleted files
- **Sequence gap detection**: Detect missing manifests, request recovery
- **Acknowledgment protocol**: Send confirmation back to source peers
- **Dashboard UI**: View all sources, their states, and file lists

#### Source Tracking UI
- **Reverse index**: View CID → [list of source_peer_ids] mapping
- **Conflict resolution**: Handle duplicate filenames with different content
- **Source health monitoring**: Last-seen timestamps per source
- **Selective restore**: Download specific files from specific sources

#### Advanced Sync Features
- **Bidirectional sync**: Backup peer notifies primary of changes
- **Multiple backup peers**: 1:n fan-out for redundancy
- **Backup verification**: Compare checksums between source and backup
- **Integrity checking**: Alert on inconsistencies

#### Manifest Improvements
- **Incremental manifests**: Delta updates instead of full state
- **Manifest compaction**: Merge old manifests to reduce storage
- **Encrypted manifests**: Encrypt before uploading
- **Compressed manifests**: Gzip for large file lists
- **Signed manifests**: Verify authenticity with peer signatures

#### Scheduling & Control
- **Time-based backups**: Cron-like scheduling
- **Bandwidth throttling**: Control backup network usage
- **Pause/resume**: Individual backup operation control
- **Priority queues**: Urgent vs. background backups

#### Selective Operations
- **Selective restore**: Download specific files from backup
- **Folder-level control**: Exclude certain folders
- **File type filtering**: Only backup specific extensions
- **Size limits**: Per-folder or total size limits

#### Monitoring & Alerting
- **Webhook notifications**: When backup completes
- **Email alerts**: On backup failures
- **Metrics dashboard**: Backup size, frequency, success rate
- **Health checks**: Uptime monitoring

#### Performance Optimizations
- **Parallel downloads**: Multiple CIDs simultaneously on backup server
- **Chunked processing**: Very large folders (1000+ files)
- **Manifest caching**: Incremental parsing
- **Background generation**: Async manifest creation (don't block sync)

### Related Files

| File | Purpose | Lines Changed |
|------|---------|---------------|
| [src-tauri/src/services/sync.rs](src-tauri/src/services/sync.rs) | Manifest generation, deletion tracking, change counting | Added ~300 lines |
| [src-tauri/src/services/backup.rs](src-tauri/src/services/backup.rs) | Backup peer notification, retry logic | New file, ~75 lines |
| [src-tauri/src/services/config.rs](src-tauri/src/services/config.rs) | Backup settings, thresholds, retry config | Added ~10 lines |
| [src-tauri/src/commands/sync.rs](src-tauri/src/commands/sync.rs) | Tauri commands for manual manifest/backup operations | Added ~50 lines |
| [src-tauri/src/node_api.rs](src-tauri/src/node_api.rs) | Storage request API method | Added ~25 lines |
| [src-tauri/src/state.rs](src-tauri/src/state.rs) | BackupService initialization | Modified ~15 lines |
| [src/hooks/useSync.ts](src/hooks/useSync.ts) | WatchedFolder interface with manifest fields | Modified interface |
| [src/pages/Settings.tsx](src/pages/Settings.tsx) | Backup configuration UI | Added ~80 lines |
| [src/pages/Sync.tsx](src/pages/Sync.tsx) | Backup status display, manual triggers | Added ~40 lines |

---

## Backup Server Daemon

### Overview

The Backup Server Daemon is an automated background service that monitors for manifest files from source peers and automatically processes them by downloading the referenced files. This completes the backup workflow started by the "Backup to Designated Peer" feature.

**Purpose**: Transform the backup server from a passive receiver into an active processor that automatically:
- Discovers new manifest files from source peers
- Downloads and validates manifest content
- Downloads all files referenced in manifests
- Enforces file deletions based on tombstones
- Tracks processing state across restarts

**Architecture Pattern**: Similar to NodeManager's health monitoring loop - polls periodically, processes work, handles retries, persists state.

### Key Capabilities

✅ **Automatic manifest discovery**: Polls `/data` endpoint every 30 seconds for `.archivist-manifest-*.json` files
✅ **Concurrent file downloads**: Download multiple CIDs simultaneously (configurable limit: default 3)
✅ **State persistence**: Track daemon state in JSON file across restarts
✅ **Retry with backoff**: Automatically retry failed manifest processing (max 3 attempts by default)
✅ **Deletion enforcement**: Process tombstones to remove deleted files (configurable: enabled by default)
✅ **Sequence validation**: Detect and log gaps in manifest sequence numbers
✅ **n:1 fan-in support**: Process manifests from multiple source peers simultaneously
✅ **Dashboard UI**: Real-time monitoring of processing state with statistics and progress bars

### Architecture

#### Background Loop Pattern

```
┌─────────────────────────────────────────────────────┐
│           Backup Server Daemon Loop                 │
│  (Spawned as background task on app startup)        │
└──────────────────────┬──────────────────────────────┘
                       │
       ┌───────────────▼────────────────┐
       │  Check if enabled              │
       │  (AtomicBool flag)             │
       └───────────────┬────────────────┘
                       │
       ┌───────────────▼────────────────┐
       │  Run Cycle:                    │
       │  1. Discover manifests         │
       │  2. Filter unprocessed         │
       │  3. Process each manifest      │
       │  4. Retry failed manifests     │
       │  5. Persist state to JSON      │
       └───────────────┬────────────────┘
                       │
       ┌───────────────▼────────────────┐
       │  Sleep for poll_interval_secs  │
       │  (default: 30 seconds)         │
       └───────────────┬────────────────┘
                       │
                       └──────────┐
                                  │
                              (repeat)
```

#### Manifest Processing Flow

```
Discover Manifest
    ↓
Check if already processed? → Yes → Skip
    ↓ No
Connect to source peer via P2P (using multiaddr)
    ↓
Download manifest JSON from network
    ↓
Parse and validate
    ↓
Validate sequence number (detect gaps)
    ↓
Download files in batches (via P2P)
    ↓
    ┌───────────────────┬────────────────────┐
    ↓                   ↓                    ↓
File 1-3          File 4-6              File 7-9
(concurrent)      (concurrent)          (concurrent)
    ↓                   ↓                    ↓
    └───────────────────┴────────────────────┘
                        ↓
    Track: downloaded, failed, not_found
                        ↓
    Enforce deletions (if auto_delete_tombstones enabled)
                        ↓
    ┌──────────────────┴───────────────────┐
    ↓                                      ↓
All successful?                   Some failed?
    ↓                                      ↓
Mark as                           Mark as failed
PROCESSED                         with retry count
    ↓                                      ↓
Save to processed_manifests       Add to failed_manifests
                                          ↓
                                  Retry on next cycle
                                  (up to max_retries)
```

### Configuration

#### Settings → Backup Server

The daemon is configured via Settings page (future UI section) or directly in `config.toml`:

```toml
[backup_server]
enabled = false                    # Master switch for daemon
poll_interval_secs = 30            # Check for new manifests every 30 seconds
max_concurrent_downloads = 3       # Download up to 3 files simultaneously
max_retries = 3                    # Retry failed manifests up to 3 times
auto_delete_tombstones = true      # Automatically delete files marked as deleted
```

#### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | false | Enable/disable the daemon |
| `poll_interval_secs` | u64 | 30 | How often to check for new manifests |
| `max_concurrent_downloads` | u32 | 3 | Maximum parallel file downloads |
| `max_retries` | u32 | 3 | Maximum retry attempts for failed manifests |
| `auto_delete_tombstones` | bool | true | Auto-delete files marked as deleted in manifests |

### Daemon State

The daemon maintains persistent state in `~/.local/share/archivist/backup-daemon-state.json`:

```json
{
  "processed_manifests": {
    "zdj7W...": {
      "manifestCid": "zdj7W...",
      "sourcePeerId": "16Uiu2HAm123...",
      "sequenceNumber": 5,
      "folderId": "uuid-of-folder",
      "processedAt": "2026-01-20T10:30:00Z",
      "fileCount": 42,
      "totalSizeBytes": 104857600,
      "deletedCount": 3
    }
  },
  "in_progress_manifests": {
    "zdj7W...": {
      "manifestCid": "zdj7W...",
      "sourcePeerId": "16Uiu2HAm456...",
      "sequenceNumber": 3,
      "startedAt": "2026-01-20T10:32:00Z",
      "totalFiles": 100,
      "filesDownloaded": 67,
      "filesFailed": 2,
      "currentStatus": "Downloading files (67/100)"
    }
  },
  "failed_manifests": [
    {
      "manifestCid": "zdj7W...",
      "sourcePeerId": "16Uiu2HAm789...",
      "failedAt": "2026-01-20T10:25:00Z",
      "errorMessage": "Failed to download 5 files",
      "retryCount": 2
    }
  ],
  "last_poll_time": "2026-01-20T10:33:00Z",
  "stats": {
    "totalManifestsProcessed": 15,
    "totalFilesDownloaded": 523,
    "totalBytesDownloaded": 2147483648,
    "totalFilesDeleted": 12,
    "lastActivityAt": "2026-01-20T10:30:00Z"
  }
}
```

#### State Structures

**ProcessedManifest**: Successfully completed manifests
- `manifestCid`: CID of manifest file
- `sourcePeerId`: Peer ID of source (for n:1 attribution)
- `sequenceNumber`: Manifest sequence number
- `folderId`: UUID of source folder
- `processedAt`: Timestamp of completion
- `fileCount`: Number of files in manifest
- `totalSizeBytes`: Total size of all files
- `deletedCount`: Number of files deleted (tombstones processed)

**InProgressManifest**: Currently processing manifests
- `manifestCid`: CID of manifest file
- `sourcePeerId`: Source peer ID
- `sequenceNumber`: Manifest sequence
- `startedAt`: When processing began
- `totalFiles`: Total files to download
- `filesDownloaded`: Files successfully downloaded
- `filesFailed`: Files that failed to download
- `currentStatus`: Human-readable status message

**FailedManifest**: Manifests that failed processing
- `manifestCid`: CID of failed manifest
- `sourcePeerId`: Source peer ID
- `failedAt`: Timestamp of failure
- `errorMessage`: Error description
- `retryCount`: Number of retry attempts made

**DaemonStats**: Cumulative statistics
- `totalManifestsProcessed`: Lifetime manifest count
- `totalFilesDownloaded`: Lifetime file count
- `totalBytesDownloaded`: Lifetime byte count
- `totalFilesDeleted`: Lifetime deletion count
- `lastActivityAt`: Timestamp of last successful processing

### Implementation Details

#### Core Service

**File**: [src-tauri/src/services/backup_daemon.rs](src-tauri/src/services/backup_daemon.rs) (~780 lines)

**Key Structures**:
```rust
pub struct BackupDaemon {
    api_client: NodeApiClient,
    state: Arc<RwLock<DaemonState>>,
    state_file_path: PathBuf,
    enabled: Arc<AtomicBool>,
    poll_interval_secs: u64,
    max_concurrent_downloads: u32,
    max_retries: u32,
    auto_delete_tombstones: bool,
}

pub struct DaemonState {
    pub processed_manifests: HashMap<String, ProcessedManifest>,
    pub in_progress_manifests: HashMap<String, InProgressManifest>,
    pub failed_manifests: Vec<FailedManifest>,
    pub last_poll_time: DateTime<Utc>,
    pub stats: DaemonStats,
}
```

**Key Methods**:
- `new()`: Initialize daemon with configuration
- `start()`: Begin background loop (runs indefinitely)
- `enable()` / `disable()`: Control daemon execution
- `pause()` / `resume()`: Temporarily halt processing
- `get_state()`: Retrieve current daemon state for UI
- `retry_manifest()`: Manually retry a failed manifest

**Processing Pipeline**:
1. `run_cycle()`: Main processing loop
2. `discover_manifests()`: List all data, filter for `.archivist-manifest-*.json`
3. `process_manifest()`: Download, parse, download files, enforce deletions
4. `download_manifest_files()`: Concurrent file downloads with batching
5. `enforce_deletions()`: Process tombstones if enabled
6. `persist_state()`: Save state to JSON file

#### Tauri Commands

**File**: [src-tauri/src/commands/sync.rs](src-tauri/src/commands/sync.rs)

**Added Commands**:
```rust
#[tauri::command]
pub async fn get_backup_daemon_state(state: State<'_, AppState>) -> Result<DaemonState>

#[tauri::command]
pub async fn enable_backup_daemon(state: State<'_, AppState>) -> Result<()>

#[tauri::command]
pub async fn disable_backup_daemon(state: State<'_, AppState>) -> Result<()>

#[tauri::command]
pub async fn pause_backup_daemon(state: State<'_, AppState>) -> Result<()>

#[tauri::command]
pub async fn resume_backup_daemon(state: State<'_, AppState>) -> Result<()>

#[tauri::command]
pub async fn retry_failed_manifest(state: State<'_, AppState>, manifest_cid: String) -> Result<()>
```

**Critical Fix**: Config persistence bug (fixed in current implementation)
- **Problem**: Enable/disable commands only updated in-memory `AtomicBool` flag
- **Symptom**: UI showed daemon as disabled after refresh, even though user enabled it
- **Solution**: Commands now update both in-memory flag AND persist to config file:
  ```rust
  // Enable in-memory flag
  state.backup_daemon.enable();

  // Persist to config file
  let mut config_service = state.config.write().await;
  let mut config = config_service.get();
  config.backup_server.enabled = true;
  config_service.update(config)?;
  ```

#### Integration

**File**: [src-tauri/src/state.rs](src-tauri/src/state.rs)

Added `backup_daemon` to `AppState`:
```rust
pub struct AppState {
    // ... existing fields
    pub backup_daemon: Arc<BackupDaemon>,
}

// In AppState::new():
let backup_daemon = Arc::new(BackupDaemon::new(
    api_client,
    app_config.backup_server.enabled,
    app_config.backup_server.poll_interval_secs,
    app_config.backup_server.max_concurrent_downloads,
    app_config.backup_server.max_retries,
    app_config.backup_server.auto_delete_tombstones,
));
```

**File**: [src-tauri/src/lib.rs](src-tauri/src/lib.rs)

Spawn daemon as background task:
```rust
let backup_daemon = app_state.backup_daemon.clone();

tauri::async_runtime::spawn(async move {
    backup_daemon.start().await;
});
log::info!("Backup daemon initialized");
```

### Dashboard UI

#### Backup Server Page

**File**: [src/pages/BackupServer.tsx](src/pages/BackupServer.tsx) (~560 lines)

**Location**: Navigate to "Backup Server" in sidebar

**Features**:

1. **Statistics Cards** (top section)
   - Total Manifests Processed
   - Total Files Downloaded
   - Total Data Downloaded (formatted bytes)
   - Total Files Deleted
   - Displayed as gradient cards with large numbers

2. **Last Activity Info** (banner)
   - Last Activity timestamp
   - Last Poll timestamp
   - Helps monitor daemon liveness

3. **Configuration Panel** (expandable)
   - Poll Interval
   - Max Concurrent Downloads
   - Max Retries
   - Auto-Delete Tombstones
   - Read-only display of current settings

4. **In-Progress Manifests Table** (if any)
   - Manifest CID (shortened)
   - Source Peer ID (shortened)
   - Sequence Number
   - Current Status message
   - Progress bar (files downloaded / total files)
   - Failed file count
   - Started timestamp

5. **Failed Manifests Table** (if any)
   - Manifest CID (shortened)
   - Source Peer ID (shortened)
   - Error message
   - Retry count (N/max_retries)
   - Failed timestamp
   - Manual "Retry" button per manifest

6. **Processed Manifests Table** (main section)
   - Manifest CID (shortened)
   - Source Peer ID (shortened)
   - Folder ID (shortened)
   - Sequence Number
   - File count
   - Total size (formatted)
   - Deleted file count
   - Processed timestamp
   - Sorted by most recent first

**Controls** (header):
- **Enable Daemon** button (if disabled)
- **Pause** button (if enabled)
- **Resume** button (if enabled)
- **Disable Daemon** button (if enabled)

**Auto-Refresh**: Polls `get_backup_daemon_state()` every 5 seconds

**Styling**: [src/styles/BackupServer.css](src/styles/BackupServer.css) (~270 lines)
- Gradient stat cards
- Responsive tables with hover effects
- Progress bars with smooth animations
- Color-coded status indicators

#### App Navigation

**File**: [src/App.tsx](src/App.tsx)

Added navigation link and route:
```tsx
<NavLink to="/backup-server" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
  Backup Server
</NavLink>

<Route path="/backup-server" element={<BackupServer />} />
```

### Usage Instructions

#### Setting Up Backup Server

1. **Install Archivist Desktop on Backup Server**
   - Install on remote server or dedicated machine
   - Start node (Dashboard → Start Node)

2. **Enable Backup Daemon**
   - Navigate to Backup Server page
   - Click "Enable Daemon" button
   - Daemon starts polling immediately

3. **Configure Source Peers**
   - On source desktops, configure backup peer address (Settings → Sync → Backup to Peer)
   - Point to backup server's multiaddr (e.g., `/ip4/<ip>/tcp/8070/p2p/<peer-id>`)
   - Enable "Automatically notify backup peer"

4. **Monitor Dashboard**
   - Watch statistics update in real-time
   - Check in-progress manifests for active downloads
   - Review processed manifests for completed backups

#### Manual Operations

**Retry Failed Manifest**:
- Go to Failed Manifests table
- Click "Retry" button next to failed manifest
- Daemon immediately attempts reprocessing

**Pause Processing**:
- Click "Pause" button
- Daemon stops processing new manifests
- Current in-progress downloads complete
- Useful for bandwidth management

**Resume Processing**:
- Click "Resume" button
- Daemon resumes normal operation

**Disable Daemon**:
- Click "Disable Daemon" button
- Daemon stops completely
- State persists, can be re-enabled later

#### Testing Workflow

**Single-Machine Test** (backup to self):
1. Enable backup daemon on Backup Server page
2. Go to Settings → Sync → Backup to Peer
3. Enter `spr:` from own node (get from Dashboard → Copy SPR)
4. Enable "Automatically notify backup peer"
5. Add watch folder with test files (10+ files to trigger manifest)
6. Go to Backup Server page
7. Watch "In-Progress Manifests" table as files download
8. Verify manifest moves to "Processed Manifests" table when complete
9. Check statistics update (files downloaded, bytes downloaded)

**Two-Machine Test** (actual backup):
1. **Machine A** (Source):
   - Settings → Sync → Backup to Peer
   - Enter Machine B's SPR
   - Enable "Automatically notify backup peer"
   - Add watch folder
2. **Machine B** (Backup Server):
   - Enable backup daemon
   - Watch dashboard for incoming manifests
   - Verify files download automatically
3. **Test Deletions**:
   - Delete files on Machine A
   - Wait for manifest threshold
   - Verify Machine B processes tombstones (if auto_delete enabled)

**Multi-Source Test** (n:1 fan-in):
1. **Multiple Sources** (Machines A, B, C):
   - All configure same backup server address
   - All add watch folders
2. **Backup Server** (Machine D):
   - Enable daemon
   - Watch for manifests from different peer IDs
   - Verify concurrent processing
   - Check content deduplication (same file → same CID → stored once)

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| **Daemon not processing** | Daemon disabled | Enable via "Enable Daemon" button or Settings |
| **Manifests not appearing** | Source peer not notifying | Check source peer's backup settings, verify auto-notify enabled |
| **All manifests failing** | Node API unreachable | Restart node, check API port |
| **Some files failing to download** | CIDs not available on network | Ensure source peer is online and connected |
| **High retry count** | Network instability or missing CIDs | Check source peer connectivity, verify files still exist |
| **Deletions not enforced** | `auto_delete_tombstones = false` | Enable in config.toml or via Settings (future) |
| **Dashboard not updating** | Auto-refresh disabled or failed API call | Refresh page, check console for errors |
| **Sequence gaps detected** | Missed manifests during downtime | Check logs for gap warnings, sequence will continue |
| **State file corrupted** | Manual edit or disk error | Delete `backup-daemon-state.json`, daemon will recreate |

### API Reference

#### Frontend (TypeScript)

```typescript
import { invoke } from '@tauri-apps/api/core';

// Get current daemon state
const state = await invoke<DaemonState>('get_backup_daemon_state');

// Enable daemon (persists to config)
await invoke('enable_backup_daemon');

// Disable daemon (persists to config)
await invoke('disable_backup_daemon');

// Pause daemon (in-memory only)
await invoke('pause_backup_daemon');

// Resume daemon (in-memory only)
await invoke('resume_backup_daemon');

// Manually retry failed manifest
await invoke('retry_failed_manifest', { manifestCid: 'zdj7W...' });
```

#### Backend (Rust)

**Starting daemon on app startup**:
```rust
// In src-tauri/src/lib.rs
let backup_daemon = app_state.backup_daemon.clone();
tauri::async_runtime::spawn(async move {
    backup_daemon.start().await;
});
```

**Accessing daemon state**:
```rust
// From any command
let state = state.backup_daemon.get_state().await;
```

**Manual control**:
```rust
state.backup_daemon.enable();
state.backup_daemon.disable();
state.backup_daemon.pause().await?;
state.backup_daemon.resume().await?;
```

### State File Location

| Platform | Path |
|----------|------|
| Linux | `~/.local/share/archivist/backup-daemon-state.json` |
| macOS | `~/Library/Application Support/archivist/backup-daemon-state.json` |
| Windows | `%APPDATA%\archivist\backup-daemon-state.json` |

The state file is automatically created on first run and updated after each processing cycle.

### Performance Characteristics

**Polling Frequency**: Default 30 seconds
- Low network overhead
- Near real-time processing for typical workflows
- Configurable down to 5 seconds for low-latency needs

**Concurrent Downloads**: Default 3 simultaneous
- Balances speed vs. network load
- Prevents overwhelming source peers
- Configurable up to 10+ for high-bandwidth scenarios

**Memory Usage**: Approximately 5-10 MB baseline
- Scales with number of manifests in state
- Typical usage: <20 MB for 100 manifests
- State persists to disk, not all held in memory

**Disk I/O**: Minimal
- State save after each cycle (~1 KB write)
- Manifest downloads (typically <50 KB each)
- File downloads (variable, depends on manifest content)

### Security Considerations

**Automatic File Deletion**:
- `auto_delete_tombstones` enabled by default
- Backup server automatically deletes files based on source peer's tombstones
- **Risk**: Malicious manifest could delete important backups
- **Mitigation**: Only configure trusted source peers

**Manifest Validation**:
- CID validation ensures manifest integrity
- JSON parsing errors reject invalid manifests
- No code execution from manifest content

**Network Trust**:
- Backup server trusts all manifests from configured source peers
- No authentication or authorization checks
- **Recommendation**: Only use on trusted private networks or with authenticated peers

**State File Security**:
- Plain JSON file, no encryption
- Contains manifest metadata, CIDs, peer IDs
- File permissions: User-readable only (default OS permissions)

### Future Enhancements

Planned improvements for future releases:

#### Acknowledgment Protocol
- Send confirmation back to source peer when manifest processed
- Source peer clears `pending_retry` flag on ACK
- Enables reliable delivery confirmation

#### Advanced Gap Detection
- Request missing manifests when sequence gaps detected
- Automatically backfill missed updates
- Provide UI for gap recovery

#### Source Tracking UI
- View all configured source peers
- See last manifest sequence per source
- Health monitoring (last-seen timestamps)
- Manual source peer management (add/remove)

#### Selective Processing
- Filter manifests by source peer
- Pause processing for specific sources
- Size limits per source or total

#### Performance Optimizations
- Parallel manifest processing (process multiple manifests concurrently)
- Incremental manifest parsing for very large manifests (1000+ files)
- Background state persistence (async write, don't block cycle)

#### Monitoring & Alerting
- Webhook notifications on processing failures
- Email alerts for manifests stuck in retry
- Metrics export (Prometheus/Grafana)

### Related Files

| File | Purpose | Lines |
|------|---------|-------|
| [src-tauri/src/services/backup_daemon.rs](src-tauri/src/services/backup_daemon.rs) | Core daemon implementation | ~780 |
| [src-tauri/src/services/config.rs](src-tauri/src/services/config.rs) | BackupServerSettings configuration | +15 |
| [src-tauri/src/commands/sync.rs](src-tauri/src/commands/sync.rs) | Daemon control commands (with config persistence fix) | +80 |
| [src-tauri/src/state.rs](src-tauri/src/state.rs) | BackupDaemon initialization in AppState | +10 |
| [src-tauri/src/lib.rs](src-tauri/src/lib.rs) | Background task spawning | +5 |
| [src/pages/BackupServer.tsx](src/pages/BackupServer.tsx) | Dashboard UI with real-time monitoring | ~560 |
| [src/styles/BackupServer.css](src/styles/BackupServer.css) | Dashboard styling | ~270 |
| [src/App.tsx](src/App.tsx) | Navigation and routing | +5 |

---

## Windows Development

### Test Environment

- **OS**: Windows 11 (Build 22631.6199+)
- **Node.js**: v20+
- **pnpm**: v10+
- **Rust**: stable (via rustup)
- **MSVC Build Tools**: 2022 (v14.44+)
- **Windows SDK**: 10.0.26100.0+

### Prerequisites Installation

```powershell
# Install Node.js LTS
winget install OpenJS.NodeJS.LTS

# Install pnpm
winget install pnpm.pnpm

# Install Rust
winget install Rustlang.Rustup

# Install Visual Studio Build Tools
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# Restart terminal to pick up new PATH entries
```

### Known Windows Issues

#### MSVC Linker Conflict with Git

**Problem:** Git's Unix-style `link.exe` shadows the MSVC linker, causing cryptic compilation errors.

**Error:**
```
error: linking with `link.exe` failed: exit code: 1
link: extra operand '...\build_script_build.o'
```

**Solution:** Create `src-tauri/.cargo/config.toml` with explicit MSVC paths:

```toml
[target.x86_64-pc-windows-msvc]
linker = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe"
rustflags = [
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\um\\x64",
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\ucrt\\x64",
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64"
]
```

**Note:** This file is machine-specific and in `.gitignore`. Adjust paths for your VS installation.

**Alternative Solutions:**
- Use VS Developer Command Prompt
- Reorder PATH to put MSVC tools before Git
- Run builds from within Visual Studio

#### Environment Variables Not Persisting

After installing tools via winget, open a new terminal to pick up PATH changes.

#### File Locking Error (Error 32)

**Problem:** "IO error: The process cannot access the file because it is being used by another process. (os error 32)" when viewing logs.

**Cause:** Windows locks files more strictly than Linux/macOS. When the archivist-node sidecar writes to the log file, the default file open operation fails without explicit sharing permissions.

**Solution:** The log reading code in `src-tauri/src/commands/node.rs` uses Windows-specific `OpenOptions` with `FILE_SHARE_READ | FILE_SHARE_WRITE` flags:

```rust
#[cfg(target_os = "windows")]
let file = {
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .share_mode(0x00000001 | 0x00000002) // FILE_SHARE_READ | FILE_SHARE_WRITE
        .open(&log_file)?
};
```

This allows reading the log file while the node is actively writing to it.

**Fixed in:** v0.1.2+

### Running Tests on Windows

```powershell
# Frontend
pnpm install
pnpm test

# Backend (may need VS Developer Command Prompt)
cargo test --manifest-path src-tauri/Cargo.toml

# Build
pnpm tauri build --debug
```

## Logs and Debugging

### Viewing Node Logs

The application includes a built-in logs viewer to monitor archivist-node output in real-time.

#### Accessing Logs

Navigate to **Logs** in the sidebar to view node output. The logs page provides:

- **Real-time viewing**: See stdout/stderr from the archivist-node sidecar
- **Auto-refresh**: Optional automatic refresh every 2 seconds
- **Line limit control**: View last 100, 500, 1000, or 5000 lines
- **Search and copy**: Copy all logs to clipboard
- **Scroll controls**: Quick navigation to bottom of logs

#### Log File Location

Logs are written to a file alongside the node data directory:

```
Linux:   ~/.local/share/archivist/node.log
macOS:   ~/Library/Application Support/archivist/node.log
Windows: %APPDATA%\archivist\node.log
```

The log path is displayed at the top of the Logs page.

#### Sidecar Startup Flag

When the node starts, the `--log-file` flag is automatically added:

```rust
// From src-tauri/src/services/node.rs
let log_file = std::path::Path::new(&config.data_dir).join("node.log");

.args([
    &format!("--data-dir={}", config.data_dir),
    &format!("--api-port={}", config.api_port),
    &format!("--disc-port={}", config.discovery_port),
    &format!("--listen-addrs={}", listen_addr),
    &format!("--storage-quota={}", config.max_storage_bytes),
    &format!("--log-file={}", log_file_str),  // ← Log output flag
    "--nat=upnp",
])
```

#### Tauri Commands

Two commands are available for log access:

```typescript
// Get last N lines of logs (default: 500)
const logs = await invoke<string[]>('get_node_logs', { lines: 500 });

// Get log file path
const logPath = await invoke<string>('get_node_log_path');
```

#### Logs Page Features

**Controls:**
- **Lines dropdown**: Select how many recent lines to display (100, 500, 1000, 5000)
- **Auto-refresh checkbox**: Enable continuous log updates every 2 seconds
- **Auto-scroll checkbox**: Automatically scroll to bottom when new logs arrive
- **Refresh button**: Manually reload logs
- **Scroll to Bottom**: Jump to most recent logs (also re-enables auto-scroll)
- **Copy All**: Copy all visible logs to clipboard
- **Clear Display**: Clear the current view (doesn't delete file)

**Auto-Scroll Behavior:**
- Enabled by default when auto-refresh is on
- Automatically scrolls to bottom when new logs are loaded
- Intelligently disables when you manually scroll up to read older logs
- Re-enables when you scroll back to the bottom or click "Scroll to Bottom"

**Display:**
- Line numbers for easy reference
- Scrollable viewer with fixed-width monospace font
- Hover highlighting on log lines
- Smooth scrolling animations

#### Log Rotation

Logs are **not automatically rotated**. For long-running nodes, consider manually clearing the log file periodically:

```bash
# Linux/macOS
> ~/.local/share/archivist/node.log

# Windows (PowerShell)
Clear-Content $env:APPDATA\archivist\node.log
```

Or delete the file entirely - it will be recreated on next node start.

#### Debugging Common Issues

Use logs to diagnose:
- **Port conflicts**: Look for "Address already in use" errors
- **Network issues**: Check for connection errors or timeout messages
- **Discovery problems**: Search for "discovery datastore" warnings
- **API errors**: Find failed requests and response codes
- **Storage issues**: Look for quota warnings or disk errors

Example log search workflow:
1. Open Logs page
2. Enable Auto-refresh
3. Reproduce the issue
4. Use browser's Find (Ctrl+F/Cmd+F) to search for error keywords
5. Copy relevant logs for troubleshooting or bug reports

## User Experience Features

### Onboarding System

**Location:** [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx), [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts)

The application includes a guided onboarding flow for first-time users, designed to complete the first backup in ≤30 seconds with ≤3 user decisions.

#### Onboarding Flow

1. **Splash Screen** - Animated branding (video or CSS fallback)
2. **Welcome Screen** - Introduction with "Get Started" CTA
3. **Node Starting** - Auto-starts node with progress indicator
4. **Folder Selection** - "Quick Backup" (default folder) or "Choose Folder"
5. **Syncing Progress** - Timeline showing sync status with CID proof

#### Video Splash with CSS Fallback

The splash screen shows a branding video on Windows/macOS, or a CSS-animated splash on Linux (due to WebKitGTK limitations).

**Platform-Specific Behavior:**
- **Linux**: Immediately shows CSS fallback (WebKitGTK video playback is unreliable)
- **Windows**: Video plays via WebView2 (built-in codecs)
- **macOS**: Video plays via Safari WebView (built-in codecs)

**Video Files** (bundled as Tauri resources):
- `src-tauri/resources/intro.webm` - VP8 codec, 1.7MB (primary)
- `src-tauri/resources/intro.mp4` - H.264 codec, 34MB (fallback)

**CSS Fallback Animation:**
- Terminal aesthetic dark background with phosphor green accents
- Breathing scale animation with intensifying glow effect
- Animated title slide-up with tagline
- 3-second duration before auto-advance

**CSS Fallback Triggers:**
- Linux platform detected (immediate)
- Video error on other platforms
- Video load timeout (2 seconds) on other platforms

**Implementation:**

```typescript
// Platform detection with immediate Linux fallback
function SplashScreen({ onComplete, onSkip }: SplashScreenProps) {
  const [showFallback, setShowFallback] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    const isTauri = !!window.__TAURI_INTERNALS__;
    const isLinux = navigator.userAgent.toLowerCase().includes('linux');

    if (isTauri && isLinux) {
      // Linux: Use CSS fallback directly (WebKitGTK video is unreliable)
      setShowFallback(true);
      return;
    }

    // Windows/macOS: Load video from Tauri resources
    const loadVideo = async () => {
      const webmPath = await resolveResource('intro.webm');
      setVideoUrl(convertFileSrc(webmPath));
    };
    loadVideo();
  }, []);

  if (showFallback) return <CSSAnimatedSplash onComplete={onComplete} />;

  return <video src={videoUrl} autoPlay muted playsInline onEnded={onComplete} />;
}
```

**CSS Animation Styles** ([src/styles/Onboarding.css](src/styles/Onboarding.css)):

```css
.splash-fallback {
  background: var(--terminal-bg);
}

.splash-icon {
  color: var(--phosphor);
  filter: drop-shadow(0 0 20px var(--phosphor-glow));
  animation: splashBreathe 3s ease-in-out infinite;
}

@keyframes splashBreathe {
  0%, 100% {
    transform: scale(1);
    filter: drop-shadow(0 0 20px var(--phosphor-glow));
  }
  50% {
    transform: scale(1.08);
    filter: drop-shadow(0 0 40px rgba(0, 255, 65, 0.7));
  }
}

.splash-title {
  font-size: 3rem;
  animation: splashSlideUp 0.6s ease-out 0.3s both;
}
```

**Welcome Screen Animation:**

The welcome screen uses a glow-intensity breathing animation (not opacity-based) to avoid visual artifacts:

```css
.welcome-screen .welcome-icon svg {
  filter: drop-shadow(0 0 15px var(--phosphor-glow));
  animation: welcomeGlow 3s ease-in-out infinite;
}

@keyframes welcomeGlow {
  0%, 100% {
    filter: drop-shadow(0 0 15px var(--phosphor-glow));
  }
  50% {
    filter: drop-shadow(0 0 30px rgba(0, 255, 65, 0.6));
  }
}
```

#### Quickstart Folder

When user selects "Quick Backup", the app:
1. Creates `~/Documents/Archivist Quickstart/` folder
2. Adds a `welcome.txt` sample file
3. Adds folder to watch list (gracefully handles if already watched)
4. Shows sync progress with CID

**Graceful Error Handling:**

If the quickstart folder is already being watched (e.g., user re-runs onboarding), the error is silently ignored and the flow continues:

```typescript
try {
  await addWatchFolder(path);
} catch (watchErr) {
  const errMsg = watchErr instanceof Error ? watchErr.message : String(watchErr);
  if (!errMsg.includes('already being watched')) {
    throw watchErr; // Re-throw non-duplicate errors
  }
  // Folder already watched - just continue to syncing
}
```

**Backend Command** ([src-tauri/src/commands/sync.rs](src-tauri/src/commands/sync.rs)):

```rust
#[tauri::command]
pub async fn create_quickstart_folder() -> Result<String, ArchivistError> {
    // Creates folder in Documents with welcome.txt
}
```

#### Onboarding State Management

**Hook:** [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts)

```typescript
export type OnboardingStep = 'splash' | 'welcome' | 'node-starting' | 'folder-select' | 'syncing';

export function useOnboarding() {
  // First-run detection via localStorage
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('onboarding_complete');
  });

  const completeOnboarding = () => {
    localStorage.setItem('onboarding_complete', 'true');
    setShowOnboarding(false);
  };

  // ... step tracking, error handling
}
```

#### Post-Onboarding Navigation

After completing onboarding, users are redirected to the Dashboard. This uses a localStorage flag to communicate across Router context switches:

**Files:** [src/App.tsx](src/App.tsx)

```typescript
const REDIRECT_AFTER_ONBOARDING_KEY = 'archivist_redirect_to_dashboard';

// Component inside main Router that handles redirect
function OnboardingRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const shouldRedirect = localStorage.getItem(REDIRECT_AFTER_ONBOARDING_KEY);
    if (shouldRedirect === 'true') {
      localStorage.removeItem(REDIRECT_AFTER_ONBOARDING_KEY);
      if (location.pathname !== '/') {
        navigate('/', { replace: true });
      }
    }
  }, [navigate, location.pathname]);

  return null;
}

// Wrapper functions set the flag before completing onboarding
const handleCompleteOnboarding = () => {
  localStorage.setItem(REDIRECT_AFTER_ONBOARDING_KEY, 'true');
  completeOnboarding();
};
```

**Why localStorage?** The app switches between two separate Router contexts (onboarding vs main app), so React Router's navigation hooks can't be used directly. The localStorage flag persists across the context switch.

#### Reset Onboarding

Users can reset onboarding via Settings → Developer → "Reset Onboarding". This clears the `onboarding_complete` flag and reloads the app.

#### Related Files

| File | Purpose |
|------|---------|
| [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx) | Main onboarding component with all screens |
| [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts) | Onboarding state management hook |
| [src/styles/Onboarding.css](src/styles/Onboarding.css) | Onboarding styles including CSS fallback animation |
| [src/App.tsx](src/App.tsx) | OnboardingRedirect component for post-onboarding navigation |
| [src-tauri/resources/intro.webm](src-tauri/resources/intro.webm) | Branding video (WebM/VP8, 1.7MB) |
| [src-tauri/resources/intro.mp4](src-tauri/resources/intro.mp4) | Branding video (MP4/H.264, 34MB) |

---

### Auto-Trigger Download on CID Paste

**Location:** [src/pages/Files.tsx](src/pages/Files.tsx)

The Files page includes an intelligent auto-download feature that streamlines the process of downloading files from the network by automatically triggering the save dialog when a valid CID is pasted.

#### How It Works

**Traditional Flow (2 steps):**
1. User pastes CID into input field
2. User clicks "Download" button
3. Save dialog appears → User chooses location → File downloads

**Improved Flow (1 step):**
1. User pastes CID into input field
2. **Auto-trigger:** Save dialog appears after brief validation (~300ms)
3. User chooses location → File downloads

#### Implementation Details

**CID Validation Utility** ([src/lib/cidValidation.ts](src/lib/cidValidation.ts))

The validation function checks CID format before triggering auto-download:

```typescript
const CID_PATTERN = /^[zQ][a-zA-Z0-9]{44,98}$/;

export function validateCid(cid: string): CidValidationResult {
  // Validates:
  // - Non-empty string
  // - Length between 46-100 characters
  // - Starts with 'z' (CIDv1) or 'Q' (CIDv0)
  // - Contains only base58 characters
}
```

**Paste Detection** ([src/pages/Files.tsx](src/pages/Files.tsx))

Uses `onPaste` event handler to clearly signal user intent:

```typescript
const handleCidPaste = useCallback(async (e: React.ClipboardEvent) => {
  const pastedText = e.clipboardData.getData('text');
  const validation = validateCid(pastedText);

  if (!validation.valid || !nodeConnected) {
    setCidValidation(validation);
    return;
  }

  // Schedule auto-download after 300ms delay
  setAutoDownloadPending(true);
  autoDownloadTimerRef.current = window.setTimeout(async () => {
    setAutoDownloadPending(false);
    if (downloadCid.trim() === pastedText.trim()) {
      await handleDownloadByCid();
    }
  }, 300);
}, [downloadCid, nodeConnected, handleDownloadByCid]);
```

**Visual Feedback** ([src/styles/App.css](src/styles/App.css))

Real-time validation provides immediate user feedback:
- **Green border**: Valid CID format
- **Red border**: Invalid CID format
- **Error message**: Displays reason for validation failure

#### Key Features

✅ **Auto-trigger on paste** - Save dialog appears 300ms after valid CID pasted
✅ **Visual validation** - Input border shows green (valid) or red (invalid)
✅ **Manual fallback** - Download button still works as before
✅ **Smart cancellation** - Edit the field to cancel pending auto-download
✅ **Node state aware** - Disabled when node not connected
✅ **Loading protection** - Prevents double-triggering during downloads

#### Edge Cases Handled

- **Invalid CID pasted** → Shows inline error, no auto-trigger
- **User edits after paste** → Cancels pending auto-trigger
- **Node disconnected** → Disables auto-trigger, shows warning
- **Download dialog cancelled** → Clears input (existing behavior)
- **Rapid paste + edit** → Debounce prevents issues
- **Double-trigger prevention** → Loading state guards against race conditions

#### Design Rationale

**Why onPaste instead of useEffect?**
- ✅ Clear user intent signal - distinguishes paste from manual typing
- ✅ No keystroke noise - doesn't trigger on every character
- ✅ More intuitive and predictable UX
- ✅ Keeps manual button as safety fallback

**Why 300ms debounce?**
- Gives user time to see validation feedback
- Prevents accidental triggers if user immediately edits
- Feels responsive without being jarring

**Why keep the manual button?**
- Fallback if paste detection fails
- Accessibility for users who type CIDs manually
- Provides clear action for users unfamiliar with auto-trigger

### Sound Notifications

**Location:** [src/hooks/useSoundNotifications.ts](src/hooks/useSoundNotifications.ts)

The application provides optional audio feedback for key node events to enhance user awareness without requiring constant visual monitoring.

#### Supported Events

1. **Node Startup** (`node-started`)
   - Sound: C5-E5-G5 major chord (uplifting tone)
   - Triggered when archivist-node becomes ready
   - Indicates successful node initialization

2. **Peer Connection** (`peer-connected`)
   - Sound: A4-C#5 two-note sequence (notification tone)
   - Triggered when new peer connects
   - Helps monitor network growth

3. **File Download** (`file-downloaded`)
   - Sound: A5-B5 high two-note sequence (completion tone)
   - Triggered when file download completes
   - Confirms successful file retrieval

#### Configuration

Settings → Notifications section provides:
- **Master toggle**: Enable/disable all sounds
- **Per-event toggles**: Individual control for each event type
- **Volume slider**: Adjust playback volume (0-100%)

#### Technical Implementation

**Web Audio API** - Cross-platform sound generation without external audio files:

```typescript
const playNotificationSound = (type: string, volume: number) => {
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  // Different frequencies for different notification types
  const frequencies = {
    'startup': [523.25, 659.25, 783.99],      // C5, E5, G5
    'peer-connect': [440, 554.37],             // A4, C#5
    'download': [880, 987.77],                 // A5, B5
  };

  // Play notes in sequence with envelope shaping
  notes.forEach((freq, index) => {
    // ... oscillator setup with gain envelope
  });
};
```

**Event System** - Rust backend emits Tauri events when actions complete:

```rust
// In src-tauri/src/services/node.rs
app_handle.emit("node-started", ())?;

// In src-tauri/src/commands/peers.rs
app_handle.emit("peer-connected", &peer_info.id)?;

// In src-tauri/src/commands/files.rs
app_handle.emit("file-downloaded", &cid)?;
```

**Settings Persistence** - Configuration stored in `AppConfig`:

```rust
// In src-tauri/src/services/config.rs
pub struct NotificationSettings {
    pub sound_enabled: bool,
    pub sound_on_startup: bool,
    pub sound_on_peer_connect: bool,
    pub sound_on_download: bool,
    pub sound_volume: f32,  // 0.0 to 1.0
}
```

#### Browser Compatibility

- Modern browsers: Uses `AudioContext`
- Safari/Webkit: Falls back to `webkitAudioContext`
- Test environment: Automatically disabled (checks for Tauri runtime)

## Troubleshooting

### Port 8080 in use
The archivist-node uses port 8080 by default.

**Check what's using the port:**
```bash
# Linux/macOS
lsof -i :8080

# Windows
netstat -ano | findstr "8080"
```

**Solution:** Change via Settings → Advanced → API Port

### Sidecar not found
**Error:** `resource path 'sidecars/archivist-...' doesn't exist`

**Solution:**
```bash
pnpm download-sidecar
# Or manually:
bash scripts/download-sidecar.sh
```

### Upload fails with 422
**Error:** `The MIME type 'multipart/form-data...' is not valid`

**Cause:** Old version using multipart encoding instead of raw binary.

**Solution:** Update to v0.1.1+ which uses raw binary uploads.

### API Not Reachable
**Diagnostics shows:** "API Not Reachable"

**Solutions:**
1. Restart the node (Dashboard → Stop → Start)
2. Check if port 8080 is in use
3. Check Settings → Advanced → API Port configuration
4. Check node logs in Settings

### 0 Addresses Found
**Problem:** Node has no network addresses

**Solutions:**
1. Check firewall allows both ports:
   - Port 8090 (UDP) - Discovery
   - Port 8070 (TCP) - Listen
2. Ensure you're connected to a network
3. Check Settings → Advanced → Port configuration

### Manifest Generation Fails with "Failed to parse node info"
**Error:** `Failed to generate manifest: API request failed: Failed to parse node info: error decoding response body`

**Cause:** The `NodeInfo` struct in the Desktop app doesn't match the actual API response from archivist-node.

**Background:**
- Fixed in commit 1e18a43 (2026-01-20)
- The struct previously expected `version`, `local_node`, `codex` fields
- But archivist-node v0.2.0 actually returns `id`, `addrs`, `archivist`, etc.

**Solution:** Update to latest version of Archivist Desktop (includes the fix)

**If you see this error:**
1. Check your version: should be post-2026-01-20
2. Pull latest code and rebuild: `git pull && pnpm tauri build`
3. Or download latest release from GitHub

**NodeInfo struct should now match this API response:**
```json
{
  "id": "16Uiu2HAmXYZ...",
  "addrs": ["/ip4/127.0.0.1/tcp/8070"],
  "repo": "/path/to/node",
  "spr": "spr:CiUI...",
  "announceAddresses": [...],
  "ethAddress": "0x...",
  "archivist": {
    "version": "v0.1.0",
    "revision": "abc123",
    "contracts": "def456"
  }
}
```

### Pre-commit Hook Too Slow

Edit `.husky/pre-commit` to skip some checks during development:

```bash
# Comment out slow checks temporarily
# pnpm test --run || exit 1
```

### CI Fails But Tests Pass Locally

- Ensure all changes are committed and pushed
- Check CI logs for environment-specific issues
- File paths might differ (use relative paths)

### Windows: File Locking Error When Viewing Logs

**Error:** `IO error: The process cannot access the file because it is being used by another process. (os error 32)`

**Symptom:** Error appears when trying to view logs on the Logs page, even though the node is running properly.

**Cause:** Windows file locking - the archivist-node sidecar has the log file open for writing, preventing the app from reading it.

**Solution:** Fixed in v0.1.2+ by using Windows-specific file sharing flags. Update to the latest version.

**Workaround (if on older version):**
1. Stop the node temporarily
2. View/copy the log file manually from `%APPDATA%\archivist\node.log`
3. Restart the node

See [Windows Development](#windows-development) section for technical details.

### Release Build: Video Not Playing (Linux)

**Problem:** Splash screen video plays in dev mode and debug builds but fails in release builds.

**Cause:** Tauri's asset protocol behaves differently between debug and release builds. Direct `<source>` paths in video elements aren't properly served in release mode, even with correct CSP settings.

**Solution:** Fixed in v0.2.0 by loading video as blob URL instead of direct source paths:
1. Video is fetched using `fetch()` API
2. Response is converted to a blob
3. Blob URL is created with `URL.createObjectURL()`
4. Blob URL is used as video `src` attribute
5. Falls back to CSS animation if blob loading fails

**Technical Details:**
- The CSP allows `blob:` in `media-src`
- `fetch()` can access bundled assets in both debug and release mode
- Blob URLs bypass Tauri's asset protocol differences entirely

**Files:** [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx) - `loadVideoAsBlob()` function and `SplashScreen` component

## Security

### Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Archivist Desktop                         │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  React Frontend │────│     Tauri Rust Backend          │ │
│  │  (Webview)      │IPC │     (Native Process)            │ │
│  └─────────────────┘    └──────────────┬──────────────────┘ │
│                                        │ HTTP (localhost)   │
│                         ┌──────────────▼──────────────────┐ │
│                         │   archivist-node Sidecar        │ │
│                         │   (Separate Process)            │ │
│                         └──────────────┬──────────────────┘ │
│                                        │ P2P (encrypted)    │
└────────────────────────────────────────┼────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   External Peers    │
                              │   (libp2p network)  │
                              └─────────────────────┘
```

### Security Controls

| Layer | Control |
|-------|---------|
| Frontend | Content Security Policy (CSP), React XSS prevention |
| IPC | Tauri command allowlist, capability-based permissions |
| Backend | Input validation, path sanitization, error handling |
| Sidecar | Process isolation, localhost-only binding |
| Network | TLS for GitHub API, libp2p encryption for P2P |

### Reporting Security Vulnerabilities

**Please do NOT report security vulnerabilities through public GitHub issues.**

Report via:
1. **Email**: devops@durability.dev
2. **GitHub Security Advisories**: Use the Security tab

**Include:**
- Type of vulnerability
- Full paths of affected files
- Steps to reproduce
- Proof-of-concept if possible
- Impact assessment

**Response Timeline:**
- Initial Response: Within 48 hours
- Status Update: Within 7 days
- Resolution Target: Within 30 days for critical issues

### Verifying Downloads

All official releases are:
- Published on GitHub Releases
- Signed with Tauri update key (pubkey in `src-tauri/tauri.conf.json`)

Sidecar binaries include SHA256 checksum verification in download script.

### Network Security

- archivist-node API binds to `127.0.0.1` (localhost only)
- P2P connections use libp2p with encrypted channels
- No external API calls except update checks to GitHub

## Version History

### v0.2.0 (Current)

Major UI/UX overhaul focused on simplifying the first-run experience.

#### Onboarding System

- **New 5-step onboarding wizard** for first-time users
  - Splash screen with video or CSS-animated fallback
  - Welcome screen with value proposition
  - Auto-starting node with progress indicator
  - Folder selection (Quick Backup or Choose Folder)
  - Sync progress timeline with completion confirmation
- **Goal**: First backup complete in ≤30 seconds with ≤3 user decisions
- **Files**: [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx), [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts), [src/styles/Onboarding.css](src/styles/Onboarding.css)

#### Video Splash with CSS Fallback

- **Video formats**: WebM (VP8, 1.7MB) primary, MP4 (H.264, 34MB) fallback
- **CSS fallback**: Terminal aesthetic with breathing scale animation and phosphor green glow
- **Welcome screen**: Glow-intensity breathing animation (avoids opacity-based visual artifacts)
- **Platform handling**:
  - Windows/macOS: Video plays (built-in codecs)
  - Linux: CSS fallback immediately (WebKitGTK video unreliable)
- **Timeout**: 2 seconds before showing CSS fallback (Windows/macOS only)
- **Files**: [src-tauri/resources/intro.webm](src-tauri/resources/intro.webm), [src-tauri/resources/intro.mp4](src-tauri/resources/intro.mp4)

#### Post-Onboarding Navigation

- **Fix**: After onboarding completes, user is now redirected to Dashboard (was incorrectly going to Settings)
- **Implementation**: Uses localStorage flag to communicate across Router context switches
- **Component**: `OnboardingRedirect` in [src/App.tsx](src/App.tsx) handles the redirect inside the main Router

#### Graceful Error Handling

- **Quick Backup**: If quickstart folder is already being watched, error is silently ignored and flow continues
- **Use case**: Users re-running onboarding after reset don't see duplicate folder errors

#### CSP Fix for Bundled Video Playback

Video playback failed in bundled builds (release/debug) but worked in dev mode. The fix was adding `blob:` and `data:` to the Content Security Policy's `media-src` directive.

**Root Cause**: When Tauri serves bundled assets via the `tauri://` protocol, WebKitGTK internally converts media to blob/data URLs. The original CSP blocked these URLs.

**Fix** (in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)):
```diff
- media-src 'self' asset: https://asset.localhost
+ media-src 'self' asset: https://asset.localhost blob: data:
```

**Behavior by mode**:
| Mode | Video URL | CSP Match |
|------|-----------|-----------|
| Dev (`pnpm tauri dev`) | `http://localhost:1420/intro.webm` | `'self'` |
| Bundled (release/debug) | Internal blob/data conversion | `blob: data:` |

#### Navigation Restructure

- **Primary section**: Dashboard, Backups (renamed from Sync), Restore (renamed from Files)
- **Devices section**: My Devices, Add Device (new pages)
- **Advanced section**: Collapsible accordion containing Logs, Backup Server, Settings
- **Peers page removed**: Functionality consolidated into Devices page (route kept at `/peers` for backwards compatibility)
- **New files**: [src/pages/Devices.tsx](src/pages/Devices.tsx), [src/pages/AddDevice.tsx](src/pages/AddDevice.tsx), [src/components/NavAccordion.tsx](src/components/NavAccordion.tsx)

#### Peers → Devices Consolidation

The Peers page was redundant with the Devices page - both used the same `usePeers()` hook and `connectPeer()` function. The consolidation merged all peer management into the Devices page.

**Features added to Devices page**:
- **Disconnect button**: Disconnect from connected peers
- **Saved Devices section**: Shows offline/disconnected peers with Reconnect and Remove buttons
- **Latency display**: Shows ping time for connected peers
- **Refresh button**: Manually refresh peer list

**NavLink fix**: Added `end` prop to "My Devices" NavLink to prevent both "My Devices" and "Add Device" from highlighting when on `/devices/add`.

**Files changed**:
- [src/pages/Devices.tsx](src/pages/Devices.tsx) - Added peer management actions
- [src/styles/Devices.css](src/styles/Devices.css) - Added styles for new elements
- [src/App.tsx](src/App.tsx) - Removed Peers from nav, added `end` prop

#### Backups Page Description Update

Updated "How Sync Works" to "How Backups Work" with accurate description of the manifest-based backup workflow:
- Changed terminology from "sync" to "backup"
- Replaced passive P2P sharing description with manifest-based backup explanation
- Added pointer to Settings → Backup Server for configuration

#### Dashboard Enhancement

- **Card Layout Order** (BasicView): Status Hero → Quick Stats → Share Your Connection → Next Steps → Recent Activity
- **NextSteps panel**: Post-onboarding guidance cards (Add backup folder, Connect a peer)
- **Quick Stats**: Connected Peers (clickable → Devices), Storage Used, Last Backup (clickable → Backups)
- **Recent Activity**: Shows last 3 uploaded files
- **Files**: [src/components/NextSteps.tsx](src/components/NextSteps.tsx), [src/styles/NextSteps.css](src/styles/NextSteps.css)

#### Dashboard Peer Count Fix

**Problem**: Connected Peers on Dashboard always showed 0, even when peers were connected and visible on the Devices page.

**Root Cause**: The `status.peerCount` from `useNode` hook was never populated by the backend - the `/debug/info` API endpoint doesn't include peer count. The peer data is retrieved via a separate `get_peers` command used by the `usePeers` hook.

**Solution**: Import `usePeers` hook in Dashboard and calculate the connected peer count directly:
```typescript
const { peerList } = usePeers();
const connectedPeerCount = peerList.peers.filter(p => p.connected).length;
```

**Changes**:
- Added `usePeers` import to [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx)
- Added `connectedPeerCount` prop to `BasicViewProps` and `AdvancedViewProps`
- Updated BasicView and AdvancedView to use actual peer count
- Fixed `hasConnectedPeers` check for NextSteps panel
- Made Connected Peers stat clickable (navigates to `/devices`)

#### Linux Video Playback (Known Limitation)

**Problem**: Video splash doesn't play in release builds on Linux with WebKitGTK, even with GStreamer plugins installed and correct CSP configuration.

**Approaches Tried** (none worked on Linux):
1. **Standard paths** (`/intro.webm`) - Video fails to load
2. **Asset protocol URLs** (`https://asset.localhost/intro.webm`) - Video fails to load
3. **Tauri resources** with `resolveResource()` + `convertFileSrc()` - Video fails to load
4. **Blob URL loading** via `fetch()` - Video starts but gets stuck partway
5. **VP8 codec** instead of VP9 - Same behavior
6. **CSP fixes** - Added `blob: data:` to `media-src` - Didn't help

**Root Cause**: WebKitGTK's video playback is fundamentally unreliable in Tauri applications on Linux. Even with:
- All GStreamer plugins installed (`gstreamer1.0-plugins-base/good/bad/ugly`, `gstreamer1.0-libav`)
- Correct CSP configuration
- Multiple URL patterns and codec formats

The video either fails to load entirely or gets stuck during playback.

**Solution**: Platform detection with immediate CSS fallback on Linux.

```typescript
// In src/pages/Onboarding.tsx
const isLinux = navigator.userAgent.toLowerCase().includes('linux');

if (isTauri && isLinux) {
  // On Linux, WebKitGTK video playback is unreliable
  // Use CSS fallback directly for a better, faster experience
  console.log('SplashScreen: Linux detected, using CSS fallback');
  setShowFallback(true);
  return;
}
```

**Current behavior**:
| Platform | Splash Screen |
|----------|--------------|
| **Linux** | CSS animated fallback (immediate) |
| **Windows** | Video playback via WebView2 |
| **macOS** | Video playback via Safari WebView |
| **Dev mode** | Video playback via Vite dev server |

**Video files bundled** (for Windows/macOS):
- `src-tauri/resources/intro.webm` - VP8 codec, 1.7MB
- `src-tauri/resources/intro.mp4` - H.264 codec, 34MB

**GStreamer packages** (still included in .deb for other media features):
- `gstreamer1.0-plugins-base`
- `gstreamer1.0-plugins-good`
- `gstreamer1.0-plugins-bad`
- `gstreamer1.0-plugins-ugly`
- `gstreamer1.0-libav`

#### README.md Updates

- **Added Alpha/Pilot Program Disclaimer**: Prominent warning at top of README about data loss risks
- **Updated Tech Stack**: Converted to table format, updated versions (Node.js 20+, pnpm v10+, Rust 1.77.2+)
- **Expanded Features List**: Added Guided Onboarding, Backup Server, Sound Notifications
- **Updated Architecture Diagram**: Reflects new navigation (Backups, Restore, Devices) and Backup Daemon
- **Expanded Project Structure**: Added all new components, hooks, pages, and services
- **Added Configuration Tables**: Node Configuration and Backup Server Configuration with defaults
- **Improved Network Setup**: Converted to table format for clarity
- **Added Key Features Table**: Includes n:1 Fan-In and Content Deduplication
- **Added Troubleshooting Section**: Common issues table and log file locations
- **Added Resources Section**: Links to repositories and CLAUDE.md

---

### v0.1.2
- **Feature:** Added built-in Logs viewer for real-time node log monitoring
  - New Logs page with auto-refresh and auto-scroll capabilities
  - Line count control (100, 500, 1000, 5000)
  - Copy all logs and scroll to bottom controls
  - Smart auto-scroll that detects manual scrolling
- **Fixed:** Port architecture - separated discovery and listen ports
  - Discovery port (UDP 8090) for DHT/mDNS peer discovery
  - Listen port (TCP 8070) for P2P connections
  - Previously used single `p2p_port` for both functions
- **Fixed:** Configuration synchronization between AppConfig and NodeConfig
  - Settings now properly persist and apply on app restart
  - Added conversion from NodeSettings to NodeConfig
- **Fixed:** CSS contrast issues in dropdown menus
  - Improved text visibility in both light and dark modes
  - Applied to Settings and Logs page dropdowns
- **Added:** `get_node_logs` and `get_node_log_path` Tauri commands
- **Added:** `--log-file` flag to sidecar startup

### v0.1.1
- **Fixed:** Upload API changed from multipart/form-data to raw binary
- File sync now works correctly
- Updated node API client in `src-tauri/src/node_api.rs`

### v0.1.0
- **Initial release** with core decentralized storage functionality
- **Core Features:**
  - File upload/download with CID-based content addressing
  - P2P peer connections via libp2p
  - Folder watching and automatic sync
  - System tray integration for background operation
  - Auto-update support from GitHub releases

#### Hybrid Manifest Discovery System

- **Architecture:** Two-machine backup system using HTTP for discovery + P2P for data transfer
  - **Machine A (Source):** Runs manifest discovery server exposing folder manifest CIDs via HTTP
  - **Machine B (Backup):** Runs backup daemon that polls source peers for manifests, downloads via P2P
- **New Services:**
  - `ManifestServer` ([src-tauri/src/services/manifest_server.rs](src-tauri/src/services/manifest_server.rs)): HTTP server with IP whitelist security
  - `BackupDaemon` ([src-tauri/src/services/backup_daemon.rs](src-tauri/src/services/backup_daemon.rs)): Polls source peers, processes manifests
  - `ManifestClient`: HTTP client for querying remote manifest servers
- **Settings UI:** New sections in Settings page for:
  - **Manifest Server** (Machine A): Enable/disable, port config, IP whitelist management
  - **Backup Server** (Machine B): Enable/disable, poll interval, max concurrent downloads, source peer management
- **Security:** IP whitelist for manifest server (secure by default - empty whitelist denies all)

#### Bug Fixes

- **Windows Startup Crash Fix**
  - **Problem:** App crashed on Windows when launched from installer - nothing happened after install
  - **Cause:** `tokio::spawn()` called in `AppState::new()` before Tauri runtime initialized (no tokio runtime available)
  - **Solution:**
    - Added `ManifestServer::with_config()` constructor for synchronous initialization
    - Moved backup daemon source peer configuration to `lib.rs` `setup()` closure where async runtime is available
  - **Fixed in:** [src-tauri/src/state.rs](src-tauri/src/state.rs), [src-tauri/src/lib.rs](src-tauri/src/lib.rs), [src-tauri/src/services/manifest_server.rs](src-tauri/src/services/manifest_server.rs)

#### New UX Features

- **Sound Notifications** (see [User Experience Features](#sound-notifications))
  - Audio feedback for three key events: node startup, peer connection, file download
  - Configurable in Settings → Notifications with master toggle, per-event toggles, and volume control
  - Uses Web Audio API for cross-platform compatibility (no external audio files needed)
  - Different tonal patterns for each event type (major chord, two-note sequences)
  - Emits Tauri events from Rust backend (`node-started`, `peer-connected`, `file-downloaded`)
  - Frontend hook: [src/hooks/useSoundNotifications.ts](src/hooks/useSoundNotifications.ts)
  - Backend events: [src-tauri/src/services/node.rs](src-tauri/src/services/node.rs#L89), [src-tauri/src/commands/peers.rs](src-tauri/src/commands/peers.rs), [src-tauri/src/commands/files.rs](src-tauri/src/commands/files.rs)

- **Auto-Trigger Download on CID Paste** (see [User Experience Features](#auto-trigger-download-on-cid-paste))
  - Streamlined download workflow: paste CID → auto-prompt for save location (300ms debounce)
  - Eliminates traditional two-step process (paste, then click button)
  - Real-time CID validation with visual feedback:
    - Green border for valid CID format (CIDv0/v1, 46-100 chars, starts with z/Q)
    - Red border for invalid format with inline error message
  - Smart behavior:
    - Uses `onPaste` event handler (not useEffect) for clear user intent
    - Cancels auto-download if user edits the field
    - Disabled when node not connected
    - Manual download button remains as fallback
  - New validation utility: [src/lib/cidValidation.ts](src/lib/cidValidation.ts)
  - Implementation: [src/pages/Files.tsx](src/pages/Files.tsx) `handleCidPaste` callback
  - Styling: [src/styles/App.css](src/styles/App.css) `.cid-input-valid`, `.cid-input-invalid`

#### Bug Fixes

- **Windows File Locking Fix**
  - **Problem:** "IO error: The process cannot access the file because it is being used by another process. (os error 32)" when viewing logs
  - **Cause:** Windows file locking prevents reading log file while archivist-node writes to it
  - **Solution:** Uses `FILE_SHARE_READ | FILE_SHARE_WRITE` flags in `OpenOptions` on Windows
  - **Fixed in:** [src-tauri/src/commands/node.rs](src-tauri/src/commands/node.rs) `get_node_logs` command
  - **Platform-specific:** Only affects Windows, Linux/macOS use standard file opening

- **Backup Daemon Network Download Fix**
  - **Problem:** Backup daemon failed to download manifests from source peers with "error sending request for url" errors
  - **Cause:** The daemon attempted to fetch files via `/data/{cid}/network` without first establishing a P2P connection to the source peer
  - **Solution:**
    - Added peer connection step before network downloads in `process_manifest()`
    - Store `multiaddr` in `FailedManifest` struct for retry attempts
    - Pass peer_id and multiaddr through the manifest processing chain
  - **Fixed in:** [src-tauri/src/services/backup_daemon.rs](src-tauri/src/services/backup_daemon.rs)
  - **Affected methods:** `process_manifest()`, `finalize_manifest_processing()`, `retry_failed_manifests()`, `retry_manifest()`

#### Documentation

- **Added:** Architecture diagram to [README.md](README.md) showing:
  - React Frontend ↔ Tauri Backend (IPC communication)
  - Tauri Backend ↔ archivist-node Sidecar (HTTP localhost:8080)
  - archivist-node ↔ External Peers (P2P encrypted libp2p)
- **Added:** Comprehensive developer documentation in [CLAUDE.md](CLAUDE.md):
  - Complete API reference for archivist-node REST endpoints
  - Tauri command reference with TypeScript examples
  - P2P testing guide for multi-machine setups
  - Windows development guide with known issues and solutions
  - CI/CD pipeline documentation
  - Logs and debugging guide

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/node_api.rs` | HTTP client for sidecar API |
| `src-tauri/src/services/sync.rs` | File watching + upload queue |
| `src-tauri/src/services/node.rs` | Sidecar process management |
| `src-tauri/src/services/config.rs` | Settings persistence and configuration |
| `src-tauri/src/services/backup_daemon.rs` | Backup daemon that polls source peers for manifests |
| `src-tauri/src/services/manifest_server.rs` | HTTP manifest discovery server with IP whitelist |
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
| `src/components/NextSteps.tsx` | Post-onboarding guidance cards |
| `src/components/NavAccordion.tsx` | Collapsible navigation section |
| `src/styles/Onboarding.css` | Onboarding styles with CSS fallback animation |
| `src/styles/NextSteps.css` | NextSteps component styling |
| `src/styles/Logs.css` | Logs page styling |
| `src/styles/App.css` | Global styles, dropdown contrast fixes, CID validation styling |
| `public/intro.webm` | Splash video (WebM/VP9, 7.3MB) |
| `public/intro.mp4` | Splash video (MP4/H.264, 33MB) |
| `scripts/download-sidecar.sh` | Sidecar binary downloader |
| `src-tauri/tauri.conf.json` | Tauri app configuration |
| `.github/workflows/ci.yml` | CI pipeline configuration |
| `.github/workflows/release.yml` | Release pipeline configuration |

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
    // ... etc
}
```

All errors serialize to JSON for frontend consumption.

## Resources

- **GitHub Repository**: https://github.com/basedmint/archivist-desktop
- **Sidecar Repository**: https://github.com/durability-labs/archivist-node
- **Tauri Documentation**: https://tauri.app
- **libp2p Documentation**: https://docs.libp2p.io
- **React Router Documentation**: https://reactrouter.com
- **Vitest Documentation**: https://vitest.dev

---

*Last Updated: 2026-01-19*
