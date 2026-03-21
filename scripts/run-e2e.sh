#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# E2E Test Runner for Archivist Desktop
# Uses WebdriverIO + tauri-driver to test the real Tauri WebView.
#
# Prerequisites:
#   sudo apt install webkit2gtk-driver          # WebKitWebDriver binary
#   cargo install tauri-driver --locked          # Tauri WebDriver proxy
#   pnpm tauri build --debug                     # Build debug binary
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
E2E_DIR="$ROOT_DIR/e2e"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== Archivist Desktop E2E Tests ==="
echo ""

# 1. Check prerequisites
echo -n "Checking tauri-driver... "
if command -v tauri-driver &> /dev/null; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${RED}NOT FOUND${NC}"
  echo "Install with: cargo install tauri-driver --locked"
  exit 1
fi

echo -n "Checking WebKitWebDriver... "
if command -v WebKitWebDriver &> /dev/null; then
  echo -e "${GREEN}OK${NC}"
elif [ -f /usr/lib/webkit2gtk-4.1/WebKitWebDriver ]; then
  echo -e "${GREEN}OK${NC} (at /usr/lib/webkit2gtk-4.1/WebKitWebDriver)"
else
  echo -e "${YELLOW}NOT FOUND (may still work if installed elsewhere)${NC}"
  echo "Install with: sudo apt install webkit2gtk-driver"
fi

# 2. Check for debug binary
echo -n "Checking debug binary... "
BINARY=""
for candidate in \
  "$ROOT_DIR/src-tauri/target/debug/archivist-desktop" \
  "$ROOT_DIR/src-tauri/target/debug/archivist-desktop.exe" \
; do
  if [ -f "$candidate" ]; then
    BINARY="$candidate"
    break
  fi
done

if [ -n "$BINARY" ]; then
  echo -e "${GREEN}OK${NC} ($BINARY)"
else
  echo -e "${YELLOW}NOT FOUND${NC}"
  echo "Building debug binary..."
  cd "$ROOT_DIR"
  pnpm tauri build --debug --no-bundle 2>&1 | tail -5
  echo ""
fi

# 3. Install e2e dependencies if needed
echo -n "Checking e2e dependencies... "
if [ -d "$E2E_DIR/node_modules/@wdio" ]; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${YELLOW}Installing...${NC}"
  cd "$E2E_DIR"
  npm install
  echo ""
fi

# 4. Run tests
echo ""
echo "Running E2E tests..."
echo ""
cd "$E2E_DIR"
npx wdio run wdio.conf.ts "$@"
