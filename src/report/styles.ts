export const REPORT_STYLES = `
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-secondary: #f1f5f9;
  --border: #e2e8f0;
  --border-subtle: #cbd5e1;
  --fg: #0f172a;
  --fg-muted: #64748b;
  --fg-subtle: #94a3b8;
  
  --ok: #10b981;
  --ok-bg: #ecfdf5;
  --ok-border: #a7f3d0;
  --ok-text: #065f46;

  --plan: #f59e0b;
  --plan-bg: #fffbeb;
  --plan-border: #fde68a;
  --plan-text: #92400e;

  --fix: #ef4444;
  --fix-bg: #fef2f2;
  --fix-border: #fecaca;
  --fix-text: #991b1b;

  --no-data: #64748b;
  --no-data-bg: #f8fafc;
  --no-data-border: #cbd5e1;
  --no-data-text: #334155;

  --brand: #2563eb;
  --brand-bg: #eff6ff;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b0f19;
    --surface: #131b2e;
    --surface-secondary: #1e293b;
    --border: #243048;
    --border-subtle: #334155;
    --fg: #f8fafc;
    --fg-muted: #94a3b8;
    --fg-subtle: #64748b;

    --ok: #10b981;
    --ok-bg: rgba(16, 185, 129, 0.12);
    --ok-border: rgba(16, 185, 129, 0.3);
    --ok-text: #6ee7b7;

    --plan: #f59e0b;
    --plan-bg: rgba(245, 158, 11, 0.12);
    --plan-border: rgba(245, 158, 11, 0.3);
    --plan-text: #fcd34d;

    --fix: #ef4444;
    --fix-bg: rgba(239, 68, 68, 0.15);
    --fix-border: rgba(239, 68, 68, 0.35);
    --fix-text: #fca5a5;

    --no-data: #94a3b8;
    --no-data-bg: rgba(148, 163, 184, 0.1);
    --no-data-border: rgba(148, 163, 184, 0.25);
    --no-data-text: #cbd5e1;

    --brand: #60a5fa;
    --brand-bg: rgba(37, 99, 235, 0.15);
    --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
    --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
  }
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--fg);
  background-color: var(--bg);
  padding: 24px 16px 64px;
  -webkit-font-smoothing: antialiased;
}

.container {
  max-width: 1080px;
  margin: 0 auto;
}

/* Header */
.report-header {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px 28px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.project-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.project-version {
  font-size: 14px;
  font-weight: 500;
  color: var(--fg-muted);
  background: var(--surface-secondary);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

.brand-badge {
  font-size: 13px;
  font-weight: 600;
  color: var(--brand);
  background: var(--brand-bg);
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.header-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  font-size: 13px;
  color: var(--fg-muted);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.meta-commit {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

/* Overview: Score & Counters */
.overview-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

@media (max-width: 768px) {
  .overview-grid {
    grid-template-columns: 1fr;
  }
}

.score-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.score-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
}

.score-card.zone-green::before { background: var(--ok); }
.score-card.zone-yellow::before { background: var(--plan); }
.score-card.zone-red::before { background: var(--fix); }
.score-card.zone-none::before { background: var(--no-data); }

.score-value {
  font-size: 56px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 6px;
  letter-spacing: -0.03em;
}

.score-card.zone-green .score-value { color: var(--ok); }
.score-card.zone-yellow .score-value { color: var(--plan); }
.score-card.zone-red .score-value { color: var(--fix); }
.score-card.zone-none .score-value { color: var(--no-data); }

.score-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.score-zone {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.score-coverage {
  font-size: 12px;
  color: var(--fg-muted);
}

.counters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
}

.counter-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px 18px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.counter-card.status-ok { border-left: 4px solid var(--ok); }
.counter-card.status-plan { border-left: 4px solid var(--plan); }
.counter-card.status-fix { border-left: 4px solid var(--fix); }
.counter-card.status-no-data { border-left: 4px solid var(--no-data); }

.counter-count {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  margin-bottom: 4px;
}

.counter-card.status-ok .counter-count { color: var(--ok); }
.counter-card.status-plan .counter-count { color: var(--plan); }
.counter-card.status-fix .counter-count { color: var(--fix); }
.counter-card.status-no-data .counter-count { color: var(--no-data); }

.counter-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--fg-muted);
}

/* Sections */
.section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  background: var(--surface-secondary);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 999px;
}

/* Status & Importance Badges */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.badge-ok { background: var(--ok-bg); color: var(--ok-text); border: 1px solid var(--ok-border); }
.badge-plan { background: var(--plan-bg); color: var(--plan-text); border: 1px solid var(--plan-border); }
.badge-fix { background: var(--fix-bg); color: var(--fix-text); border: 1px solid var(--fix-border); }
.badge-no-data { background: var(--no-data-bg); color: var(--no-data-text); border: 1px solid var(--no-data-border); }

.badge-importance-high { background: var(--fix-bg); color: var(--fix-text); border: 1px solid var(--fix-border); }
.badge-importance-mid { background: var(--plan-bg); color: var(--plan-text); border: 1px solid var(--plan-border); }
.badge-importance-low { background: var(--no-data-bg); color: var(--no-data-text); border: 1px solid var(--no-data-border); }

.badge-incomplete {
  background: var(--plan-bg);
  color: var(--plan-text);
  border: 1px dashed var(--plan-border);
}

/* Tables */
.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}

th {
  background: var(--surface-secondary);
  color: var(--fg-muted);
  font-weight: 600;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
}

tr:last-child td {
  border-bottom: none;
}

tbody tr:hover {
  background: var(--surface-secondary);
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--fg-muted);
  font-size: 14px;
}

/* Callout Box */
.callout {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  margin-top: 10px;
  font-size: 13px;
}

.callout-no-data {
  background: var(--no-data-bg);
  border: 1px solid var(--no-data-border);
  color: var(--no-data-text);
}

.callout-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.callout-action {
  font-size: 12px;
  opacity: 0.9;
}

/* Indicators List & Cards */
.indicators-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.indicator-card {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.indicator-header {
  padding: 16px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.indicator-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}

.indicator-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

.indicator-body {
  padding: 16px 20px;
}

.checks-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.check-item {
  background: var(--surface-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
}

.check-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.check-title {
  font-size: 14px;
  font-weight: 600;
}

.facts-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 6px;
}

.fact-item {
  display: flex;
  gap: 4px;
}

.fact-name {
  color: var(--fg-subtle);
}

.fact-value {
  font-weight: 600;
  color: var(--fg);
}

/* Findings Details */
details {
  margin-top: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
}

summary {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  background: var(--surface-secondary);
}

summary:hover {
  background: var(--border);
}

summary:focus-visible {
  outline: 2px solid var(--brand);
}

.details-content {
  padding: 12px;
}

.issues-table {
  font-size: 12px;
}

.issues-table td {
  padding: 6px 10px;
}

.code-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.limit-note {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 8px;
  text-align: right;
}

/* Diagnostic Mode */
.diagnostic-banner {
  background: var(--fix-bg);
  border: 1px solid var(--fix-border);
  color: var(--fix-text);
  padding: 16px 20px;
  border-radius: var(--radius-md);
  margin-bottom: 24px;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 10px;
}
`;
