#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-5470}"   # зарезервированный диапазон приложения 5470–5489

cd "${SCRIPT_DIR}"
# 2026-05-11 — exec через launch.js (а не server.js напрямую) — чтобы
# получить banner с версией/URL/временем + auto-open браузера + фильтрацию
# технических маркеров (LISTENING:<port>, JSON-логи).
exec node launch.js "${PORT}"
