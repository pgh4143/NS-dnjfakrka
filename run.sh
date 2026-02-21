#!/bin/bash
# 매월 1일 00:10 자동 실행 스크립트 (launchd 호출용)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/$(date +%Y%m%d_%H%M%S).log"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

echo "=== 시작: $(date '+%Y-%m-%d %H:%M:%S') ===" | tee -a "$LOG_FILE"
/opt/homebrew/bin/node --import tsx/esm "$SCRIPT_DIR/src/index.ts" --run >> "$LOG_FILE" 2>&1
echo "=== 종료: $(date '+%Y-%m-%d %H:%M:%S') (exit $?) ===" | tee -a "$LOG_FILE"
