# REALIS Private Residential Market Dashboard

Static analyst dashboard for Singapore private residential market signals from local REALIS transaction and stock exports.

## Design principles

- The browser **does not load raw REALIS transactions**.
- The ETL emits compact, aggregated JSON only.
- No address-level transaction records are emitted.
- GitHub Pages-compatible: static HTML/CSS/JS + JSON assets.
- Public deployment of REALIS-derived aggregates should be confirmed before publishing.

## Inputs

Expected local inputs, relative to `/Users/lyt/.openclaw/workspace` by default:

- `data/realis_residential_transactions_monthly/*.csv`
- `data/realis_residential_stock_project_property_type_latest_2026q1_scraped.csv`
- `data/realis_active_99y_nonlanded_units_by_project_latest_2026q1.csv`

## Run ETL

```bash
cd /Users/lyt/.openclaw/workspace/realis-private-residential-dashboard
python3 etl/build_dashboard_data.py
python3 etl/validate_public_data.py
```

This rebuilds `public/data/dashboard-data.json` and `public/data/metadata.json`.

## Preview locally

```bash
cd public
python3 -m http.server 8088
# open http://localhost:8088
```

## Deploy to GitHub Pages

If this folder is connected to a GitHub repository, the simplest static deployment is:

1. Commit the dashboard source plus refreshed `public/data/*.json`.
2. Push to GitHub.
3. In the repository settings, enable **Pages**.
4. Choose either:
   - deploy from the `main` branch and `/public` folder, if available in the repo’s Pages settings; or
   - use a GitHub Actions Pages workflow that uploads `public/` as the site artifact.

Do not publish until the permission posture for REALIS-derived aggregate outputs has been confirmed.

## Future update flow

1. Monthly REALIS downloader adds the latest monthly CSV.
2. Run `python3 etl/build_dashboard_data.py`.
3. Run `python3 etl/validate_public_data.py`.
4. Commit the refreshed `public/data/*.json` and dashboard files.
5. Deploy `public/` to GitHub Pages, after confirming publication is permitted.

## Deploy to GitHub Pages

One simple static deployment flow:

1. Rebuild locally:

```bash
cd /Users/lyt/.openclaw/workspace/realis-private-residential-dashboard
python3 etl/build_dashboard_data.py
python3 etl/validate_public_data.py
```

2. Commit the dashboard source and regenerated `public/data/*.json`.
3. In GitHub, publish the `public/` directory via your preferred Pages flow:
   - either use a Pages deploy action that uploads `public/`
   - or publish from a branch/folder arrangement where `public/` is the served site root
4. After deploy, verify:
   - `index.html` loads
   - `data/dashboard-data.json` and `data/metadata.json` return `200`
   - filters, turnover tables, and expiry cohort table render without console errors

Keep the existing policy note: REALIS-derived aggregates should be confirmed as publishable before turning on public GitHub Pages.

## Market segment derivation

The current REALIS transaction CSVs here do not include an explicit `Market Segment` column. The ETL derives a transparent proxy:

- **CCR**: postal districts `09`, `10`, `11`, or planning areas containing `Downtown Core` or `Sentosa`.
- **RCR**: other projects in `Central Region`.
- **OCR**: projects outside `Central Region`.
- **Unknown**: fallback where region/district is unavailable.

This is intended for broad analyst segmentation, not as an official URA market-segment classification.
