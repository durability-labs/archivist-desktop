# Archivist Desktop

A cross-platform desktop application for decentralized file storage, built with Tauri v2, React, and TypeScript.

## Features

- **File Management**: Upload, download, and manage files on the decentralized network
- **Folder Sync**: Watch folders and automatically sync changes to the network
- **Peer Network**: Connect with peers, share SPR records, and monitor network stats
- **System Tray**: Runs in the background with quick access from the system tray
- **Auto-Update**: Automatic updates from GitHub releases

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Backend**: Rust + Tauri v2
- **Node**: archivist-node sidecar for P2P networking

## Development

### Prerequisites

- Node.js 18+
- pnpm
- Rust 1.77+
- Platform-specific dependencies for Tauri

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

### Project Structure

```
archivist-desktop/
├── src/                    # React frontend
│   ├── components/         # Reusable UI components
│   ├── hooks/              # Custom React hooks
│   ├── pages/              # Page components
│   └── styles/             # CSS styles
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri command handlers
│   │   ├── services/       # Business logic services
│   │   ├── node_api.rs     # Node HTTP client
│   │   └── lib.rs          # App entry point
│   └── sidecars/           # archivist-node binary
└── public/                 # Static assets
```

## Configuration

Settings are stored in:
- **Linux**: `~/.config/archivist/config.toml`
- **macOS**: `~/Library/Application Support/archivist/config.toml`
- **Windows**: `%APPDATA%\archivist\config.toml`

## License

MIT
