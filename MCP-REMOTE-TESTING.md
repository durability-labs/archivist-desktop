# MCP Server for Cross-Machine Archivist Testing

## Overview

Design and implementation of an MCP (Model Context Protocol) server that enables Claude Code to coordinate testing of Archivist Desktop across multiple machines from a single instance.

## Problem Statement

Currently testing the hybrid sync feature requires:
- Manual SSH into each machine
- Running commands separately on Machine A and Machine B
- Context switching between terminals
- No unified view of both machines' state

## Solution

Build an MCP server that:
1. Runs on Machine B (Ubuntu - where Claude Code runs)
2. Exposes tools for both local and remote operations
3. Allows Claude Code to orchestrate cross-machine test scenarios

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code (Machine B)                      │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    MCP Client                             │   │
│  └─────────────────────────┬────────────────────────────────┘   │
│                            │ stdio/SSE                           │
│  ┌─────────────────────────▼────────────────────────────────┐   │
│  │              Archivist Test MCP Server                    │   │
│  │                                                           │   │
│  │  Tools:                                                   │   │
│  │  ├── local_node_status      (Machine B)                   │   │
│  │  ├── local_node_api         (Machine B)                   │   │
│  │  ├── local_daemon_state     (Machine B)                   │   │
│  │  ├── remote_node_status     (Machine A via SSH)           │   │
│  │  ├── remote_node_api        (Machine A via HTTP)          │   │
│  │  ├── remote_exec            (Machine A via SSH)           │   │
│  │  ├── sync_test              (Coordinated test)            │   │
│  │  └── compare_storage        (Cross-machine comparison)    │   │
│  └──────────────┬───────────────────────┬───────────────────┘   │
│                 │                       │                        │
└─────────────────┼───────────────────────┼────────────────────────┘
                  │                       │
     ┌────────────▼────────────┐   ┌──────▼──────────────────┐
     │    Machine B (Local)    │   │   Machine A (Remote)    │
     │    Ubuntu/Linux         │   │   Windows               │
     │                         │   │                         │
     │  - Archivist Node API   │   │  - Archivist Node API   │
     │  - Backup Daemon        │   │  - Manifest Server      │
     │  - Local filesystem     │   │  - Sync Service         │
     └─────────────────────────┘   └─────────────────────────┘
```

## Configuration

```toml
# ~/.config/archivist-mcp/config.toml

[local]
node_api_port = 8080
data_dir = "/home/anon/.local/share/archivist"

[remote.machine_a]
name = "Machine A (Windows)"
host = "99.74.3.238"
ssh_user = "anon"
ssh_key = "~/.ssh/id_rsa"  # or use Tailscale
node_api_port = 8080
manifest_port = 8085
```

## MCP Tools Design

### 1. Node Status Tools

```typescript
// local_node_status - Get local node status
{
  name: "local_node_status",
  description: "Get Archivist node status on local machine (Machine B)",
  inputSchema: {},
  returns: {
    running: boolean,
    peer_id: string,
    storage_used: number,
    connected_peers: number
  }
}

// remote_node_status - Get remote node status via SSH or HTTP
{
  name: "remote_node_status",
  description: "Get Archivist node status on remote machine (Machine A)",
  inputSchema: {
    machine: string  // "machine_a" from config
  },
  returns: { ... }
}
```

### 2. API Proxy Tools

```typescript
// local_node_api - Call local node API
{
  name: "local_node_api",
  description: "Make API call to local Archivist node",
  inputSchema: {
    method: "GET" | "POST" | "DELETE",
    endpoint: string,  // e.g., "/data", "/space", "/debug/info"
    body?: object
  }
}

// remote_node_api - Call remote node API
{
  name: "remote_node_api",
  description: "Make API call to remote Archivist node",
  inputSchema: {
    machine: string,
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    body?: object
  }
}
```

### 3. Daemon State Tools

```typescript
// local_daemon_state - Get backup daemon state
{
  name: "local_daemon_state",
  description: "Get backup daemon state from local machine",
  inputSchema: {},
  returns: {
    processed_manifests: object[],
    failed_manifests: object[],
    stats: object
  }
}
```

### 4. File System Tools

```typescript
// list_local_files - List files in local watched folder
{
  name: "list_local_files",
  description: "List files in a directory on local machine",
  inputSchema: {
    path: string
  }
}

// list_remote_files - List files on remote machine via SSH
{
  name: "list_remote_files",
  description: "List files in a directory on remote machine",
  inputSchema: {
    machine: string,
    path: string
  }
}
```

### 5. Coordinated Test Tools

```typescript
// sync_test - Run coordinated sync test
{
  name: "sync_test",
  description: "Run end-to-end sync test between machines",
  inputSchema: {
    test_type: "upload_and_verify" | "manifest_sync" | "deletion_sync",
    source_machine: string,
    target_machine: string,
    options?: object
  }
}

// compare_storage - Compare CIDs between machines
{
  name: "compare_storage",
  description: "Compare stored CIDs between two machines",
  inputSchema: {
    machines: string[]  // ["local", "machine_a"]
  },
  returns: {
    common: string[],
    only_local: string[],
    only_remote: string[]
  }
}
```

## Implementation Plan

### Phase 1: Basic MCP Server
- [ ] Set up MCP server scaffold (TypeScript or Python)
- [ ] Implement local node status tool
- [ ] Implement local node API proxy tool
- [ ] Test with Claude Code

### Phase 2: Remote Access
- [ ] Add SSH connection handling for Machine A
- [ ] Implement remote node status tool
- [ ] Implement remote node API proxy tool
- [ ] Handle Windows-specific paths

### Phase 3: Coordinated Testing
- [ ] Implement sync_test tool
- [ ] Implement compare_storage tool
- [ ] Add test result reporting

### Phase 4: Integration
- [ ] Add to Claude Code MCP configuration
- [ ] Document usage patterns
- [ ] Create test scenarios

## Technology Choices

**Option A: TypeScript MCP Server**
- Use `@modelcontextprotocol/sdk`
- Native async/await for HTTP calls
- `ssh2` package for remote execution

**Option B: Python MCP Server**
- Use `mcp` Python package
- `paramiko` for SSH
- `httpx` for async HTTP

**Recommendation**: TypeScript - better MCP SDK support, matches Archivist Desktop frontend stack.

## File Structure

```
archivist-mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── config.ts          # Configuration loading
│   ├── tools/
│   │   ├── local.ts       # Local machine tools
│   │   ├── remote.ts      # Remote machine tools
│   │   └── coordinated.ts # Cross-machine tools
│   └── utils/
│       ├── ssh.ts         # SSH connection helper
│       └── api.ts         # HTTP API helper
└── config.example.toml
```

## Current Status

| Task | Status | Notes |
|------|--------|-------|
| Design document | ✅ Complete | This file |
| MCP server scaffold | ⬜ Not started | |
| Local tools | ⬜ Not started | |
| Remote tools | ⬜ Not started | |
| Coordinated tests | ⬜ Not started | |

## Machine Information

**Machine A (Windows)**
- IP: 99.74.3.238
- Peer ID: 16Uiu2HAmG88f62kCxRksPEo5Ruc8vpbuzAorc1eriMaJANNdou1f
- Ports: 8080 (API), 8085 (Manifest), 8070 (P2P), 8090 (Discovery)

**Machine B (Ubuntu/Linux)**
- IP: 192.168.1.121 (LAN), 100.103.65.66 (Tailscale)
- Ports: 8080 (API), 8086 (Trigger), 8070 (P2P), 8090 (Discovery)

## Next Steps

1. Decide on implementation language (TypeScript recommended)
2. Set up project structure
3. Implement basic local tools first
4. Add remote connectivity
5. Build coordinated test scenarios
