#!/usr/bin/env python3
"""
scripts/e2e_audit.py — V22+ Sprint C — Playwright e2e audit orchestrator.

Запускает полный smoke-аудит Призмы через Playwright. Не «хороший/плохой»,
а структурированный отчёт:

  · какие маршруты грузятся без runtime-errors
  · console-errors / warnings по каждому view
  · network-failures (4xx / 5xx / timeout)
  · скриншоты каждого view
  · агрегатный JSON-report (для CI artifact и human-review)

Использование:
    python3 scripts/e2e_audit.py           # local: подробный вывод + скрины
    python3 scripts/e2e_audit.py --ci      # CI mode: exit-code по наличию failures
    python3 scripts/e2e_audit.py --quick   # smoke без скриншотов

Контракты:
  · Не требует Python deps кроме stdlib (subprocess / json / pathlib).
  · Playwright spec тесты в tests/playwright/*.spec.js — выполняются через
    `npx playwright test`.
  · Аггрегатор парсит Playwright JSON-reporter и собирает summary.
  · Exit-codes:
      0 — все тесты прошли
      1 — обнаружены runtime-errors / network-failures
      2 — Playwright сам упал (некорректная среда)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
PLAYWRIGHT_DIR = ROOT / "tests" / "playwright"
OUT_DIR = PLAYWRIGHT_DIR / "_out"
REPORT_FILE = ROOT / "scripts" / "e2e_audit_report.json"
PLAYWRIGHT_CONFIG = PLAYWRIGHT_DIR / "playwright.config.js"


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
def log(msg: str, *, prefix: str = "[e2e-audit]") -> None:
    """Stdout с временной меткой и префиксом для CI-логов."""
    ts = time.strftime("%H:%M:%S")
    print(f"{prefix} {ts}  {msg}", flush=True)


def check_prereqs() -> None:
    """Проверить что среда настроена: Node.js, npx, Playwright config."""
    if not shutil.which("npx"):
        log("ERROR: npx не найден — установи Node.js >= 18", prefix="[e2e-audit::error]")
        sys.exit(2)
    if not PLAYWRIGHT_CONFIG.exists():
        log(f"ERROR: {PLAYWRIGHT_CONFIG} не найден", prefix="[e2e-audit::error]")
        sys.exit(2)


def run_playwright(args: argparse.Namespace) -> dict:
    """
    Прогон Playwright suite с JSON-reporter. Возвращает parsed-результат.

    --quick: пропускает тесты помеченные @full (не реализовано в spec'е сейчас;
    задел на будущее, когда suite вырастет).
    """
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    json_report_path = OUT_DIR / "playwright-report.json"

    cmd = [
        "npx", "playwright", "test",
        "--config", str(PLAYWRIGHT_CONFIG),
        "--reporter", f"json,outputFile={json_report_path}" if False else "json",
        # ↑ Playwright JSON-reporter не принимает inline-outputFile; используем
        # ENV-переменную ниже.
    ]

    if args.quick:
        cmd.extend(["--grep-invert", "@full"])

    log(f"Запуск: {' '.join(cmd)}")

    env = os.environ.copy()
    env["PLAYWRIGHT_JSON_OUTPUT_NAME"] = str(json_report_path)
    env["CI"] = "1"  # webServer.reuseExistingServer=false в CI

    result = subprocess.run(
        cmd,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
    )

    log(f"Playwright exit: {result.returncode}")
    if result.stdout:
        # Stdout — последние 60 строк (full в JSON-report)
        for line in result.stdout.splitlines()[-60:]:
            log(line, prefix="[pw]")
    if result.stderr and result.returncode != 0:
        for line in result.stderr.splitlines()[-30:]:
            log(line, prefix="[pw::err]")

    # Parse JSON-report (Playwright reporter:json пишет stdout по умолчанию)
    parsed = None
    if json_report_path.exists():
        try:
            parsed = json.loads(json_report_path.read_text(encoding="utf-8"))
        except Exception as e:
            log(f"WARN: не смог распарсить JSON-report: {e}", prefix="[e2e-audit::warn]")
    else:
        # Fallback: пытаемся распарсить stdout (Playwright -reporter=json печатает туда)
        try:
            parsed = json.loads(result.stdout)
        except Exception:
            pass

    return {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "parsed": parsed,
    }


def aggregate(pw_result: dict) -> dict:
    """
    Свести Playwright-результат в плоский отчёт:
      · total / passed / failed / skipped
      · по каждому failed test — stderr-traceback (head/tail)
      · список созданных скриншотов
    """
    parsed = pw_result.get("parsed") or {}
    stats = parsed.get("stats", {}) if isinstance(parsed, dict) else {}

    tests_total = stats.get("expected", 0) + stats.get("unexpected", 0) + stats.get("skipped", 0)
    failed_list = []

    def walk_suites(suites):
        for s in suites or []:
            for spec in s.get("specs", []):
                for test in spec.get("tests", []):
                    for r in test.get("results", []):
                        status = r.get("status")
                        if status in ("failed", "timedOut", "interrupted"):
                            failed_list.append({
                                "file": s.get("file") or s.get("title"),
                                "test": spec.get("title") or test.get("title"),
                                "status": status,
                                "duration_ms": r.get("duration"),
                                "error": (r.get("error") or {}).get("message", ""),
                                "stderr_tail": (r.get("stderr") or [])[-3:],
                            })
            walk_suites(s.get("suites", []))

    walk_suites(parsed.get("suites") if isinstance(parsed, dict) else None)

    # Список скриншотов
    snap_dir = OUT_DIR / "snapshots"
    screenshots = sorted(
        [str(p.relative_to(ROOT)) for p in snap_dir.glob("*.png")]
    ) if snap_dir.exists() else []

    return {
        "exit_code": pw_result["exit_code"],
        "total": tests_total,
        "passed": stats.get("expected", 0),
        "failed": stats.get("unexpected", 0),
        "skipped": stats.get("skipped", 0),
        "duration_ms": stats.get("duration", 0),
        "failed_tests": failed_list,
        "screenshots": screenshots,
    }


def print_summary(report: dict, *, ci: bool) -> None:
    log("=" * 60, prefix="[e2e-audit::summary]")
    log(f"Total: {report['total']}", prefix="[e2e-audit::summary]")
    log(f"Passed: {report['passed']}", prefix="[e2e-audit::summary]")
    log(f"Failed: {report['failed']}", prefix="[e2e-audit::summary]")
    log(f"Skipped: {report['skipped']}", prefix="[e2e-audit::summary]")
    log(f"Duration: {report['duration_ms'] / 1000:.1f}s", prefix="[e2e-audit::summary]")
    log(f"Screenshots: {len(report['screenshots'])}", prefix="[e2e-audit::summary]")

    if report["failed_tests"]:
        log("─" * 60, prefix="[e2e-audit::failures]")
        for t in report["failed_tests"]:
            log(f"FAIL: {t['test']}  [{t['status']}]", prefix="[e2e-audit::failures]")
            err = t["error"][:200] if t["error"] else "(no error message)"
            log(f"  → {err}", prefix="[e2e-audit::failures]")

    log("=" * 60, prefix="[e2e-audit::summary]")
    log(f"Report saved: {REPORT_FILE.relative_to(ROOT)}", prefix="[e2e-audit::summary]")


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Призма e2e visual audit (Playwright wrapper).")
    parser.add_argument("--ci", action="store_true",
                        help="CI mode: exit-code 1 если есть failed tests")
    parser.add_argument("--quick", action="store_true",
                        help="Только @smoke tests (без @full)")
    parser.add_argument("--keep-out", action="store_true",
                        help="Не чистить tests/playwright/_out/ перед прогоном")
    args = parser.parse_args()

    check_prereqs()

    # Очистить _out (если не --keep-out) для чистого прогона
    if not args.keep_out and OUT_DIR.exists():
        log("Чищу tests/playwright/_out/")
        shutil.rmtree(OUT_DIR, ignore_errors=True)

    pw = run_playwright(args)
    report = aggregate(pw)

    # Save JSON report
    REPORT_FILE.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print_summary(report, ci=args.ci)

    if args.ci:
        if report["failed"] > 0 or pw["exit_code"] != 0:
            return 1
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
