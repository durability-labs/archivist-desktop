#!/bin/bash
# Download the archivist-node sidecar binary built from a pinned main-branch commit.
#
# Source of truth: durability-labs/archivist-node
# Pinned commit:   read from ARCHIVIST_NODE_COMMIT at the repo root (shared with .github/workflows/release.yml)
#
# This script uses GitHub Actions artifacts (not GitHub Releases) because
# main-branch builds are only published as workflow artifacts. This requires
# `gh` CLI to be installed and authenticated (`gh auth login`).
#
# To upgrade:
#   1. Pick a new commit on archivist-node main and confirm its "Release" workflow succeeded
#   2. Update the commit SHA in /ARCHIVIST_NODE_COMMIT (repo root)
#   3. Run this script for each platform you care about
#   4. Update the SHA256s in get_checksum() with the values printed at the end of each run
#
# Security: Verifies SHA256 checksums of downloaded binaries.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECARS_DIR="${SCRIPT_DIR}/../src-tauri/sidecars"
COMMIT_FILE="${SCRIPT_DIR}/../ARCHIVIST_NODE_COMMIT"

if [[ ! -f "${COMMIT_FILE}" ]]; then
    echo "ERROR: ${COMMIT_FILE} not found"
    echo "       This file is the single source of truth for the pinned archivist-node commit."
    exit 1
fi

# Read the pinned commit, strip whitespace/newlines
ARCHIVIST_COMMIT="$(tr -d '[:space:]' < "${COMMIT_FILE}")"
ARCHIVIST_REPO="durability-labs/archivist-node"

if [[ -z "${ARCHIVIST_COMMIT}" ]]; then
    echo "ERROR: ${COMMIT_FILE} is empty"
    exit 1
fi

# SHA256 checksums for binaries built from $ARCHIVIST_COMMIT.
# Update these whenever ARCHIVIST_COMMIT changes (script will print the actual hash).
get_checksum() {
    local platform="$1"
    case "$platform" in
        windows-amd64) echo "a4f9df9431a4fd917981d01fc1e3b96e9ddcfede25be252111b1fce721500f56" ;;
        # TODO: populate by running this script on each platform after bumping the commit
        linux-amd64)   echo "" ;;
        linux-arm64)   echo "" ;;
        darwin-amd64)  echo "" ;;
        darwin-arm64)  echo "" ;;
        *) echo "" ;;
    esac
}

# Set to "true" to skip checksum verification (NOT RECOMMENDED for production)
SKIP_CHECKSUM_VERIFY="${SKIP_CHECKSUM_VERIFY:-false}"

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="darwin" ;;
        MINGW*|MSYS*|CYGWIN*) os="windows" ;;
        *)
            echo "Unsupported OS: $(uname -s)"
            exit 1
            ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="amd64" ;;
        arm64|aarch64) arch="arm64" ;;
        *)
            echo "Unsupported architecture: $(uname -m)"
            exit 1
            ;;
    esac

    echo "${os}-${arch}"
}

# Get the Tauri target triple for the current platform
get_tauri_target() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="unknown-linux-gnu" ;;
        Darwin*) os="apple-darwin" ;;
        MINGW*|MSYS*|CYGWIN*) os="pc-windows-msvc" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x86_64" ;;
        arm64|aarch64) arch="aarch64" ;;
    esac

    echo "${arch}-${os}"
}

# Verify SHA256 checksum of a file
verify_checksum() {
    local file="$1"
    local expected_checksum="$2"
    local actual_checksum

    if command -v sha256sum &> /dev/null; then
        actual_checksum=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum &> /dev/null; then
        actual_checksum=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        echo "ERROR: No SHA256 tool found (sha256sum or shasum)"
        exit 1
    fi

    if [[ "$SKIP_CHECKSUM_VERIFY" == "true" ]]; then
        echo "WARNING: Skipping checksum verification (SKIP_CHECKSUM_VERIFY=true)"
        echo "Actual checksum: $actual_checksum"
        return 0
    fi

    if [[ -z "$expected_checksum" ]]; then
        echo "WARNING: No checksum configured for this platform yet."
        echo "         Update get_checksum() in this script with:"
        echo "           $actual_checksum"
        echo ""
        read -p "Continue without verification? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborting."
            exit 1
        fi
        return 0
    fi

    if [[ "$actual_checksum" != "$expected_checksum" ]]; then
        echo "ERROR: Checksum verification failed!"
        echo "  Expected: $expected_checksum"
        echo "  Actual:   $actual_checksum"
        echo ""
        echo "This could mean the upstream artifact was rebuilt or has been tampered with."
        echo "If you trust the new artifact, update get_checksum() with the actual value."
        exit 1
    fi

    echo "Checksum verified: $actual_checksum"
}

# Download the artifact for a platform via gh CLI
download_binary() {
    local platform="$1"
    local target="$2"
    local artifact_name
    local output_name="archivist-${target}"

    case "$platform" in
        windows-amd64) artifact_name="release-archivist-main-windows-amd64.exe" ;;
        linux-amd64)   artifact_name="release-archivist-main-linux-amd64" ;;
        linux-arm64)   artifact_name="release-archivist-main-linux-arm64" ;;
        darwin-amd64)  artifact_name="release-archivist-main-darwin-amd64" ;;
        darwin-arm64)  artifact_name="release-archivist-main-darwin-arm64" ;;
        *) echo "Unsupported platform: $platform"; exit 1 ;;
    esac

    if [[ "$platform" == *"windows"* ]]; then
        output_name="${output_name}.exe"
    fi

    if ! command -v gh &> /dev/null; then
        echo "ERROR: 'gh' CLI is required to download main-branch artifacts."
        echo "       Install from https://cli.github.com/ and run 'gh auth login'."
        exit 1
    fi

    echo "Downloading archivist-node artifact '${artifact_name}'"
    echo "  from commit ${ARCHIVIST_COMMIT:0:12} of ${ARCHIVIST_REPO}"

    mkdir -p "${SIDECARS_DIR}"

    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf ${temp_dir}" EXIT

    gh run download \
        --repo "${ARCHIVIST_REPO}" \
        --name "${artifact_name}" \
        --dir "${temp_dir}" \
        $(gh api "repos/${ARCHIVIST_REPO}/actions/runs?head_sha=${ARCHIVIST_COMMIT}" \
            --jq '.workflow_runs[] | select(.name=="Release") | .id' | head -1)

    # Find the binary inside the extracted directory
    local binary_path
    if [[ "$platform" == *"windows"* ]]; then
        binary_path=$(find "${temp_dir}" -name "archivist-*-windows-amd64.exe" -type f | head -1)
    else
        binary_path=$(find "${temp_dir}" -name "archivist-main-*" -type f ! -name "*.dll" | head -1)
    fi

    if [[ -z "$binary_path" ]]; then
        echo "ERROR: Could not find archivist binary in artifact"
        ls -la "${temp_dir}"
        exit 1
    fi

    # Verify checksum on the binary itself (artifact zip checksum is not stable
    # because GitHub re-zips on download)
    local expected_checksum
    expected_checksum=$(get_checksum "$platform")
    verify_checksum "${binary_path}" "$expected_checksum"

    # Copy to sidecars directory with proper name
    cp "${binary_path}" "${SIDECARS_DIR}/${output_name}"
    chmod +x "${SIDECARS_DIR}/${output_name}"

    echo "Binary installed: ${SIDECARS_DIR}/${output_name}"

    # For Windows, also copy the bundled MinGW runtime DLLs
    if [[ "$platform" == *"windows"* ]]; then
        echo "Copying Windows runtime DLLs..."
        for dll in "${temp_dir}"/*.dll; do
            if [[ -f "$dll" ]]; then
                cp "$dll" "${SIDECARS_DIR}/"
                echo "  Copied: $(basename "$dll")"
            fi
        done
    fi
}

# Download for a specific target (for cross-compilation)
download_for_target() {
    local target="$1"
    local platform

    case "$target" in
        x86_64-unknown-linux-gnu)    platform="linux-amd64" ;;
        aarch64-unknown-linux-gnu)   platform="linux-arm64" ;;
        x86_64-apple-darwin)         platform="darwin-amd64" ;;
        aarch64-apple-darwin)        platform="darwin-arm64" ;;
        x86_64-pc-windows-msvc)      platform="windows-amd64" ;;
        *)
            echo "Unsupported target: $target"
            exit 1
            ;;
    esac

    download_binary "$platform" "$target"
}

# Main
main() {
    if [[ -n "$1" ]]; then
        download_for_target "$1"
    else
        local platform
        platform=$(detect_platform)
        local target
        target=$(get_tauri_target)
        download_binary "$platform" "$target"
    fi

    echo ""
    echo "Done! You can now run 'pnpm tauri dev' or 'pnpm tauri build'"
}

main "$@"
