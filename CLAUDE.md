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
15. [Troubleshooting](#troubleshooting)
16. [Security](#security)
17. [Version History](#version-history)

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
  "addrs": ["/ip4/127.0.0.1/tcp/8090", "/ip4/192.168.0.1/tcp/8090"],
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
| `p2p_port` | `8090` | P2P discovery port |
| `max_storage_bytes` | 10GB | Storage quota |
| `auto_start` | `false` | Start node on app launch |
| `auto_restart` | `true` | Restart on failure |

### Sync Config

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable sync |
| `interval_secs` | `30` | Sync check interval |
| `batch_size` | `5` | Files per batch |

### Config File Locations

- **Linux**: `~/.config/archivist/config.toml`
- **macOS**: `~/Library/Application Support/archivist/config.toml`
- **Windows**: `%APPDATA%\archivist\config.toml`

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

#### Linux (UFW)
```bash
sudo ufw allow 8090/tcp
sudo ufw allow 8090/udp
```

#### macOS
System Preferences → Security & Privacy → Firewall → Allow Archivist Desktop

#### Windows
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="Archivist P2P" dir=in action=allow protocol=tcp localport=8090
netsh advfirewall firewall add rule name="Archivist P2P UDP" dir=in action=allow protocol=udp localport=8090
```

### Cross-Network Testing

For internet connections, configure port forwarding on your router:
1. Find your P2P port (default: 8090)
2. Forward port 8090 to your machine's local IP
3. Find your public IP: `curl ifconfig.me`
4. Your multiaddr: `/ip4/YOUR_PUBLIC_IP/tcp/8090/p2p/YOUR_PEER_ID`

### Diagnostic Commands

```bash
# Get node info
curl http://127.0.0.1:8080/api/archivist/v1/debug/info

# Get SPR
curl http://127.0.0.1:8080/api/archivist/v1/spr

# List connected peers
curl http://127.0.0.1:8080/api/archivist/v1/peers

# Check if P2P port is open
lsof -i :8090  # macOS/Linux
netstat -ano | findstr "8090"  # Windows
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
1. Check firewall allows port 8090 (P2P port)
2. Ensure you're connected to a network
3. Check Settings → Advanced → P2P Port configuration

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

### v0.1.1 (Current)
- **Fixed:** Upload API changed from multipart/form-data to raw binary
- File sync now works correctly
- Updated node API client in `src-tauri/src/node_api.rs`

### v0.1.0
- Initial release
- Core file upload/download functionality
- P2P peer connections
- Folder watching and sync
- System tray integration
- Auto-update support

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/node_api.rs` | HTTP client for sidecar API |
| `src-tauri/src/services/sync.rs` | File watching + upload queue |
| `src-tauri/src/services/node.rs` | Sidecar process management |
| `src-tauri/src/commands/node.rs` | Node control commands including diagnostics |
| `src/hooks/useNode.ts` | Node state management hook |
| `src/hooks/useSync.ts` | Sync state management hook |
| `src/pages/Dashboard.tsx` | Main UI with diagnostics panel |
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

*Last Updated: 2026-01-18*
