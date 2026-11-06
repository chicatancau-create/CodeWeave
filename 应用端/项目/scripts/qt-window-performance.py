"""Run the opt-in Qt real-window workload, retain raw samples and fail budgets.

Uses an isolated account directory owned by the executable's QTemporaryDir.
This is a synthetic desktop workload, not a clean-OS or visual-parity proof.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import subprocess
import tempfile


def summarize(values):
    ordered = sorted(values)
    if not ordered or any(not math.isfinite(x) or x < 0 for x in ordered):
        raise ValueError("missing or invalid measurement samples")
    return {"count": len(ordered), "p50": ordered[math.ceil(len(ordered) * .5) - 1],
            "p95": ordered[math.ceil(len(ordered) * .95) - 1], "max": ordered[-1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("runs must be positive")
    exe = args.exe.resolve(strict=True)
    report = {"schemaVersion": 1, "os": platform.platform(), "executable": str(exe),
              "sha256": hashlib.sha256(exe.read_bytes()).hexdigest(), "runs": [],
              "limitations": ["warm OS cache; synthetic workload", "frameSwapped is not DWM presentation",
                               "startup from main entry excludes OS loader", "not a Win32 parity comparison"]}
    env = os.environ.copy()
    env["QT_QPA_PLATFORM"] = "windows"
    try:
        with tempfile.TemporaryDirectory(prefix="cw-qt-window-") as temporary:
            env["LOCALAPPDATA"] = str(Path(temporary) / "local")
            env["APPDATA"] = str(Path(temporary) / "roaming")
            for index in range(args.runs):
                raw = Path(temporary) / f"run-{index}.json"
                result = subprocess.run([str(exe), "--benchmark-json", str(raw)], cwd=exe.parent,
                                        env=env, timeout=55, capture_output=True)
                row = json.loads(raw.read_text(encoding="utf-8")) if raw.exists() else {}
                report["runs"].append(row)
                if result.returncode or row.get("error"):
                    raise RuntimeError(f"window workload failed: {result.returncode}, {row.get('error')}")
        budgets = {"main_thread_ms": 16.7, "frame_interval_ms": 20, "edit_ms": 50, "cancel_ms": 100}
        minimum = {"main_thread_ms": 100, "frame_interval_ms": 100, "edit_ms": 60, "cancel_ms": 10}
        report["metrics"] = {}
        for name, limit in budgets.items():
            for row in report["runs"]:
                if len(row.get(name, [])) < minimum[name]:
                    raise ValueError(f"insufficient samples: {name}")
            measured = summarize([value for row in report["runs"] for value in row[name]])
            measured.update(budget=limit, passed=measured["p95"] <= limit)
            report["metrics"][name] = measured
        report["status"] = "passed" if all(x["passed"] for x in report["metrics"].values()) else "failed"
    except Exception as error:
        report.update(status="failed", error=str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "runs"}, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
