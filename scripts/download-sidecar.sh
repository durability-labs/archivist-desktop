#!/bin/bash
# Download the appropriate archivist-node binary for the current platform
# This script is used during development and CI/CD builds
#
# Security: Verifies SHA256 checksums of downloaded binaries

set -e

ARCHIVIST_VERSION="v0.1.0"
RELEASE_BASE_URL="https://github.com/durability-labs/archivist-node/releases/download/${ARCHIVIST_VERSION}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIDECARS_DIR="${SCRIPT_DIR}/../src-tauri/sidecars"

# SHA256 checksums for archivist-node v0.1.0 binaries
# These should be updated when upgrading ARCHIVIST_VERSION
# Note: Using function instead of associative array for bash 3.x compatibility (macOS)
get_checksum() {
    local platform="$1"
    case "$platform" in
        linux-amd64)   echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ;;
        linux-arm64)   echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ;;
        darwin-amd64)  echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ;;
        darwin-arm64)  echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ;;
        windows-amd64) echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ;;
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

    if [[ "$SKIP_CHECKSUM_VERIFY" == "true" ]]; then
        echo "WARNING: Skipping checksum verification (SKIP_CHECKSUM_VERIFY=true)"
        return 0
    fi

    if [[ -z "$expected_checksum" || "$expected_checksum" == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ]]; then
        echo "WARNING: No valid checksum configured for this platform."
        echo "         To get the checksum, run: sha256sum <downloaded-archive>"
        echo "         Then update CHECKSUMS in this script."
        echo ""
        read -p "Continue without verification? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborting download."
            exit 1
        fi
        return 0
    fi

    echo "Verifying checksum..."

    # Use sha256sum on Linux, shasum on macOS
    if command -v sha256sum &> /dev/null; then
        actual_checksum=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum &> /dev/null; then
        actual_checksum=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        echo "ERROR: No SHA256 tool found (sha256sum or shasum)"
        exit 1
    fi

    if [[ "$actual_checksum" != "$expected_checksum" ]]; then
        echo "ERROR: Checksum verification failed!"
        echo "  Expected: $expected_checksum"
        echo "  Actual:   $actual_checksum"
        echo ""
        echo "This could indicate a corrupted download or a supply chain attack."
        echo "Please verify the download source and try again."
        exit 1
    fi

    echo "Checksum verified: $actual_checksum"
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

    # Verify checksum before extraction
    local expected_checksum
    expected_checksum=$(get_checksum "$platform")
    verify_checksum "${temp_dir}/archivist.${archive_ext}" "$expected_checksum"

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
