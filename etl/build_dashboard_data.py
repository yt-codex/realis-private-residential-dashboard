#!/usr/bin/env python3
"""Build lightweight static dashboard JSON from local REALIS exports.

The output is intentionally aggregated: no transaction-level rows and no address
fields are emitted to public/data.
"""
from __future__ import annotations

import csv
import io
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
PROJECT = Path(__file__).resolve().parents[1]
TX_DIR = ROOT / "data/realis_residential_transactions_monthly"
STOCK_CSV = ROOT / "data/realis_residential_stock_project_property_type_latest_2026q1_scraped.csv"
LEASE_CSV = ROOT / "data/realis_active_99y_nonlanded_units_by_project_latest_2026q1.csv"
OUT_DIR = PROJECT / "public/data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

NONLANDED = {"Apartment", "Condominium", "Executive Condominium"}
ALL = "All"
SALE_TYPES = ["New Sale", "Resale", "Sub Sale"]
PROPERTY_TYPES = ["Apartment", "Condominium", "Executive Condominium", "Terrace House", "Semi-Detached House", "Detached House"]
SEGMENTS = ["CCR", "RCR", "OCR", "Unknown"]


def decode_csv(path: Path) -> str:
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin1", errors="replace")


def read_csv(path: Path):
    return csv.DictReader(io.StringIO(decode_csv(path)))


def clean_num(value) -> float:
    s = str(value or "").replace(",", "").replace("$", "").strip()
    if not s or s == "-":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def clean_int(value) -> int:
    return int(round(clean_num(value)))


def norm_project(name: str) -> str:
    s = re.sub(r"\s+", " ", (name or "").upper()).strip()
    return s


def market_segment(postal_district: str, planning_region: str, planning_area: str) -> str:
    """Transparent proxy, not official URA segment field."""
    district = str(postal_district or "").zfill(2)[-2:]
    area = (planning_area or "").lower()
    region = (planning_region or "").lower()
    if district in {"09", "10", "11"} or "downtown core" in area or "sentosa" in area:
        return "CCR"
    if "central" in region:
        return "RCR"
    if region:
        return "OCR"
    return "Unknown"


def pct(n, d):
    return None if not d else n / d


def summarize_psf(values):
    vals = sorted(v for v in values if v > 0)
    if not vals:
        return {"median": None, "p25": None, "p75": None}
    q25 = vals[max(0, min(len(vals) - 1, math.floor((len(vals) - 1) * 0.25)))]
    q75 = vals[max(0, min(len(vals) - 1, math.floor((len(vals) - 1) * 0.75)))]
    return {"median": round(median(vals), 0), "p25": round(q25, 0), "p75": round(q75, 0)}


def add_agg(bucket, r):
    price = clean_num(r.get("Transacted Price ($)"))
    psf = clean_num(r.get("Unit Price ($ PSF)"))
    units = clean_num(r.get("Number of Units")) or 1
    bucket["transactions"] += 1
    bucket["value"] += price
    bucket["units"] += units
    if psf:
        bucket["psf"].append(psf)


def blank_bucket():
    return {"transactions": 0, "value": 0.0, "units": 0.0, "psf": []}


def finalize_bucket(b):
    psf = summarize_psf(b.pop("psf", []))
    return {
        "transactions": int(b["transactions"]),
        "value": round(b["value"], 0),
        "units": round(b["units"], 0),
        **psf,
    }


def frozen_bucket(bucket):
    return {**bucket, "psf": list(bucket["psf"])}


def main():
    tx_files = sorted(TX_DIR.glob("*.csv"))
    if not tx_files:
        raise SystemExit(f"No transaction CSVs found in {TX_DIR}")

    monthly = defaultdict(blank_bucket)
    monthly_segment = defaultdict(blank_bucket)
    monthly_property = defaultdict(blank_bucket)
    monthly_sale = defaultdict(blank_bucket)
    monthly_filter = defaultdict(blank_bucket)
    segment_total = defaultdict(blank_bucket)
    region_total = defaultdict(blank_bucket)
    planning_total = defaultdict(blank_bucket)
    project = defaultdict(lambda: {
        "transactions": 0, "recent_12m_transactions": 0, "value": 0.0, "recent_12m_value": 0.0,
        "psf": [], "recent_psf": [], "property_types": Counter(), "sale_types": Counter(),
        "planning_area": "", "planning_region": "", "postal_district": "", "segment": "Unknown",
        "nonlanded_transactions": 0,
    })
    transaction_first_month = tx_files[0].stem
    latest_month = tx_files[-1].stem
    latest_year = int(latest_month[:4])
    latest_month_num = int(latest_month[5:7])
    latest_index = latest_year * 12 + latest_month_num
    recent_cutoff = latest_index - 11
    total_rows = 0
    nonlanded_rows = 0
    latest_12m_sale_mix = defaultdict(blank_bucket)

    for path in tx_files:
        month = path.stem
        y, m = map(int, month.split("-"))
        month_index = y * 12 + m
        for r in read_csv(path):
            total_rows += 1
            pt = r.get("Property Type") or "Unknown"
            sale_type = r.get("Type of Sale") or "Unknown"
            if pt in NONLANDED:
                nonlanded_rows += 1
            seg = market_segment(r.get("Postal District"), r.get("Planning Region"), r.get("Planning Area"))
            add_agg(monthly[month], r)
            add_agg(monthly_segment[(month, seg)], r)
            add_agg(monthly_property[(month, pt)], r)
            add_agg(monthly_sale[(month, sale_type)], r)
            for seg_key in (ALL, seg):
                for prop_key in (ALL, pt):
                    for sale_key in (ALL, sale_type):
                        add_agg(monthly_filter[(month, seg_key, prop_key, sale_key)], r)
            add_agg(segment_total[seg], r)
            add_agg(region_total[r.get("Planning Region") or "Unknown"], r)
            add_agg(planning_total[r.get("Planning Area") or "Unknown"], r)
            if month_index >= recent_cutoff:
                add_agg(latest_12m_sale_mix[sale_type], r)

            pn = norm_project(r.get("Project Name"))
            if pn:
                p = project[pn]
                p["transactions"] += 1
                p["value"] += clean_num(r.get("Transacted Price ($)"))
                psf = clean_num(r.get("Unit Price ($ PSF)"))
                if psf:
                    p["psf"].append(psf)
                p["property_types"][pt] += 1
                p["sale_types"][sale_type] += 1
                p["planning_area"] = p["planning_area"] or r.get("Planning Area", "")
                p["planning_region"] = p["planning_region"] or r.get("Planning Region", "")
                p["postal_district"] = p["postal_district"] or r.get("Postal District", "")
                p["segment"] = p["segment"] if p["segment"] != "Unknown" else seg
                if pt in NONLANDED:
                    p["nonlanded_transactions"] += 1
                if month_index >= recent_cutoff:
                    p["recent_12m_transactions"] += 1
                    p["recent_12m_value"] += clean_num(r.get("Transacted Price ($)"))
                    if psf:
                        p["recent_psf"].append(psf)

    # Stock by project/type.
    stock_by_project = {}
    stock_totals = {"Apartment": 0, "Condominium": 0, "Executive Condominium": 0, "Total": 0}
    for r in read_csv(STOCK_CSV):
        name = r.get("Project Name", "")
        if name.strip().lower() == "total":
            for k in stock_totals:
                stock_totals[k] = clean_int(r.get(k))
            continue
        pn = norm_project(name)
        stock_by_project[pn] = {
            "apartment": clean_int(r.get("Apartment")),
            "condominium": clean_int(r.get("Condominium")),
            "executive_condominium": clean_int(r.get("Executive Condominium")),
            "total": clean_int(r.get("Total")),
        }

    # Lease expiry wall.
    expiry_decades = defaultdict(lambda: {"units": 0, "projects": 0})
    expiry_projects = []
    for r in read_csv(LEASE_CSV):
        units = clean_int(r.get("Number of units"))
        expiry = clean_int(r.get("Lease Expiry"))
        if not expiry:
            continue
        decade = f"{(expiry // 10) * 10}s"
        expiry_decades[decade]["units"] += units
        expiry_decades[decade]["projects"] += 1
        expiry_projects.append({
            "project": r.get("Project Name"),
            "property_type": r.get("Property Type"),
            "units": units,
            "lease_expiry": expiry,
            "decade": decade,
            "enbloc_indicator": r.get("Enbloc indicator"),
        })
    expiry_projects.sort(key=lambda x: (x["lease_expiry"], -x["units"], x["project"]))

    # Project table: aggregated, no addresses.
    project_rows = []
    for pn, p in project.items():
        stock = stock_by_project.get(pn, {"total": 0, "apartment": 0, "condominium": 0, "executive_condominium": 0})
        recent_psf = summarize_psf(p["recent_psf"])
        all_psf = summarize_psf(p["psf"])
        project_rows.append({
            "project": pn.title(),
            "segment": p["segment"],
            "planning_region": p["planning_region"],
            "planning_area": p["planning_area"],
            "postal_district": p["postal_district"],
            "transactions": p["transactions"],
            "recent_12m_transactions": p["recent_12m_transactions"],
            "recent_12m_median_psf": recent_psf["median"],
            "median_psf_all": all_psf["median"],
            "stock_units": stock["total"],
            "turnover_per_1000_stock_12m": round(1000 * p["recent_12m_transactions"] / stock["total"], 1) if stock["total"] else None,
            "has_nonlanded_activity": bool(p["nonlanded_transactions"]),
            "dominant_property_type": p["property_types"].most_common(1)[0][0] if p["property_types"] else None,
            "property_type_mix": dict(p["property_types"].most_common()),
            "sale_type_mix": dict(p["sale_types"].most_common()),
        })
    stock_adjusted_segment = defaultdict(lambda: {"stock_units": 0, "recent_12m_transactions": 0, "matched_projects": 0})
    for row in project_rows:
        seg = row["segment"] or "Unknown"
        if not row["stock_units"] or not row["has_nonlanded_activity"]:
            continue
        stock_adjusted_segment[seg]["stock_units"] += row["stock_units"]
        stock_adjusted_segment[seg]["recent_12m_transactions"] += row["recent_12m_transactions"] or 0
        stock_adjusted_segment[seg]["matched_projects"] += 1

    stock_adjusted_segment_rows = []
    for seg in [ALL, *SEGMENTS]:
        if seg == ALL:
            stock_units = sum(v["stock_units"] for v in stock_adjusted_segment.values())
            recent_tx = sum(v["recent_12m_transactions"] for v in stock_adjusted_segment.values())
            matched_projects = sum(v["matched_projects"] for v in stock_adjusted_segment.values())
        else:
            vals = stock_adjusted_segment.get(seg, {"stock_units": 0, "recent_12m_transactions": 0, "matched_projects": 0})
            stock_units = vals["stock_units"]
            recent_tx = vals["recent_12m_transactions"]
            matched_projects = vals["matched_projects"]
        stock_adjusted_segment_rows.append({
            "segment": seg,
            "stock_units": stock_units,
            "recent_12m_transactions": recent_tx,
            "matched_projects": matched_projects,
            "turnover_per_1000_stock_12m": round(1000 * recent_tx / stock_units, 1) if stock_units else None,
        })
    stock_adjusted_segment_rows.sort(key=lambda x: (x["segment"] != ALL, x["turnover_per_1000_stock_12m"] or 0), reverse=True)
    stock_adjusted_segment_rows.sort(key=lambda x: x["segment"] != ALL)

    project_turnover_leaders = sorted(
        [
            r for r in project_rows
            if r["turnover_per_1000_stock_12m"] is not None
            and r["recent_12m_transactions"]
            and r["has_nonlanded_activity"]
            and r["stock_units"] >= 20
        ],
        key=lambda x: (x["turnover_per_1000_stock_12m"], x["recent_12m_transactions"], x["stock_units"]),
        reverse=True,
    )[:50]

    project_rows.sort(key=lambda x: (x["recent_12m_transactions"], x["stock_units"]), reverse=True)
    # Keep enough for a screener, but still aggregated and lightweight.
    project_rows = project_rows[:2000]

    months = sorted(monthly)
    latest_12 = set(months[-12:])
    latest12_bucket = blank_bucket()
    latest_month_bucket = blank_bucket()
    for mth in latest_12:
        b = monthly[mth]
        latest12_bucket["transactions"] += b["transactions"]
        latest12_bucket["value"] += b["value"]
        latest12_bucket["units"] += b["units"]
        latest12_bucket["psf"].extend(b["psf"])
    latest_month_bucket.update(monthly[latest_month])
    latest12_final = finalize_bucket(latest12_bucket)
    latest_month_final = finalize_bucket(latest_month_bucket)
    latest_12m_sale_mix_rows = []
    latest_12m_sale_mix_total = sum(bucket["transactions"] for bucket in latest_12m_sale_mix.values())
    for sale_type in [*SALE_TYPES, "Unknown"]:
        bucket = latest_12m_sale_mix.get(sale_type)
        if not bucket or not bucket["transactions"]:
            continue
        latest_12m_sale_mix_rows.append({
            "sale_type": sale_type,
            **finalize_bucket(frozen_bucket(bucket)),
            "transaction_share": round(bucket["transactions"] / latest_12m_sale_mix_total, 4) if latest_12m_sale_mix_total else None,
        })

    dashboard = {
        "market_pulse": {
            "latest_month": latest_month,
            "latest_month_metrics": latest_month_final,
            "latest_12m_metrics": latest12_final,
            "latest_12m_sale_mix": latest_12m_sale_mix_rows,
            "nonlanded_transaction_share_all": round(nonlanded_rows / total_rows, 4),
        },
        "monthly": [
            {"month": m, **finalize_bucket(frozen_bucket(monthly[m]))}
            for m in months
        ],
        "monthly_by_segment": [
            {"month": m, "segment": s, **finalize_bucket(frozen_bucket(monthly_segment[(m, s)]))}
            for m in months for s in SEGMENTS if monthly_segment[(m, s)]["transactions"]
        ],
        "monthly_by_property_type": [
            {"month": m, "property_type": pt, **finalize_bucket(frozen_bucket(monthly_property[(m, pt)]))}
            for m in months for pt in [*PROPERTY_TYPES, "Unknown"] if monthly_property[(m, pt)]["transactions"]
        ],
        "monthly_by_sale_type": [
            {"month": m, "sale_type": st, **finalize_bucket(frozen_bucket(monthly_sale[(m, st)]))}
            for m in months for st in [*SALE_TYPES, "Unknown"] if monthly_sale[(m, st)]["transactions"]
        ],
        "monthly_filter": [
            {"month": m, "segment": s, "property_type": pt, "sale_type": st, **finalize_bucket(frozen_bucket(monthly_filter[(m, s, pt, st)]))}
            for m in months
            for s in [ALL, *SEGMENTS]
            for pt in [ALL, *PROPERTY_TYPES, "Unknown"]
            for st in [ALL, *SALE_TYPES, "Unknown"]
            if monthly_filter[(m, s, pt, st)]["transactions"]
        ],
        "segment_summary": [
            {"segment": s, **finalize_bucket(frozen_bucket(segment_total[s]))}
            for s in SEGMENTS if segment_total[s]["transactions"]
        ],
        "region_summary": [
            {"region": k, **finalize_bucket(frozen_bucket(v))}
            for k, v in sorted(region_total.items(), key=lambda kv: kv[1]["transactions"], reverse=True)
        ],
        "planning_area_ranking": [
            {"planning_area": k, **finalize_bucket(frozen_bucket(v))}
            for k, v in sorted(planning_total.items(), key=lambda kv: kv[1]["transactions"], reverse=True)[:40]
        ],
        "stock": {
            "totals": stock_totals,
            "by_type": [
                {"property_type": "Apartment", "units": stock_totals["Apartment"]},
                {"property_type": "Condominium", "units": stock_totals["Condominium"]},
                {"property_type": "Executive Condominium", "units": stock_totals["Executive Condominium"]},
            ],
        },
        "project_screener": project_rows,
        "stock_adjusted_activity": {
            "segment_turnover_summary": stock_adjusted_segment_rows,
            "top_project_turnover_leaders": project_turnover_leaders,
        },
        "lease_expiry": {
            "by_decade": [
                {"decade": d, **expiry_decades[d]}
                for d in sorted(expiry_decades, key=lambda x: int(x[:4]))
            ],
            "projects": expiry_projects[:500],
            "top_projects": sorted(expiry_projects, key=lambda x: x["units"], reverse=True)[:300],
        },
    }

    metadata = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "transaction_csv_count": len(tx_files),
        "transaction_rows": total_rows,
        "transaction_source": str(TX_DIR.relative_to(ROOT) / "*.csv"),
        "source_vintage": {
            "transactions_first_month": transaction_first_month,
            "transactions_latest_month": latest_month,
            "stock_filename": STOCK_CSV.name,
            "leasehold_filename": LEASE_CSV.name,
        },
        "latest_transaction_month": latest_month,
        "stock_source": str(STOCK_CSV.relative_to(ROOT)),
        "leasehold_source": str(LEASE_CSV.relative_to(ROOT)),
        "emitted_files": ["dashboard-data.json", "metadata.json"],
        "privacy": "Aggregated dashboard JSON only; no address-level transaction rows emitted.",
        "market_segment_method": "CCR = postal districts 09/10/11 or Downtown Core/Sentosa; RCR = other Central Region; OCR = non-Central regions; Unknown fallback. Proxy, not official URA market-segment field.",
    }

    (OUT_DIR / "dashboard-data.json").write_text(json.dumps(dashboard, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "rows": total_rows,
        "latest_month": latest_month,
        "dashboard_json_kb": round((OUT_DIR / "dashboard-data.json").stat().st_size / 1024, 1),
        "metadata_json_kb": round((OUT_DIR / "metadata.json").stat().st_size / 1024, 1),
    }, indent=2))


if __name__ == "__main__":
    main()
