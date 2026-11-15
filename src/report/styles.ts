export const REPORT_STYLES = `
:root {
  color-scheme: only light;
  scrollbar-gutter: stable;
  --bg: #f5f5f2;
  --surface: #fff;
  --muted: #fafaf8;
  --border: #e2e2dc;
  --line: #efefea;
  --ink: #15171a;
  --secondary: #585e66;
  --body: #42474d;
  --table-head: #f6f6f3;
  --track: #ecece8;
  --marker: #9a9ea4;
  --link: #1f4fa8;
  --ok: #15603c;
  --ok-bg: #e3f0e8;
  --ok-line: #c3dfce;
  --plan: #8a6000;
  --plan-bg: #fdf3d8;
  --plan-line: #efdca6;
  --fix: #8c1d18;
  --fix-bg: #f9e3e1;
  --fix-line: #efcbc7;
  --sans: ui-sans-serif, system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Consolas, monospace;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 var(--sans); }
h1, h2, h3, p, dl, dd { margin: 0; }
code, .number, .fact-value, .meta-value { font-family: var(--mono); font-variant-numeric: tabular-nums; }
a { color: var(--link); text-underline-offset: .2em; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 3px; }
.container { width: min(1180px, calc(100% - 48px)); margin-inline: auto; padding-block: 36px 52px; }
.report-header { margin-bottom: 24px; }
h1 { font-size: clamp(25px, 5vw, 32px); line-height: 1.16; font-weight: 680; }
.diagnostic-notice { color: var(--secondary); margin-bottom: 14px; }
.header-meta { margin-top: 18px; display: grid; gap: 4px; }
.meta-item { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; font-size: 13px; }
.meta-item dt, .score-coverage, .score-zone { color: var(--secondary); }
.meta-value { min-width: 0; overflow-wrap: anywhere; }

.section, .overview-grid { padding: 24px 26px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.section, .instrument-section { margin-top: 24px; }
.overview-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin-top: 24px; }
.overview-details > .section { margin-top: 0; min-width: 0; }
.overview-details > :only-child { grid-column: 1 / -1; }
.availability-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.availability-item-title { margin: 0 0 4px; font-size: 14px; font-weight: 650; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 18px; margin-bottom: 16px; }
.section-title { font-size: 18px; line-height: 1.25; font-weight: 650; }
.empty-state { color: var(--secondary); font-size: 13px; }

.overview-grid { display: grid; grid-template-columns: minmax(190px, 1fr) minmax(0, 3.2fr); gap: 30px; }
.score-card { border-inline-end: 1px solid var(--line); padding-inline-end: 30px; }
.score-label { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--secondary); font-weight: 680; }
.score-value { font-size: clamp(46px, 7vw, 60px); line-height: 1.12; font-weight: 700; color: var(--tone); }
.score-max { font-size: 20px; margin-inline-start: 7px; color: var(--secondary); }
.score-zone { font-size: 12px; margin-top: 5px; }
.score-coverage { margin-top: 8px; font-size: 13px; }
.zone-green, .status-ok, .badge-ok { --tone: var(--ok); --wash: var(--ok-bg); --rim: var(--ok-line); }
.zone-yellow, .status-plan, .badge-plan, .badge-importance-mid { --tone: var(--plan); --wash: var(--plan-bg); --rim: var(--plan-line); }
.zone-red, .status-fix, .badge-fix, .badge-importance-high { --tone: var(--fix); --wash: var(--fix-bg); --rim: var(--fix-line); }
.zone-none, .status-no-data, .badge-no-data, .badge-disabled, .badge-incomplete, .badge-importance-low {
  --tone: var(--body); --wash: var(--track); --rim: var(--border);
}
.counters-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.counter-card { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 14px; min-height: 68px; border: 1px solid var(--rim); border-radius: 12px; color: var(--tone); background: var(--wash); }
.counter-card.is-zero { background: color-mix(in srgb, var(--wash), var(--surface) 55%); }
.counter-icon { display: grid; place-items: center; border-radius: 50%; background: var(--surface); width: 28px; height: 28px; }
.status-icon { width: 13px; height: 13px; flex: none; }
.counter-icon .status-icon { width: 17px; height: 17px; }
.counter-label { font-size: 13px; font-weight: 680; }
.counter-note { color: var(--secondary); font-size: 12px; }
.counter-count { font-size: 25px; font-weight: 700; }

.meter { position: relative; margin-top: 10px; }
.meter-track { display: block; height: 9px; border-radius: 999px; background: var(--track); }
.meter-fill { display: block; height: 100%; border-radius: inherit; background: var(--tone); }
.meter-mark { position: absolute; inset-block-start: -3px; transform: translateX(-50%); width: 2px; height: 15px; }
.meter-warn { background: var(--marker); }
.meter-target { background: var(--body); }
.meter-labels { display: flex; justify-content: space-between; gap: 4px 8px; flex-wrap: wrap; margin-top: 7px; color: var(--secondary); font-size: 12px; }
.meter-labels span { white-space: nowrap; }
.meter-key { display: inline-block; width: 2px; height: 9px; margin-inline-end: 5px; }

.table-wrapper { overflow: auto; max-width: 100%; border: 1px solid var(--border); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 11px 14px; text-align: start; vertical-align: middle; overflow-wrap: anywhere; }
th { background: var(--table-head); color: var(--body); border-bottom: 1px solid var(--border); font-weight: 650; }
tbody tr + tr { border-top: 1px solid var(--line); }
tbody tr:nth-child(even) { background: var(--muted); }
td { color: var(--body); }
td strong, .cell-now { color: var(--ink); }
.cell-now, .cell-target, .column-number { text-align: center; white-space: nowrap; }
.cell-now { font-weight: 680; }
.code-path { font-family: var(--mono); font-size: 12px; }
.import-map-table { table-layout: fixed; }
.import-package-column { width: 26%; }
.import-version-column { width: 14%; }
.import-map-table td { vertical-align: top; white-space: normal; }
.import-locations { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.import-specifier { color: var(--secondary); }
.findings-heading { margin-bottom: 14px; }
.findings-body { display: grid; gap: 8px; }
.tool-description { margin-top: 6px; max-width: 72ch; color: var(--secondary); font-size: 13px; }
.issue-panel { display: grid; gap: 8px; min-width: 0; }
.filter-empty { display: none; }
.issue-filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 4px; padding: 0; border: 0; min-width: 0; }
.issue-filter label { position: relative; }
.issue-filter input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.issue-filter span {
  display: block;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--body);
  font-size: 13px;
}
.issue-filter label:hover span { background: var(--table-head); }
.issue-filter input:checked + span { border-color: var(--link); color: var(--link); background: var(--table-head); }
.issue-filter input:focus-visible + span { outline: 2px solid var(--link); outline-offset: 2px; }
.finding-list, .details-content .finding-list {
  display: grid; gap: 8px; margin: 0; padding: 0; list-style: none;
}
.finding-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--rim);
  border-radius: 10px;
  background: color-mix(in srgb, var(--wash), var(--surface) 25%);
}
.finding-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: var(--tone); background: var(--surface); }
.finding-icon .status-icon { width: 22px; height: 22px; }
.finding-content { display: grid; gap: 4px; overflow-wrap: anywhere; }
.finding-location { font-size: 13px; font-weight: 650; }
.finding-message { color: var(--body); font-size: 13px; }
.rule-counts { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--muted); }
.rule-counts dt { font-family: var(--mono); font-size: 12px; }

@media screen {
  .issue-panel:has(input[value="error"]:checked) .finding-item:not([data-severity="error"]),
  .issue-panel:has(input[value="warning"]:checked) .finding-item:not([data-severity="warning"]),
  .issue-panel:has(input[value="info"]:checked) .finding-item:not([data-severity="info"]) { display: none; }
  .issue-panel:has(input[value="error"]:checked):not(:has([data-severity="error"])) .filter-empty,
  .issue-panel:has(input[value="warning"]:checked):not(:has([data-severity="warning"])) .filter-empty,
  .issue-panel:has(input[value="info"]:checked):not(:has([data-severity="info"])) .filter-empty { display: block; }
}

.indicators-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 20px; }
.indicator-card { display: flex; flex-direction: column; gap: 14px; min-width: 0; padding: 20px 22px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.indicator-card.status-no-data { border-style: dashed; background: var(--muted); }
.indicator-incomplete { align-self: flex-start; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 10px; border-radius: 999px; color: var(--tone); background: var(--wash); font-size: 12px; font-weight: 650; line-height: 1.45; }
.indicator-header { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px; }
.indicator-title { font-size: 15px; font-weight: 650; }
.indicator-value { font-size: clamp(25px, 3vw, 38px); line-height: 1.05; font-weight: 680; overflow-wrap: anywhere; }
.indicator-body { display: grid; gap: 12px; min-width: 0; }
.metric-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 80px), 1fr)); gap: 8px; }
.metric-tiles.two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metric-tile { display: flex; flex-direction: column-reverse; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--muted); }
.metric-tile dt, .metric-rows dt, .fact-name { color: var(--secondary); font-size: 13px; overflow-wrap: anywhere; }
.metric-tile dd { font-size: 17px; font-weight: 680; overflow-wrap: anywhere; }
.metric-rows { display: grid; gap: 4px; }
.metric-rows > div, .fact-item { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.metric-rows dd, .fact-value { text-align: end; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.card-footer { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: space-between; color: var(--secondary); font-size: 12px; }
.card-footer code { overflow-wrap: anywhere; }
.card-footer span { white-space: nowrap; }
.card-footer.card-actions { justify-content: flex-start; }
.card-actions .details-link { min-width: 0; justify-content: center; text-align: center; overflow-wrap: anywhere; }
.callout { padding: 10px 12px; border-radius: 8px; background: var(--table-head); color: var(--body); overflow-wrap: anywhere; }
.callout-title { font-weight: 600; }
.callout-action { color: var(--secondary); margin-top: 5px; }
.check-diagnostic { display: grid; gap: 3px; color: var(--body); }
.check-diagnostic code { padding: 6px 8px; background: var(--table-head); border: 1px solid var(--line); border-radius: 6px; font-size: 12px; }
details { min-width: 0; }
summary { cursor: pointer; overflow-wrap: anywhere; color: var(--link); min-height: 24px; line-height: 24px; }
.details-content { margin-top: 8px; overflow-wrap: anywhere; }
.details-content ul { margin: 0; padding-inline-start: 20px; }
.checks-list { display: grid; gap: 12px; }
.check-item { display: grid; gap: 7px; }
.details-link {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  max-width: 100%;
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--table-head);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  text-decoration: none;
}
.details-link:hover { background: var(--track); }
.largest-files { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--muted); }
.largest-files-title { margin: 0 0 7px; font-size: 13px; font-weight: 650; }
.largest-files .metric-rows dt { min-width: 0; font-family: var(--mono); font-size: 12px; }
.largest-files .metric-rows dd { flex: none; white-space: nowrap; }
.limit-note { color: var(--secondary); font-size: 12px; margin-top: 7px; }
.report-footer { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--border); display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 7px 16px; color: var(--secondary); font-size: 13px; }
.report-footer strong { color: var(--body); font-size: 20px; letter-spacing: -.035em; margin-inline-end: 8px; }

@media (max-width: 850px) {
  .overview-grid { grid-template-columns: 1fr; gap: 16px; }
  .overview-details { grid-template-columns: minmax(0, 1fr); }
  .score-card { border-inline-end: 0; border-bottom: 1px solid var(--line); padding: 0 0 14px; }
}
@media (max-width: 580px) {
  .container { width: calc(100% - 28px); padding-block: 24px 36px; }
  .section, .overview-grid, .indicator-card { padding: 14px; }
  .counters-grid { grid-template-columns: 1fr; }
  .summary-table { min-width: 550px; }
  th, td { padding: 9px; }
  .import-map-table { min-width: 0; font-size: 12px; }
  .import-package-column { width: 24%; }
  .import-version-column { width: 19%; }
  .import-map-table th, .import-map-table td { padding-inline: 5px; white-space: normal; }
  .import-specifier { display: block; }
}
@media print {
  .container { width: 100%; padding: 0; }
  .overview-grid, .indicator-card, .finding-item, tr { break-inside: avoid; }
  .issue-filter { display: none; }
  .table-wrapper { overflow: visible; }
}
`;
