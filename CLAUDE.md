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
14. [Windows Development](#windows-development)
15. [User Experience Features](#user-experience-features)
16. [Troubleshooting](#troubleshooting)
17. [Security](#security)
18. [Version History](#version-history)

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
│   │       └── config.rs        # Settings persistence
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

The application uses **two separate ports** for P2P networking:

#### Discovery Port (UDP - Default: 8090)
- **Purpose**: Peer discovery via DHT (Distributed Hash Table) and mDNS
- **Protocol**: UDP
- **Command-line flag**: `--disc-port=8090`
- **Used for**: Finding other nodes on the network, announcing presence
- **Configuration**: `discovery_port` in NodeConfig/NodeSettings

#### Listen Port (TCP - Default: 8070)
- **Purpose**: Actual P2P data connections and file transfers
- **Protocol**: TCP
- **Command-line flag**: `--listen-addrs=/ip4/0.0.0.0/tcp/8070`
- **Used for**: Establishing connections, transferring files, syncing data
- **Configuration**: `listen_port` in NodeConfig/NodeSettings

#### Why Two Ports?

1. **Protocol Separation**: UDP for lightweight discovery, TCP for reliable data transfer
2. **Network Flexibility**: Some networks may treat UDP and TCP differently
3. **Firewall Optimization**: Allows granular control over discovery vs data traffic
4. **Port Forwarding**: Can forward only the listen port for direct connections while using discovery locally

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

Open **both ports** in your firewall for full P2P functionality:
- **Port 8090 (UDP)**: Discovery/DHT
- **Port 8070 (TCP)**: P2P connections

#### Linux (UFW)
```bash
# Discovery port (UDP)
sudo ufw allow 8090/udp
# Listen port (TCP)
sudo ufw allow 8070/tcp
```

#### macOS
System Preferences → Security & Privacy → Firewall → Allow Archivist Desktop

#### Windows
```powershell
# Run as Administrator
# Discovery port (UDP)
netsh advfirewall firewall add rule name="Archivist Discovery" dir=in action=allow protocol=udp localport=8090
# Listen port (TCP)
netsh advfirewall firewall add rule name="Archivist P2P" dir=in action=allow protocol=tcp localport=8070
```

### Cross-Network Testing

For internet connections, configure port forwarding on your router:
1. Forward **both ports** to your machine's local IP:
   - Port 8090 (UDP) - Discovery
   - Port 8070 (TCP) - P2P connections
2. Find your public IP: `curl ifconfig.me`
3. Your multiaddr uses the **listen port** (TCP): `/ip4/YOUR_PUBLIC_IP/tcp/8070/p2p/YOUR_PEER_ID`

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
let log_file = std::path::Path::new(&config.data_dir)
    .parent()
    .unwrap_or(std::path::Path::new(&config.data_dir))
    .join("node.log");

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

### v0.1.2 (Current)
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
| `src-tauri/src/commands/node.rs` | Node control commands including diagnostics and logs |
| `src-tauri/src/commands/files.rs` | File upload/download commands with event emissions |
| `src-tauri/src/commands/peers.rs` | Peer connection commands with event emissions |
| `src-tauri/src/state.rs` | AppState initialization and config sync |
| `src/hooks/useNode.ts` | Node state management hook |
| `src/hooks/useSync.ts` | Sync state management hook |
| `src/hooks/useSoundNotifications.ts` | Sound notification event listener hook |
| `src/lib/cidValidation.ts` | CID format validation utility |
| `src/pages/Dashboard.tsx` | Main UI with diagnostics panel |
| `src/pages/Files.tsx` | File management with auto-download on paste |
| `src/pages/Logs.tsx` | Real-time node logs viewer |
| `src/pages/Settings.tsx` | App configuration with notification settings |
| `src/styles/Logs.css` | Logs page styling |
| `src/styles/App.css` | Global styles, dropdown contrast fixes, CID validation styling |
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
