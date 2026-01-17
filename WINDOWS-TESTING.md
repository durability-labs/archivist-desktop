# Windows Testing Progress

This document tracks Windows-specific issues discovered and resolved during testing of Archivist Desktop.

## Test Environment

- **OS**: Windows 11 (Build 22631.6199)
- **Architecture**: x86_64
- **Node.js**: v24.13.0
- **pnpm**: v10.28.0
- **Rust**: stable (via rustup)
- **MSVC Build Tools**: 2022 (v14.44.35207)
- **Windows SDK**: 10.0.26100.0

## Issues Found and Resolved

### 1. MSVC Linker Conflict with Git

**Status**: Resolved (workaround)

**Problem**: Rust compilation failed with cryptic errors like `link: extra operand`. The wrong `link.exe` was being used - Git's Unix-style `link` command (`C:\Program Files\Git\usr\bin\link.exe`) was found before the MSVC linker.

**Error**:
```
error: linking with `link.exe` failed: exit code: 1
link: extra operand '...\build_script_build.o'
```

**Solution**: Created a local cargo config at `src-tauri/.cargo/config.toml` that explicitly specifies the MSVC linker path:

```toml
[target.x86_64-pc-windows-msvc]
linker = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\bin\\Hostx64\\x64\\link.exe"
rustflags = [
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\um\\x64",
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Windows Kits\\10\\Lib\\10.0.26100.0\\ucrt\\x64",
    "-C", "link-arg=/LIBPATH:C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\14.44.35207\\lib\\x64"
]
```

**Note**: This file is machine-specific and added to `.gitignore`. Each Windows developer may need to create their own version with correct paths for their VS installation.

**Alternative Solutions**:
- Reorder PATH to put MSVC tools before Git
- Use VS Developer Command Prompt which sets up the environment correctly
- Run builds from within Visual Studio

---

### 2. Missing MSVC Build Tools

**Status**: Resolved

**Problem**: Fresh Windows installation had Rust but not the MSVC C++ build tools required for native compilation.

**Error**:
```
note: in the Visual Studio installer, ensure the "C++ build tools" workload is selected
```

**Solution**: Install Visual Studio Build Tools 2022 with C++ workload:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

---

### 3. Missing Library Paths (LIB/INCLUDE)

**Status**: Resolved (via cargo config)

**Problem**: Even with MSVC installed, the linker couldn't find Windows SDK libraries like `kernel32.lib` and `dbghelp.lib`.

**Error**:
```
LINK : fatal error LNK1181: cannot open input file 'kernel32.lib'
```

**Solution**: The cargo config (see issue #1) includes `/LIBPATH` flags for:
- Windows SDK `um/x64` (kernel32.lib, user32.lib, etc.)
- Windows SDK `ucrt/x64` (C runtime)
- MSVC `lib/x64` (C++ standard library)

---

### 4. Sidecar Binary Missing

**Status**: Resolved

**Problem**: Tauri build failed because the archivist-node sidecar binary wasn't present.

**Error**:
```
resource path `sidecars\archivist-x86_64-pc-windows-msvc.exe` doesn't exist
```

**Solution**:
- Updated `scripts/download-sidecar.sh` to use archivist-node v0.2.0
- Added correct SHA256 checksums for all platforms
- For testing, a placeholder file can be created if the sidecar isn't needed

---

### 5. Environment Variables Not Persisting in Shell

**Status**: Workaround documented

**Problem**: After installing tools via winget, the PATH and other environment variables weren't available in the current shell session.

**Solution**: Either:
1. Open a new terminal/shell after installing tools
2. Manually set PATH to include new tool locations:
   - `C:\Program Files\nodejs`
   - `C:\Users\<user>\.cargo\bin`
   - `C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe`

---

## Test Results Summary

| Test | Status | Notes |
|------|--------|-------|
| pnpm install | ✅ Pass | 332 packages installed |
| TypeScript type check | ✅ Pass | No errors |
| ESLint | ✅ Pass | No errors |
| Vitest (frontend) | ✅ Pass | 5/5 tests passed |
| Cargo test (backend) | ✅ Pass | 2/2 integration tests passed |
| Tauri build (debug) | ✅ Pass | Produces .exe, .msi, and NSIS installer |

### Build Artifacts Generated

- `src-tauri/target/debug/archivist-desktop.exe` - Debug executable
- `src-tauri/target/debug/bundle/msi/Archivist_0.1.0_x64_en-US.msi` - MSI installer
- `src-tauri/target/debug/bundle/nsis/Archivist_0.1.0_x64-setup.exe` - NSIS installer

---

## Recommended Developer Setup for Windows

### Prerequisites

1. **Install Node.js LTS**
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. **Install pnpm**
   ```powershell
   winget install pnpm.pnpm
   ```

3. **Install Rust**
   ```powershell
   winget install Rustlang.Rustup
   ```

4. **Install Visual Studio Build Tools**
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```

5. **Restart terminal** to pick up new PATH entries

### If Linker Errors Occur

Create `src-tauri/.cargo/config.toml` with your local MSVC paths. Find your versions:

```powershell
# Find MSVC version
dir "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"

# Find Windows SDK version
dir "C:\Program Files (x86)\Windows Kits\10\Lib"
```

Then create the config file with appropriate paths (see Issue #1 above).

### Running Tests

```powershell
# Frontend
pnpm install
pnpm test

# Backend (may need VS Developer Command Prompt)
cargo test --manifest-path src-tauri/Cargo.toml

# Build
pnpm tauri build --debug
```

---

## Known Limitations

1. **Sidecar not functional**: The archivist-node sidecar binary must be downloaded separately. The app will build but won't function fully without it.

2. **Machine-specific cargo config**: The `.cargo/config.toml` workaround isn't portable. Consider investigating why the default MSVC detection fails.

3. **PATH ordering**: Git's `link.exe` can shadow the MSVC linker. This is a common issue on Windows systems with Git installed.

---

## Future Improvements

- [ ] Investigate why Rust's default MSVC detection doesn't work on fresh installs
- [ ] Add Windows-specific CI/CD testing
- [ ] Create automated setup script for Windows developers
- [ ] Test on Windows 10 in addition to Windows 11
- [ ] Test ARM64 Windows (if applicable)
- [ ] Document release build process and code signing

---

*Last updated: 2026-01-17*
