#!/bin/bash
# Post-install script for Archivist Desktop .deb package
# Creates symlink for sidecar binary with target triple suffix

set -e

# The sidecar is installed as /usr/bin/archivist
# But Tauri looks for it with the target triple suffix at runtime
SIDECAR_PATH="/usr/bin/archivist"
SIDECAR_LINK="/usr/bin/archivist-x86_64-unknown-linux-gnu"

if [ -f "$SIDECAR_PATH" ] && [ ! -e "$SIDECAR_LINK" ]; then
    ln -s "$SIDECAR_PATH" "$SIDECAR_LINK"
    echo "Created sidecar symlink: $SIDECAR_LINK -> $SIDECAR_PATH"
fi

exit 0
