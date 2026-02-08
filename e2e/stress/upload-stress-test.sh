#!/usr/bin/env bash
#
# Stress test for archivist-desktop upload/download with memory monitoring.
#
# Usage:
#   ./upload-stress-test.sh --size 1GB
#   ./upload-stress-test.sh --size 10GB --api-url http://127.0.0.1:8080
#

set -euo pipefail

# ── Defaults ──
SIZE=""
API_URL="http://127.0.0.1:8080"

# ── Parse args ──
while [[ $# -gt 0 ]]; do
  case $1 in
    --size) SIZE="$2"; shift 2 ;;
    --api-url) API_URL="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$SIZE" ]]; then
  echo "Usage: $0 --size <1GB|10GB|100GB> [--api-url URL]"
  exit 1
fi

# ── Size mapping ──
case "$SIZE" in
  1GB)   SIZE_BYTES=1073741824;   DESKTOP_THRESHOLD_MB=200; SIDECAR_THRESHOLD_MB=500 ;;
  10GB)  SIZE_BYTES=10737418240;  DESKTOP_THRESHOLD_MB=200; SIDECAR_THRESHOLD_MB=1024 ;;
  100GB) SIZE_BYTES=107374182400; DESKTOP_THRESHOLD_MB=200; SIDECAR_THRESHOLD_MB=2048 ;;
  *) echo "Invalid size: $SIZE (use 1GB, 10GB, or 100GB)"; exit 1 ;;
esac

API_BASE="$API_URL/api/archivist/v1"
TEST_FILE="/tmp/archivist-stress-test-${SIZE}.bin"
MEMORY_CSV="/tmp/archivist-memory-${SIZE}.csv"
MONITOR_PID=""

format_size() {
  local bytes=$1
  if (( bytes >= 1073741824 )); then
    echo "$(echo "scale=2; $bytes / 1073741824" | bc) GB"
  elif (( bytes >= 1048576 )); then
    echo "$(echo "scale=2; $bytes / 1048576" | bc) MB"
  elif (( bytes >= 1024 )); then
    echo "$(echo "scale=2; $bytes / 1024" | bc) KB"
  else
    echo "$bytes B"
  fi
}

get_process_rss_kb() {
  # Returns RSS in KB for all matching processes
  local name=$1
  local total=0
  while IFS= read -r line; do
    total=$((total + line))
  done < <(pgrep -f "$name" 2>/dev/null | xargs -I{} ps -o rss= -p {} 2>/dev/null || echo 0)
  echo "$total"
}

cleanup() {
  echo ""
  echo "== Cleanup =="
  if [[ -n "$MONITOR_PID" ]] && kill -0 "$MONITOR_PID" 2>/dev/null; then
    kill "$MONITOR_PID" 2>/dev/null || true
    wait "$MONITOR_PID" 2>/dev/null || true
    echo "Memory monitor stopped"
  fi
  if [[ -f "$TEST_FILE" ]]; then
    rm -f "$TEST_FILE"
    echo "Test file removed"
  fi
}
trap cleanup EXIT

# ── Pre-flight checks ──
echo ""
echo "== Pre-flight checks =="

# Check sidecar API
if ! curl -sf --max-time 5 "$API_BASE/debug/info" > /dev/null 2>&1; then
  echo "ERROR: Sidecar API not reachable at $API_BASE"
  echo "Start the app and ensure the node is running."
  exit 1
fi
PEER_ID=$(curl -sf "$API_BASE/debug/info" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'][:16])" 2>/dev/null || echo "unknown")
echo "Sidecar API: OK (peer ${PEER_ID}...)"

# Check disk space
FREE_KB=$(df /tmp --output=avail 2>/dev/null | tail -1 || df /tmp | tail -1 | awk '{print $4}')
FREE_BYTES=$((FREE_KB * 1024))
REQUIRED_BYTES=$((SIZE_BYTES * 2))
if (( FREE_BYTES < REQUIRED_BYTES )); then
  echo "ERROR: Insufficient disk space. Need $(format_size $REQUIRED_BYTES), have $(format_size $FREE_BYTES)"
  exit 1
fi
echo "Disk space: $(format_size $FREE_BYTES) free (need $(format_size $REQUIRED_BYTES))"

# Baseline memory
BASELINE_DESKTOP_KB=$(get_process_rss_kb "archivist-desktop")
BASELINE_SIDECAR_KB=$(get_process_rss_kb "archivist[^-]")
echo "Baseline memory - Desktop: $((BASELINE_DESKTOP_KB / 1024)) MB, Sidecar: $((BASELINE_SIDECAR_KB / 1024)) MB"

# ── Generate test file ──
echo ""
echo "== Generating $SIZE test file =="

rm -f "$TEST_FILE"
GEN_START=$(date +%s)

if command -v fallocate &>/dev/null; then
  fallocate -l "$SIZE_BYTES" "$TEST_FILE"
elif command -v truncate &>/dev/null; then
  truncate -s "$SIZE_BYTES" "$TEST_FILE"
else
  dd if=/dev/zero of="$TEST_FILE" bs=1M count=$((SIZE_BYTES / 1048576)) 2>/dev/null
fi

GEN_END=$(date +%s)
echo "File created in $((GEN_END - GEN_START))s: $TEST_FILE"

# ── Start memory monitoring ──
echo ""
echo "== Starting memory monitor =="

echo "Timestamp,ElapsedSec,DesktopMB,SidecarMB" > "$MEMORY_CSV"
MON_START=$(date +%s)

(
  while true; do
    ELAPSED=$(( $(date +%s) - MON_START ))
    DESKTOP_KB=$(get_process_rss_kb "archivist-desktop")
    SIDECAR_KB=$(get_process_rss_kb "archivist[^-]")
    DESKTOP_MB=$((DESKTOP_KB / 1024))
    SIDECAR_MB=$((SIDECAR_KB / 1024))
    echo "$(date '+%Y-%m-%d %H:%M:%S'),$ELAPSED,$DESKTOP_MB,$SIDECAR_MB" >> "$MEMORY_CSV"
    sleep 2
  done
) &
MONITOR_PID=$!
echo "Memory monitor started (PID $MONITOR_PID, logging to $MEMORY_CSV)"

# ── Upload ──
echo ""
echo "== Uploading $SIZE file =="
UPLOAD_START=$(date +%s)

CID=$(curl --silent --show-error --fail \
  -X POST \
  -H "Content-Type: application/octet-stream" \
  -H "Content-Disposition: attachment; filename=\"stress-test-${SIZE}.bin\"" \
  --data-binary "@$TEST_FILE" \
  --max-time 36000 \
  "$API_BASE/data" 2>&1)

UPLOAD_END=$(date +%s)
UPLOAD_ELAPSED=$((UPLOAD_END - UPLOAD_START))

if [[ -z "$CID" ]]; then
  echo "ERROR: Upload failed (empty response)"
  exit 1
fi

echo "Upload complete in ${UPLOAD_ELAPSED}s"
echo "CID: $CID"

# ── Verify ──
echo ""
echo "== Verifying upload =="

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$API_BASE/data/$CID" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  echo "CID verification: OK (GET returns 200)"
else
  echo "WARNING: GET returned $HTTP_CODE, CID may not be immediately available"
fi

SPACE_USED=$(curl -sf "$API_BASE/space" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('quotaUsedBytes', 0))" 2>/dev/null || echo "0")
echo "Storage used: $(format_size "$SPACE_USED")"

# ── Record peak memory ──
sleep 5
PEAK_DESKTOP_KB=$(get_process_rss_kb "archivist-desktop")
PEAK_SIDECAR_KB=$(get_process_rss_kb "archivist[^-]")

DELTA_DESKTOP_KB=$((PEAK_DESKTOP_KB - BASELINE_DESKTOP_KB))
DELTA_SIDECAR_KB=$((PEAK_SIDECAR_KB - BASELINE_SIDECAR_KB))
DELTA_DESKTOP_MB=$((DELTA_DESKTOP_KB / 1024))
DELTA_SIDECAR_MB=$((DELTA_SIDECAR_KB / 1024))

# ── Delete ──
echo ""
echo "== Deleting test file from node =="
if curl -sf -X DELETE --max-time 60 "$API_BASE/data/$CID" > /dev/null 2>&1; then
  echo "Delete: OK"
else
  echo "WARNING: Delete failed"
fi

# Verify deletion
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "$API_BASE/data/$CID" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "CID no longer accessible: OK"
else
  echo "WARNING: CID still accessible after delete"
fi

# ── Report ──
echo ""
echo "== Results =="

DESKTOP_PASS=true
SIDECAR_PASS=true

if (( DELTA_DESKTOP_MB > DESKTOP_THRESHOLD_MB )); then
  DESKTOP_PASS=false
fi
if (( DELTA_SIDECAR_MB > SIDECAR_THRESHOLD_MB )); then
  SIDECAR_PASS=false
fi

echo "File size:          $SIZE ($SIZE_BYTES bytes)"
echo "Upload duration:    ${UPLOAD_ELAPSED}s"
echo ""
echo "Desktop baseline:   $((BASELINE_DESKTOP_KB / 1024)) MB"
echo "Desktop peak:       $((PEAK_DESKTOP_KB / 1024)) MB"
echo "Desktop delta:      ${DELTA_DESKTOP_MB} MB  (max: ${DESKTOP_THRESHOLD_MB} MB)"
if $DESKTOP_PASS; then
  echo "Desktop memory:     PASS"
else
  echo "Desktop memory:     FAIL"
fi
echo ""
echo "Sidecar baseline:   $((BASELINE_SIDECAR_KB / 1024)) MB"
echo "Sidecar peak:       $((PEAK_SIDECAR_KB / 1024)) MB"
echo "Sidecar delta:      ${DELTA_SIDECAR_MB} MB  (max: ${SIDECAR_THRESHOLD_MB} MB)"
if $SIDECAR_PASS; then
  echo "Sidecar memory:     PASS"
else
  echo "Sidecar memory:     FAIL"
fi

echo ""
echo "Memory CSV:         $MEMORY_CSV"

if $DESKTOP_PASS && $SIDECAR_PASS; then
  echo ""
  echo "OVERALL: PASS"
  exit 0
else
  echo ""
  echo "OVERALL: FAIL"
  exit 1
fi
