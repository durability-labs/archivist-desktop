#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Release Test Runner for Archivist Desktop
# Builds a release version, clears test data, then runs E2E smoke tests.
#
# Usage:
#   ./scripts/release-test.sh              # Build + clear + test
#   ./scripts/release-test.sh --skip-build # Clear + test (use existing build)
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

echo "=== Archivist Desktop Release Test ==="
echo ""

# 1. Check test driver (tauri-driver or Playwright)
echo -e "${BLUE}[1/6]${NC} Checking test driver..."
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

# 2. Check sidecar
echo -e "${BLUE}[2/6]${NC} Checking sidecar binary..."
SIDECAR_DIR="$ROOT_DIR/src-tauri/sidecars"
if ls "$SIDECAR_DIR"/archivist-* 1> /dev/null 2>&1; then
  echo -e "  ${GREEN}✓${NC} Sidecar found"
else
  echo -e "  ${YELLOW}!${NC} Sidecar not found, downloading..."
  cd "$ROOT_DIR"
  pnpm download-sidecar
fi

# 3. Build release (unless --skip-build)
echo -e "${BLUE}[3/6]${NC} Building release..."
if [ "$SKIP_BUILD" = true ]; then
  echo -e "  ${YELLOW}Skipped${NC} (--skip-build)"
else
  cd "$ROOT_DIR"
  pnpm tauri build
  echo -e "  ${GREEN}✓${NC} Build complete"
fi

# 4. Verify release binary exists
echo -e "${BLUE}[4/6]${NC} Verifying release binary..."
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

# 5. Clear archivist data directory
echo -e "${BLUE}[5/6]${NC} Clearing archivist data..."
DATA_DIR=""
case "$(uname -s)" in
  Darwin)
    DATA_DIR="$HOME/Library/Application Support/archivist"
    ;;
  Linux)
    DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/archivist"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    DATA_DIR="$APPDATA/archivist"
    ;;
esac

if [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ]; then
  rm -rf "$DATA_DIR"
  echo -e "  ${GREEN}✓${NC} Cleared: $DATA_DIR"
else
  echo -e "  ${YELLOW}!${NC} No data directory found (clean state)"
fi

# 6. Run E2E smoke tests
echo -e "${BLUE}[6/6]${NC} Running E2E smoke tests..."

if [ "$USE_PLAYWRIGHT" = true ]; then
  echo "  Using Playwright (testing against Vite dev server)..."
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
