# Building the Devnet Sidecar Binary

The devnet sidecar (`archivist-devnet-{target_triple}`) must be built natively on each
platform from the `main` branch of https://github.com/durability-labs/archivist-node.

Cross-compilation is not practical due to Nim + Rust FFI + native C dependencies.

## Prerequisites

- **Nim 2.2.6** — install via [choosenim](https://github.com/dom96/choosenim): `choosenim 2.2.6`
- **Rust stable** (1.79.0+) — install via [rustup](https://rustup.rs)
- **C/C++ compiler** — gcc/g++ (Linux), Xcode CLI tools (macOS), MSVC (Windows)
- **CMake 3.x**
- **Git** with submodule support

## Build Steps

```bash
# 1. Clone or navigate to archivist-node
git clone https://github.com/durability-labs/archivist-node.git
cd archivist-node

# 2. Checkout the devnet-compatible commit
git fetch origin
git checkout origin/main    # Must be at revision 96d45e5 or later

# 3. Sync submodules
git submodule sync --recursive
git submodule update --init --recursive

# 4. Build
export PATH="$HOME/.nimble/bin:$HOME/.cargo/bin:$PATH"
nimble build -y
```

### Linking workaround: `__rust_probestack`

If the build fails with `undefined reference to __rust_probestack`, the Rust compiler
builtins have changed symbol mangling. Fix by providing a shim:

**Linux/macOS:**
```bash
echo '.globl __rust_probestack; .type __rust_probestack, @function; __rust_probestack: ret' > /tmp/probestack.s
gcc -c /tmp/probestack.s -o /tmp/probestack.o
nimble build -y --passL:/tmp/probestack.o
```

**If that still fails**, rebuild the Rust FFI dependency first:
```bash
cd vendor/nimble/circomcompat/vendor/circom-compat-ffi
cargo clean && cargo build --release
cd ../../../../..
nimble build -y --passL:/tmp/probestack.o
```

## Output

The built binary is at `build/archivist`. Copy it to the desktop app sidecars directory
with the correct name for your platform:

| Platform | Target filename |
|----------|----------------|
| Linux x64 | `archivist-devnet-x86_64-unknown-linux-gnu` |
| Linux ARM64 | `archivist-devnet-aarch64-unknown-linux-gnu` |
| macOS Intel | `archivist-devnet-x86_64-apple-darwin` |
| macOS ARM (M-series) | `archivist-devnet-aarch64-apple-darwin` |
| Windows x64 | `archivist-devnet-x86_64-pc-windows-msvc.exe` |

```bash
# Example for macOS ARM:
cp build/archivist /path/to/archivist-desktop/src-tauri/sidecars/archivist-devnet-aarch64-apple-darwin
chmod +x /path/to/archivist-desktop/src-tauri/sidecars/archivist-devnet-aarch64-apple-darwin
```

## Verification

```bash
./archivist-devnet-{target_triple} --version
# Expected output should include:
#   Archivist node revision: 96d45e5
#   Archivist contracts revision: c0fafaa
```

These values must match what `https://config.archivist.storage/devnet.json` reports
in the `latest` and `archivist[0].contracts` fields.

## Alternative: Use the download script

If you have a pre-built binary from CI or another machine:

```bash
ARCHIVIST_DEVNET_BINARY=/path/to/built/archivist bash scripts/download-sidecar.sh
```

This copies it to the correct location with the right filename.
