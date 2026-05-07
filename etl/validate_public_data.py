#!/usr/bin/env python3
"""Basic public asset validation for the REALIS dashboard."""
from __future__ import annotations

import json
import re
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
DATA = PROJECT / "public/data/dashboard-data.json"
META = PROJECT / "public/data/metadata.json"
QA = PROJECT / "public/data/dashboard-qa.json"
MAX_MB = 8
FORBIDDEN_KEYS = {"address", "postal_code", "sale_date", "transacted_price"}


def walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield path + "/" + str(k), k, v
            yield from walk(v, path + "/" + str(k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk(v, path + f"[{i}]")


def main():
    if not DATA.exists() or not META.exists() or not QA.exists():
        raise SystemExit("Missing public data files. Run build_dashboard_data.py first.")
    size_mb = DATA.stat().st_size / (1024 * 1024)
    if size_mb > MAX_MB:
        raise SystemExit(f"dashboard-data.json too large: {size_mb:.2f} MB > {MAX_MB} MB")
    data = json.loads(DATA.read_text())
    qa = json.loads(QA.read_text())
    bad = []
    for path, key, value in walk(data):
        norm = re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")
        if norm in FORBIDDEN_KEYS:
            bad.append(path)
    if bad:
        raise SystemExit("Forbidden raw-data-like keys emitted: " + ", ".join(bad[:20]))
    fake_names = {"N.A.", "N A", "NA", "N/A", "", "-", "UNKNOWN"}
    fake_projects = [r.get("project") for r in data.get("project_screener", []) if str(r.get("project", "")).upper().strip() in fake_names]
    if fake_projects:
        raise SystemExit("Fake project names leaked into screener: " + ", ".join(fake_projects[:10]))
    required_project_keys = {"project", "segment", "planning_area", "recent_12m_transactions", "stock_units", "stock_matched", "dominant_property_type"}
    missing = [r.get("project", "<unknown>") for r in data.get("project_screener", [])[:100] if not required_project_keys.issubset(r)]
    if missing:
        raise SystemExit("Project screener schema missing keys for: " + ", ".join(missing[:10]))
    if "planning_area_liquidity" not in data.get("stock_adjusted_activity", {}):
        raise SystemExit("Missing stock-adjusted planning area liquidity output")
    if "by_decade_area" not in data.get("lease_expiry", {}):
        raise SystemExit("Missing leasehold decade-by-area output")
    print(json.dumps({
        "ok": True,
        "dashboard_json_mb": round(size_mb, 3),
        "project_rows": len(data.get("project_screener", [])),
        "monthly_points": len(data.get("monthly", [])),
        "monthly_filter_points": len(data.get("monthly_filter", [])),
        "sale_mix_points": len(data.get("market_pulse", {}).get("latest_12m_sale_mix", [])),
        "expiry_project_rows": len(data.get("lease_expiry", {}).get("projects", [])),
        "fake_project_rows_excluded": sum(qa.get("fake_project_rows_excluded", {}).values()),
        "zero_stock_high_volume_projects": len(qa.get("zero_stock_high_volume_projects", [])),
        "privacy_check": "no forbidden address/date/transaction-price keys found",
    }, indent=2))


if __name__ == "__main__":
    main()
