#!/bin/bash
# Download the appropriate archivist-node binary for the current platform
# This script is used during development and CI/CD builds

set -e

ARCHIVIST_VERSION="v0.1.0"
RELEASE_BASE_URL="https://github.com/durability-labs/archivist-node/releases/download/${ARCHIVIST_VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECARS_DIR="${SCRIPT_DIR}/../src-tauri/sidecars"

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

# Download and extract the binary
download_binary() {
    local platform="$1"
    local target="$2"
    local output_name="archivist-${target}"
    local archive_name
    local archive_ext

    # Windows uses .zip format, others use .tar.gz
    if [[ "$platform" == *"windows"* ]]; then
        archive_ext="zip"
        output_name="${output_name}.exe"
    else
        archive_ext="tar.gz"
    fi

    archive_name="archivist-${ARCHIVIST_VERSION}-${platform}.${archive_ext}"
    local download_url="${RELEASE_BASE_URL}/${archive_name}"

    echo "Downloading archivist-node ${ARCHIVIST_VERSION} for ${platform}..."
    echo "URL: ${download_url}"

    # Create sidecars directory if it doesn't exist
    mkdir -p "${SIDECARS_DIR}"

    # Download to temp directory
    local temp_dir=$(mktemp -d)
    trap "rm -rf ${temp_dir}" EXIT

    curl -L -o "${temp_dir}/archivist.${archive_ext}" "${download_url}"

    echo "Extracting binary..."
    if [[ "$archive_ext" == "zip" ]]; then
        unzip -q "${temp_dir}/archivist.zip" -d "${temp_dir}"
    else
        tar -xzf "${temp_dir}/archivist.tar.gz" -C "${temp_dir}"
    fi

    # Find the binary (might be in a subdirectory or have version in name)
    local binary_path
    if [[ "$platform" == *"windows"* ]]; then
        binary_path=$(find "${temp_dir}" -name "archivist*.exe" -type f | head -1)
    else
        binary_path=$(find "${temp_dir}" -name "archivist*" -type f ! -name "*.tar.gz" ! -name "*.sha256" ! -name "*.zip" | head -1)
    fi

    if [[ -z "$binary_path" ]]; then
        echo "Error: Could not find archivist binary in archive"
        exit 1
    fi

    # Copy to sidecars directory with proper name
    cp "${binary_path}" "${SIDECARS_DIR}/${output_name}"
    chmod +x "${SIDECARS_DIR}/${output_name}"

    echo "Binary installed to: ${SIDECARS_DIR}/${output_name}"
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
        # Target specified as argument
        download_for_target "$1"
    else
        # Auto-detect current platform
        local platform=$(detect_platform)
        local target=$(get_tauri_target)
        download_binary "$platform" "$target"
    fi

    echo ""
    echo "Done! You can now run 'pnpm tauri dev' or 'pnpm tauri build'"
}

main "$@"
