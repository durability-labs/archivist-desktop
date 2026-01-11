# Testing the P2P Diagnostics Feature

## Build Verification ✅

The code has been verified to compile successfully:
- ✅ Rust backend compiles without errors
- ✅ TypeScript frontend compiles without errors
- ✅ All linting checks pass
- ✅ All tests pass
- ✅ Pre-commit hooks pass

## How to Test on Your Machine

### 1. Checkout the Feature Branch

```bash
git checkout feature/p2p-diagnostics
```

### 2. Install Dependencies (if needed)

```bash
pnpm install
```

### 3. Run in Development Mode

```bash
pnpm tauri dev
```

The application will launch with the new diagnostics features.

### 4. Test the Diagnostics Panel

1. **Start the Node**:
   - Go to Dashboard
   - Click "Start Node"
   - Wait for status to show "Running"

2. **Open Diagnostics**:
   - Scroll down on Dashboard
   - Click "Show Diagnostics" button
   - Click "Run Diagnostics"

3. **Expected Results**:
   ```
   ✓ API Reachable: Yes
   API URL: http://127.0.0.1:8080
   Node Version: v0.1.0
   Peer ID: 12D3Koo... (your peer ID)
   Network Addresses: 1+ found
   ```

4. **Check Troubleshooting Tips**:
   - Tips will change based on your node's state
   - If no peers connected: "Share your SPR on the Peers page"
   - If peers connected: "Everything looks good! You have X connected peers"

### 5. Test P2P Connection Between Two Machines

Follow the instructions in [P2P-TESTING-GUIDE.md](P2P-TESTING-GUIDE.md):

**Quick Test**:
1. Machine A: Start node → Peers → Copy SPR
2. Machine B: Start node → Peers → Paste SPR → Connect
3. Both machines: Check Dashboard shows "Connected Peers: 1"

**File Transfer Test**:
1. Machine A: Files → Upload test file → Copy CID
2. Machine B: Files → Download from Network → Paste CID → Download
3. Verify file downloads successfully

## Compilation Error in Headless Environment

Note: `pnpm tauri dev` will fail in a headless/SSH environment because it tries to launch a GUI window. This is expected and not an error with the code.

To verify compilation in a headless environment:

```bash
# Backend
cargo build --manifest-path src-tauri/Cargo.toml

# Frontend
pnpm build
```

Both should complete successfully ✅

## Features Added in This Branch

### 1. Diagnostics Panel (Dashboard)
- **Location**: Dashboard page, bottom section
- **Features**:
  - API connectivity check
  - Node version display
  - Peer ID and network addresses
  - Context-aware troubleshooting tips
  - Link to testing guide

### 2. Backend Command
- **Command**: `run_node_diagnostics`
- **Returns**: `DiagnosticInfo` with:
  - `apiReachable`: boolean
  - `apiUrl`: string
  - `nodeVersion?`: string
  - `peerId?`: string
  - `addressCount`: number
  - `error?`: string

### 3. Documentation
- **P2P-TESTING-GUIDE.md**: Complete testing instructions
- **P2P-TESTING-SUMMARY.md**: Quick reference guide

## Known Issues

None currently. All code compiles and tests pass.

## Files Changed

1. `src/pages/Dashboard.tsx` - Added diagnostics UI
2. `src-tauri/src/commands/node.rs` - Added diagnostic command
3. `src-tauri/src/lib.rs` - Registered command
4. `src/styles/App.css` - Added styling
5. `P2P-TESTING-GUIDE.md` - New documentation
6. `P2P-TESTING-SUMMARY.md` - New documentation

## Next Steps

After testing on your two machines:
1. Verify diagnostics panel works correctly
2. Test P2P connectivity using the guide
3. If everything works, merge to main or create PR

## Troubleshooting

### If the app won't start:
```bash
# Clear build cache
pnpm clean
cargo clean --manifest-path src-tauri/Cargo.toml

# Rebuild
pnpm install
pnpm tauri dev
```

### If diagnostics show errors:
1. Check node is actually running (Dashboard status)
2. Try restarting the node
3. Check logs in Settings
4. Verify ports 8080 and 8090 are available

### If you can't connect peers:
1. Follow [P2P-TESTING-GUIDE.md](P2P-TESTING-GUIDE.md) step by step
2. Check firewall on port 8090
3. Verify both nodes are on same network (for LAN test)
4. Use diagnostics to verify addresses are found

## Support

For issues or questions:
- Check [P2P-TESTING-GUIDE.md](P2P-TESTING-GUIDE.md) troubleshooting section
- Review [P2P-TESTING-SUMMARY.md](P2P-TESTING-SUMMARY.md) for common issues
- File an issue on GitHub if problems persist
