import type { Report } from '@code-pushup/models';
import type { PluginNoData } from '../core/plugin-guard.js';
import type { FrontisResult, IResultCheck, IResultIndicator, IResultIssue } from '../core/types/result.js';
import { escapeHtml } from './escape.js';
import {
  CHECK_TITLES,
  IMPORTANCE_LABELS,
  INDICATOR_TITLES,
  STATUS_ICONS,
  STATUS_LABELS,
  ZONE_LABELS,
} from './labels.js';
import { REPORT_STYLES } from './styles.js';

export interface GenerateReportOptions {
  result?: FrontisResult;
  report?: Report;
  noData?: readonly PluginNoData[];
  project?: {
    name?: string | null;
    version?: string | null;
    branch?: string | null;
    commit?: string | null;
  };
}

const MAX_LIST_ITEMS = 10;

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return escapeHtml(isoString);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return escapeHtml(isoString);
  }
}

function formatDuration(durationMs?: number): string {
  if (typeof durationMs !== 'number' || durationMs < 0) return '';
  if (durationMs < 1000) return `${durationMs} мс`;
  return `${(durationMs / 1000).toFixed(1)} с`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} МБ`;
}

function renderHeader(
  project: { name?: string | null; version?: string | null; branch?: string | null; commit?: string | null },
  toolVersion: string,
  runAt: string,
  durationMs?: number,
): string {
  const name = project.name ? escapeHtml(project.name) : 'Проект без имени';
  const versionHtml = project.version ? `<span class="project-version">v${escapeHtml(project.version)}</span>` : '';
  const branchHtml = project.branch
    ? `<div class="meta-item"><span>Ветка:</span> <strong>${escapeHtml(project.branch)}</strong></div>`
    : '';
  const commitHtml = project.commit
    ? `<div class="meta-item"><span>Коммит:</span> <strong class="meta-commit" title="${escapeHtml(project.commit)}">${escapeHtml(project.commit.slice(0, 7))}</strong></div>`
    : `<div class="meta-item"><span>Коммит:</span> <strong>Коммит недоступен</strong></div>`;
  const durationText = formatDuration(durationMs);
  const timeHtml = `<div class="meta-item"><span>Запуск:</span> <time datetime="${escapeHtml(runAt)}">${formatDateTime(runAt)}</time>${durationText ? ` (${escapeHtml(durationText)})` : ''}</div>`;

  return `
  <header class="report-header">
    <div class="header-top">
      <div class="project-title">
        <span>${name}</span>
        ${versionHtml}
      </div>
      <div class="brand-badge">Frontis v${escapeHtml(toolVersion)}</div>
    </div>
    <div class="header-meta">
      ${branchHtml}
      ${commitHtml}
      ${timeHtml}
    </div>
  </header>`;
}

function renderScoreAndCounters(result: FrontisResult): string {
  const { score, indicators } = result;
  const isScoreAvailable = score.value !== null && score.zone !== null;

  const zoneClass = isScoreAvailable ? `zone-${score.zone}` : 'zone-none';
  const scoreValueHtml = isScoreAvailable ? `${score.value}` : '—';
  const scoreZoneText = isScoreAvailable && score.zone ? ZONE_LABELS[score.zone] : 'Балл не рассчитан';
  const coverageText = isScoreAvailable
    ? `Охват: ${score.known} из ${score.total} показателей`
    : `Недостаточно данных для оценки (${score.known} из ${score.total}, требуется минимум 3)`;

  const counts = { ok: 0, plan: 0, fix: 0, 'no-data': 0 };
  for (const ind of indicators) {
    if (ind.status in counts) {
      counts[ind.status as keyof typeof counts]++;
    }
  }

  return `
  <div class="overview-grid">
    <div class="score-card ${zoneClass}">
      <div class="score-label">Оценка проекта</div>
      <div class="score-value">${scoreValueHtml}</div>
      <div class="score-zone">${escapeHtml(scoreZoneText)}</div>
      <div class="score-coverage">${escapeHtml(coverageText)}</div>
    </div>
    <div class="counters-grid">
      <div class="counter-card status-ok">
        <div class="counter-count">${counts.ok}</div>
        <div class="counter-label">${escapeHtml(STATUS_LABELS.ok)}</div>
      </div>
      <div class="counter-card status-plan">
        <div class="counter-count">${counts.plan}</div>
        <div class="counter-label">${escapeHtml(STATUS_LABELS.plan)}</div>
      </div>
      <div class="counter-card status-fix">
        <div class="counter-count">${counts.fix}</div>
        <div class="counter-label">${escapeHtml(STATUS_LABELS.fix)}</div>
      </div>
      <div class="counter-card status-no-data">
        <div class="counter-count">${counts['no-data']}</div>
        <div class="counter-label">${escapeHtml(STATUS_LABELS['no-data'])}</div>
      </div>
    </div>
  </div>`;
}

function renderRecommendations(recommendations: FrontisResult['recommendations']): string {
  const countBadge = `<span class="section-badge">${recommendations.length}</span>`;
  if (recommendations.length === 0) {
    return `
    <section class="section" id="recommendations">
      <h2 class="section-title">Рекомендации ${countBadge}</h2>
      <div class="empty-state">Отклонений не обнаружено. Все показатели в норме.</div>
    </section>`;
  }

  const rows = recommendations.map((rec) => {
    const importanceLabel = IMPORTANCE_LABELS[rec.importance] || rec.importance;
    const importanceClass = `badge-importance-${rec.importance}`;
    const indicatorTitle = INDICATOR_TITLES[rec.indicator] || rec.indicator;
    return `
      <tr>
        <td><span class="badge ${importanceClass}">${escapeHtml(importanceLabel)}</span></td>
        <td><strong>${escapeHtml(rec.text)}</strong></td>
        <td>${escapeHtml(indicatorTitle)}</td>
        <td><code>${escapeHtml(rec.now)}</code></td>
        <td><code>${escapeHtml(rec.target)}</code></td>
      </tr>`;
  }).join('');

  return `
  <section class="section" id="recommendations">
    <h2 class="section-title">Рекомендации ${countBadge}</h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="width: 120px;">Важность</th>
            <th>Действие</th>
            <th>Показатель</th>
            <th style="width: 100px;">Сейчас</th>
            <th style="width: 100px;">Цель</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`;
}

interface NoDataItem {
  name: string;
  reason: string;
  action: string;
}

function collectNoDataItems(indicators: IResultIndicator[]): NoDataItem[] {
  const items: NoDataItem[] = [];
  for (const ind of indicators) {
    if (ind.status === 'no-data' && ind.reason) {
      items.push({
        name: INDICATOR_TITLES[ind.id] || ind.id,
        reason: ind.reason,
        action: ind.action || '',
      });
    }
    for (const check of ind.checks) {
      if (check.status === 'no-data' && check.reason && !items.some((i) => i.reason === check.reason)) {
        items.push({
          name: CHECK_TITLES[check.id] || check.id,
          reason: check.reason,
          action: check.action || '',
        });
      }
    }
  }
  return items;
}

function renderNoDataTable(indicators: IResultIndicator[]): string {
  const items = collectNoDataItems(indicators);
  if (items.length === 0) return '';

  const rows = items.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(item.action)}</td>
    </tr>
  `).join('');

  return `
  <section class="section" id="no-data-reasons">
    <h2 class="section-title">Причины отсутствия данных <span class="section-badge">${items.length}</span></h2>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="width: 220px;">Показатель / Проверка</th>
            <th>Причина</th>
            <th>Рекомендуемое действие</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderIssues(issues: IResultIssue[]): string {
  if (issues.length === 0) return '';
  const total = issues.length;
  const sliced = issues.slice(0, MAX_LIST_ITEMS);

  const rows = sliced.map((issue) => {
    const sev = issue.severity || 'info';
    const sourceFile = issue.source && 'file' in issue.source ? issue.source.file : undefined;
    const line = issue.source && 'position' in issue.source && issue.source.position ? `:${issue.source.position.startLine}` : '';
    const file = sourceFile ? `${sourceFile}${line}` : '—';
    return `
      <tr>
        <td><span class="badge badge-${sev === 'error' ? 'fix' : sev === 'warning' ? 'plan' : 'no-data'}">${escapeHtml(sev)}</span></td>
        <td class="code-path">${escapeHtml(file)}</td>
        <td>${escapeHtml(issue.message)}</td>
      </tr>`;
  }).join('');

  const limitNote = total > MAX_LIST_ITEMS
    ? `<div class="limit-note">Показано ${MAX_LIST_ITEMS} из ${total} находок. Полный список сохранён в result.json</div>`
    : '';

  return `
  <details>
    <summary>Находки (${total})</summary>
    <div class="details-content">
      <div class="table-wrapper">
        <table class="issues-table">
          <thead>
            <tr>
              <th style="width: 90px;">Уровень</th>
              <th style="width: 260px;">Файл</th>
              <th>Сообщение</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      ${limitNote}
    </div>
  </details>`;
}

function renderLargestFiles(files: { file: string; bytes: number }[]): string {
  if (files.length === 0) return '';
  const total = files.length;
  const sliced = files.slice(0, MAX_LIST_ITEMS);

  const rows = sliced.map((f) => `
    <tr>
      <td class="code-path">${escapeHtml(f.file)}</td>
      <td style="text-align: right;">${escapeHtml(formatBytes(f.bytes))}</td>
    </tr>
  `).join('');

  return `
  <details>
    <summary>Крупнейшие файлы (${total})</summary>
    <div class="details-content">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Файл</th>
              <th style="width: 120px; text-align: right;">Размер</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  </details>`;
}

function renderRules(rules: { rule: string; count: number }[]): string {
  if (rules.length === 0) return '';
  const rows = rules.slice(0, MAX_LIST_ITEMS).map((r) => `
    <tr>
      <td class="code-path">${escapeHtml(r.rule)}</td>
      <td style="text-align: right;">${r.count}</td>
    </tr>
  `).join('');

  return `
  <details>
    <summary>Наиболее частые правила (${rules.length})</summary>
    <div class="details-content">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Правило</th>
              <th style="width: 120px; text-align: right;">Нарушения</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  </details>`;
}

function renderFacts(facts: Record<string, unknown>): string {
  const entries = Object.entries(facts).filter(([, val]) => val !== undefined && val !== null);
  if (entries.length === 0) return '';
  const items = entries.map(([key, val]) => `
    <div class="fact-item">
      <span class="fact-name">${escapeHtml(key)}:</span>
      <span class="fact-value">${escapeHtml(String(val))}</span>
    </div>
  `).join('');

  return `<div class="facts-row">${items}</div>`;
}

function renderCheck(check: IResultCheck): string {
  const checkTitle = CHECK_TITLES[check.id] || check.id;
  const statusLabel = STATUS_LABELS[check.status] || check.status;
  const statusIcon = STATUS_ICONS[check.status] || '';
  const badgeClass = `badge-${check.status}`;

  const reasonHtml = check.status === 'no-data' && check.reason
    ? `<div class="callout callout-no-data">
        <div class="callout-title">${escapeHtml(check.reason)}</div>
        ${check.action ? `<div class="callout-action">${escapeHtml(check.action)}</div>` : ''}
       </div>`
    : '';

  const issuesHtml = check.details?.issues ? renderIssues(check.details.issues) : '';
  const largestFilesHtml = check.details?.largestFiles ? renderLargestFiles(check.details.largestFiles) : '';
  const rulesHtml = check.details?.rules ? renderRules(check.details.rules) : '';
  const factsHtml = renderFacts(check.facts);

  return `
  <div class="check-item">
    <div class="check-header">
      <span class="check-title">${escapeHtml(checkTitle)}</span>
      <span class="badge ${badgeClass}">${statusIcon} ${escapeHtml(statusLabel)}</span>
    </div>
    ${reasonHtml}
    ${factsHtml}
    ${issuesHtml}
    ${largestFilesHtml}
    ${rulesHtml}
  </div>`;
}

function renderIndicators(indicators: IResultIndicator[]): string {
  const cards = indicators.map((ind) => {
    const title = INDICATOR_TITLES[ind.id] || ind.id;
    const statusLabel = STATUS_LABELS[ind.status] || ind.status;
    const statusIcon = STATUS_ICONS[ind.status] || '';
    const badgeClass = `badge-${ind.status}`;
    const incompleteBadge = ind.incomplete
      ? '<span class="badge badge-incomplete">Неполные данные</span>'
      : '';

    const reasonHtml = ind.status === 'no-data' && ind.reason && ind.checks.length <= 1
      ? `<div class="callout callout-no-data">
          <div class="callout-title">${escapeHtml(ind.reason)}</div>
          ${ind.action ? `<div class="callout-action">${escapeHtml(ind.action)}</div>` : ''}
         </div>`
      : '';

    const checksHtml = ind.checks.map(renderCheck).join('');

    return `
    <article class="indicator-card" id="indicator-${escapeHtml(ind.id)}">
      <div class="indicator-header">
        <h3 class="indicator-title">${escapeHtml(title)}</h3>
        <div class="indicator-badges">
          ${incompleteBadge}
          <span class="badge ${badgeClass}">${statusIcon} ${escapeHtml(statusLabel)}</span>
        </div>
      </div>
      <div class="indicator-body">
        ${reasonHtml}
        <div class="checks-list">
          ${checksHtml}
        </div>
      </div>
    </article>`;
  }).join('');

  return `
  <section class="section" id="indicators">
    <h2 class="section-title">Карточки показателей <span class="section-badge">${indicators.length}</span></h2>
    <div class="indicators-list">
      ${cards}
    </div>
  </section>`;
}

function renderDiagnosticReport(options: GenerateReportOptions): string {
  const project = options.project || options.result?.project || {};
  const toolVersion = options.result?.tool.version || '0.1.0';
  const runAt = options.result?.runAt || new Date().toISOString();
  const noData = options.noData || [];

  const rows = noData.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.plugin)}</strong></td>
      <td><code>${escapeHtml(item.code)}</code></td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(item.action)}</td>
      <td>${item.logFile ? `<code>${escapeHtml(item.logFile)}</code>` : '—'}</td>
    </tr>
  `).join('');

  const tableHtml = noData.length > 0
    ? `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Плагин</th>
            <th>Код</th>
            <th>Причина</th>
            <th>Рекомендуемое действие</th>
            <th>Лог</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`
    : '<div class="empty-state">Нет сведений о причинах отсутствия данных.</div>';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Frontis: Диагностический отчёт</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="container">
    ${renderHeader(project, toolVersion, runAt)}
    <div class="diagnostic-banner">
      <span>⚠</span>
      <div>Диагностический отчёт: запуск не дал валидных данных для оценки проекта. Общий балл отсутствует.</div>
    </div>
    <section class="section">
      <h2 class="section-title">Причины отсутствия данных по модулям <span class="section-badge">${noData.length}</span></h2>
      ${tableHtml}
    </section>
  </div>
</body>
</html>`;
}

export function generateHtmlReport(options: GenerateReportOptions): string {
  if (!options.result) {
    return renderDiagnosticReport(options);
  }

  const { result } = options;
  const project = result.project;
  const toolVersion = result.tool.version;
  const runAt = result.runAt;
  const durationMs = result.durationMs;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Frontis: ${escapeHtml(project.name || 'Аудит проекта')}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="container">
    ${renderHeader(project, toolVersion, runAt, durationMs)}
    ${renderScoreAndCounters(result)}
    ${renderRecommendations(result.recommendations)}
    ${renderNoDataTable(result.indicators)}
    ${renderIndicators(result.indicators)}
  </div>
</body>
</html>`;
}
