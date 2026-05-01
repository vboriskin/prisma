#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8080}"

echo "СБОФ Планирование v4.0"
echo "Запуск: http://127.0.0.1:${PORT}"
echo "Остановка: Ctrl+C"

cd "${SCRIPT_DIR}"
exec node server.js "${PORT}"
