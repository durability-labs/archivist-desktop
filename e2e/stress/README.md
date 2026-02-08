# Stress Tests

Large-file upload/download stress tests with memory monitoring for archivist-desktop.

## Purpose

Validates that the streaming upload/download implementation keeps memory usage constant regardless of file size. After the streaming fix, the desktop app (Rust backend) should use a fixed amount of memory (~50-100MB buffer) even when uploading 100GB files.

## Prerequisites

- Archivist Desktop running with the node started
- Sidecar API reachable at `http://127.0.0.1:8080`
- Sufficient disk space (2x the test file size)

## Usage

### Windows (PowerShell)

```powershell
# 1GB test (quick validation)
powershell -File e2e/stress/upload-stress-test.ps1 -Size 1GB

# 10GB test
powershell -File e2e/stress/upload-stress-test.ps1 -Size 10GB

# 100GB test (requires ~200GB free disk space)
powershell -File e2e/stress/upload-stress-test.ps1 -Size 100GB

# Custom API URL
powershell -File e2e/stress/upload-stress-test.ps1 -Size 1GB -ApiUrl http://127.0.0.1:9090
```

### Linux/macOS (Bash)

```bash
chmod +x e2e/stress/upload-stress-test.sh

# 1GB test
./e2e/stress/upload-stress-test.sh --size 1GB

# 10GB test
./e2e/stress/upload-stress-test.sh --size 10GB

# 100GB test
./e2e/stress/upload-stress-test.sh --size 100GB
```

## What It Does

1. **Pre-flight**: Checks sidecar API, disk space, records baseline memory
2. **Generate**: Creates a sparse test file (instant on modern filesystems)
3. **Monitor**: Starts a background job that samples process memory every 2 seconds
4. **Upload**: Streams the file to the sidecar API via `curl --data-binary`
5. **Verify**: Checks the CID is accessible and storage space increased
6. **Delete**: Removes the file from node storage and verifies deletion
7. **Cleanup**: Removes test file, stops memory monitor
8. **Report**: Prints pass/fail based on memory thresholds

## Memory Thresholds

| File Size | Max Desktop Delta | Max Sidecar Delta |
|-----------|-------------------|-------------------|
| 1 GB      | < 200 MB          | < 500 MB          |
| 10 GB     | < 200 MB          | < 1 GB            |
| 100 GB    | < 200 MB          | < 2 GB            |

The key insight: after the streaming fix, the desktop process memory delta should be **constant** regardless of file size.

## Output

- Console: pass/fail summary with timing and memory stats
- CSV file: `%TEMP%/archivist-memory-{size}.csv` (Windows) or `/tmp/archivist-memory-{size}.csv` (Linux/macOS)
  - Columns: `Timestamp, ElapsedSec, DesktopMB, SidecarMB`
  - Sampled every 2 seconds during the upload
