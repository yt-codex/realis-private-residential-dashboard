# REALIS dashboard GH Pages audit — 2026-05-07

Live URL: https://yt-codex.github.io/realis-private-residential-dashboard/
Repo: /Users/lyt/.openclaw/workspace/realis-private-residential-dashboard
Commit inspected: f59c97a

## Checks run

- Loaded live GitHub Pages site with Playwright headless at desktop/tablet/mobile widths.
- Captured console/page errors: none.
- Ran `python3 etl/validate_public_data.py`: passes.
- Confirmed public payload size: `dashboard-data.json` ~7.2 MB, 2,000 project rows, 32,619 monthly filter points.
- Captured screenshots under workspace artifacts:
  - `/Users/lyt/.openclaw/workspace/artifacts/realis-dashboard-gh-pages.png`
  - `/Users/lyt/.openclaw/workspace/artifacts/realis-dashboard-mobile.png`
  - `/Users/lyt/.openclaw/workspace/artifacts/realis-dashboard-tablet.png`
  - `/Users/lyt/.openclaw/workspace/artifacts/realis-dashboard-desktop.png`

## Main findings

### P0/P1 bugs

1. Tab panels are not visually hidden.
   - Root cause: author CSS rules like `.grid{display:grid}` override the HTML `hidden` attribute in practice.
   - Evidence: `.tab-panel` elements have `hidden=true`, but computed display remains `grid`; live page text extraction also shows all sections at once.
   - Fix: add `[hidden]{display:none!important;}` near the top of CSS.

2. Mobile horizontal overflow.
   - At 390px viewport, document scrollWidth exceeds viewport.
   - Causes include long methodology file paths and fixed/min grid content.
   - Fixes: `overflow-wrap:anywhere` for methodology/list text, tighter mobile grid widths, and defensive `max-width:100%` for cards/charts.

3. Project search summary is misleading.
   - Searching `The Red House` shows the project row, but the filter summary still reports the full 28,061 latest-12m market transactions because project search is not part of `selectedLatest12Summary`.
   - Fix: when `projectSearch` is active, show matched project count, matched latest-12m tx, median PSF range, and stock coverage instead of global filter summary.

4. Global project panels remain visible during project search.
   - Planning-area ranking remains visible after searching for a project, which dilutes the filtered story.
   - Fix: treat project search as a filter mode for project tab, or label global sections clearly.

5. `N.A.` appears as a project in the screener.
   - `N.A.` has 26,177 all-time transactions and 711 latest-12m tx, mostly landed/property rows, stock 0.
   - Fix: exclude project names that normalize to blank / `N.A.` / `NA` / `N A` from project screener and top lists, or place them in an explicit unmatched bucket.

### Method/data limitations

6. Stock-adjusted turnover excludes many active new-launch projects because latest stock table has 0 stock until completed.
   - This is defensible but needs a visible caveat: "stock-adjusted turnover is only meaningful for matched active completed stock."

7. Project screener mixes landed and non-landed transaction projects while stock data is non-landed active stock.
   - This creates rows with stock 0 and impossible turnover.
   - Fix: add a project universe toggle: all private residential activity vs stock-matched non-landed only.

8. Market segment is a proxy, not official URA field.
   - Already noted in methodology, but should be promoted near segment charts/filters.

9. Payload is large for a static dashboard.
   - 7.2 MB JSON loads okay on desktop but is heavy for mobile and rerenders all views on every filter input.
   - Fix: split payload into core, project screener, leasehold; lazy-load tab-specific JSON.

### UX/content improvements

10. Top tables are too shallow at 5 rows and not sortable.
11. Canvas trend has no axis labels/ticks/tooltips, limiting analytical use.
12. Filters lack reset/share-link state.
13. There is no loading/error fallback if JSON fetch fails.
14. Accessibility needs work: canvas equivalents, aria-selected tabs, keyboard-visible focus, stronger table captions.

## Enhancement plan

### Phase 1 — correctness and polish

- Add `[hidden]{display:none!important;}`.
- Fix mobile overflow and long-text wrapping.
- Add fetch `.catch()` and visible error state.
- Exclude/segregate `N.A.` project rows.
- Make project-search summary reflect matched projects, not full market.
- Add explicit caveat on stock-matched vs unstocked/new-launch projects.

### Phase 2 — analytical usefulness

- Add project universe toggle: `All projects`, `Stock-matched non-landed`, `Recent launches`, `Leasehold only`.
- Add sortable/paginated project table with 25/50/100 rows.
- Add project detail drawer: latest 12m metrics, stock, sale mix, property mix, lease expiry, planning area, matched-stock flag.
- Add reset filters and URL query persistence.
- Add chart tooltips and axis labels.

### Phase 3 — data architecture

- Split payloads by tab and lazy-load project/leasehold data.
- Generate a compact search index for projects.
- Add build-time QA outputs: unmatched projects, zero-stock high-volume projects, top `N.A.`/blank project-name counts, stock match rate by segment/property type.
- Add CI validation for dashboard render smoke test and mobile overflow.

### Phase 4 — research/product layer

- Add leasehold-risk explorer by expiry decade + planning area.
- Add stock-adjusted liquidity map/ranking by planning area.
- Add “data limitations” drawer with exact numerator/denominator definitions.
- Add download buttons for public aggregate tables.
