#!/data/data/com.termux/files/usr/bin/bash
# 🔍 browser.sh — Browser Agent 快速调用
ENDPOINT="http://127.0.0.1:9223"
ACTION="${1:-status}"
BODY="${2:-{}}"

case "$ACTION" in
  status|pages|cookies|downloads|network|device|ws/*) curl -s "${ENDPOINT}/${ACTION}" ;;
  *) curl -s -X POST "${ENDPOINT}/${ACTION}" -H "Content-Type: application/json" -d "${BODY}" ;;
esac
