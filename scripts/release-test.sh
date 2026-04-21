#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Release Test Runner for Archivist Desktop
# Kills running processes, uninstalls the app, purges all data,
# builds a fresh release, installs it, and runs E2E smoke tests.
#
# Usage:
#   ./scripts/release-test.sh              # Full: kill + purge + build + install + test
#   ./scripts/release-test.sh --skip-build # Kill + purge + install (existing build) + test
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SKIP_BUILD=false
USE_PLAYWRIGHT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-build) SKIP_BUILD=true; shift ;;
    --playwright) USE_PLAYWRIGHT=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--skip-build] [--playwright]"
      echo "  --skip-build   Skip build step, use existing release binary"
      echo "  --playwright   Force Playwright tests (auto-detected on macOS)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

TOTAL_STEPS=8

echo "=== Archivist Desktop Release Test ==="
echo ""

# 1. Kill running Archivist processes
echo -e "${BLUE}[1/$TOTAL_STEPS]${NC} Killing running processes..."
KILLED=false

# Kill Archivist Desktop app
if pgrep -f "archivist-desktop" > /dev/null 2>&1; then
  pkill -f "archivist-desktop" 2>/dev/null && KILLED=true
  echo -e "  ${GREEN}✓${NC} Killed archivist-desktop"
fi

# Kill archivist-node sidecar
if pgrep -f "archivist-devnet|archivist-aarch64|archivist-x86_64" > /dev/null 2>&1; then
  pkill -f "archivist-devnet|archivist-aarch64|archivist-x86_64" 2>/dev/null && KILLED=true
  echo -e "  ${GREEN}✓${NC} Killed archivist-node sidecar"
fi

# macOS: also quit via osascript for clean shutdown
if [ "$(uname -s)" = "Darwin" ]; then
  osascript -e 'quit app "Archivist"' 2>/dev/null || true
fi

if [ "$KILLED" = false ]; then
  echo -e "  ${YELLOW}!${NC} No running processes found"
fi

# Brief pause to let processes exit
sleep 1

# 2. Uninstall existing app and purge data
echo -e "${BLUE}[2/$TOTAL_STEPS]${NC} Uninstalling app and purging data..."
case "$(uname -s)" in
  Darwin)
    # Remove installed app
    if [ -d "/Applications/Archivist.app" ]; then
      rm -rf "/Applications/Archivist.app"
      echo -e "  ${GREEN}✓${NC} Removed /Applications/Archivist.app"
    fi
    # Purge data directory (node repo, config, logs, binaries)
    DATA_DIR="$HOME/Library/Application Support/archivist"
    if [ -d "$DATA_DIR" ]; then
      rm -rf "$DATA_DIR"
      echo -e "  ${GREEN}✓${NC} Purged: $DATA_DIR"
    fi
    # Purge Tauri app config/webview data
    TAURI_DATA="$HOME/Library/Application Support/storage.archivist.desktop"
    if [ -d "$TAURI_DATA" ]; then
      rm -rf "$TAURI_DATA"
      echo -e "  ${GREEN}✓${NC} Purged: $TAURI_DATA"
    fi
    ;;
  Linux)
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/archivist"
    if [ -d "$DATA_DIR" ]; then
      rm -rf "$DATA_DIR"
      echo -e "  ${GREEN}✓${NC} Purged: $DATA_DIR"
    fi
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/archivist"
    if [ -d "$CONFIG_DIR" ]; then
      rm -rf "$CONFIG_DIR"
      echo -e "  ${GREEN}✓${NC} Purged: $CONFIG_DIR"
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    if [ -n "${APPDATA:-}" ] && [ -d "$APPDATA/archivist" ]; then
      rm -rf "$APPDATA/archivist"
      echo -e "  ${GREEN}✓${NC} Purged: $APPDATA/archivist"
    fi
    ;;
esac

echo -e "  ${GREEN}✓${NC} Clean state"

# 3. Check test driver (tauri-driver or Playwright)
echo -e "${BLUE}[3/$TOTAL_STEPS]${NC} Checking test driver..."
PLATFORM="$(uname -s)"

case "$PLATFORM" in
  Darwin)
    USE_PLAYWRIGHT=true
    echo -e "  ${YELLOW}!${NC} macOS detected — using Playwright (tauri-driver not supported)"
    ;;
  *)
    if [ "$USE_PLAYWRIGHT" = false ]; then
      if command -v tauri-driver &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} tauri-driver found"
      else
        echo -e "  ${YELLOW}!${NC} tauri-driver not found, falling back to Playwright"
        USE_PLAYWRIGHT=true
      fi
    else
      echo -e "  ${YELLOW}!${NC} Playwright mode forced via --playwright"
    fi
    ;;
esac

if [ "$USE_PLAYWRIGHT" = true ]; then
  # Verify Playwright is available
  if ! pnpm exec playwright --version &> /dev/null; then
    echo -e "  ${RED}✗${NC} Playwright not found"
    echo "  Install with: pnpm install && pnpm exec playwright install chromium"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC} Playwright found"
fi

# 4. Check sidecar
echo -e "${BLUE}[4/$TOTAL_STEPS]${NC} Checking sidecar binary..."
SIDECAR_DIR="$ROOT_DIR/src-tauri/sidecars"
if ls "$SIDECAR_DIR"/archivist-* 1> /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Sidecar found"
else
  echo -e "  ${YELLOW}!${NC} Sidecar not found, downloading..."
  cd "$ROOT_DIR"
  pnpm download-sidecar
fi

# 5. Build release (unless --skip-build)
echo -e "${BLUE}[5/$TOTAL_STEPS]${NC} Building release..."
if [ "$SKIP_BUILD" = true ]; then
  echo -e "  ${YELLOW}Skipped${NC} (--skip-build)"
else
  cd "$ROOT_DIR"
  pnpm tauri build
  echo -e "  ${GREEN}✓${NC} Build complete"
fi

# 6. Verify release binary exists
echo -e "${BLUE}[6/$TOTAL_STEPS]${NC} Verifying release binary..."
BINARY=""
for candidate in \
  "$ROOT_DIR/src-tauri/target/release/bundle/macos/Archivist.app/Contents/MacOS/archivist-desktop" \
  "$ROOT_DIR/src-tauri/target/release/archivist-desktop" \
  "$ROOT_DIR/src-tauri/target/release/archivist-desktop.exe" \
; do
  if [ -f "$candidate" ]; then
    BINARY="$candidate"
    break
  fi
done

if [ -n "$BINARY" ]; then
  echo -e "  ${GREEN}✓${NC} Found: $BINARY"
else
  echo -e "  ${RED}✗${NC} Release binary not found"
  exit 1
fi

# 7. Install fresh build
echo -e "${BLUE}[7/$TOTAL_STEPS]${NC} Installing fresh build..."
case "$(uname -s)" in
  Darwin)
    APP_BUNDLE="$ROOT_DIR/src-tauri/target/release/bundle/macos/Archivist.app"
    if [ -d "$APP_BUNDLE" ]; then
      cp -R "$APP_BUNDLE" /Applications/Archivist.app
      echo -e "  ${GREEN}✓${NC} Installed to /Applications/Archivist.app"
    else
      echo -e "  ${YELLOW}!${NC} No .app bundle found (binary-only build)"
    fi
    ;;
  *)
    echo -e "  ${YELLOW}!${NC} Auto-install not supported on this platform"
    ;;
esac

# 8. Run E2E smoke tests
echo -e "${BLUE}[8/$TOTAL_STEPS]${NC} Running E2E smoke tests..."

if [ "$USE_PLAYWRIGHT" = true ]; then
  echo "  Using Playwright (testing against Vite dev server)..."
  # Remove stale playwright from e2e/node_modules to prevent version conflict
  # (e2e/ is a WebDriverIO project; its transitive playwright can clash with root @playwright/test)
  if [ -d "$E2E_DIR/node_modules/playwright" ]; then
    rm -rf "$E2E_DIR/node_modules/playwright"
    echo "  Cleaned stale e2e/node_modules/playwright"
  fi
  echo ""
  cd "$ROOT_DIR"
  pnpm exec playwright test --config e2e/playwright/playwright.config.ts
else
  echo "  Using WebDriverIO + tauri-driver..."
  cd "$E2E_DIR"
  if [ ! -d "node_modules/@wdio" ]; then
    echo "  Installing e2e dependencies..."
    npm install
  fi
  echo ""
  export RELEASE_BUILD=1
  npx wdio run wdio.conf.ts --mochaOpts.grep @smoke
fi

echo ""
echo -e "${GREEN}=== Release test completed ===${NC}"
