import type { Report } from '@code-pushup/models';
import { codePushUpPackage, frontisVersion } from '../core/package-info.js';
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
  runAt?: string;
  durationMs?: number;
  durations?: ReadonlyMap<string, number>;
  buildDir?: string;
  project?: {
    name?: string | null;
    version?: string | null;
    branch?: string | null;
    commit?: string | null;
  };
}

const MAX_LIST_ITEMS = 10;

const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, useGrouping: 'always' });

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '';
  }
  if (durationMs < 1000) {
    return `${durationMs} мс`;
  }
  if (durationMs < 60_000) {
    return `${decimals.format(durationMs / 1000)} с`;
  }
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  if (bytes < 1024 * 1024) {
    return `${decimals.format(bytes / 1024)} КБ`;
  }
  return `${decimals.format(bytes / (1024 * 1024))} МБ`;
}

function renderHeader(project: NonNullable<GenerateReportOptions['project']>, runAt: string): string {
  const name = project.name || 'Проект без имени';
  const version = project.version ? ` v${escapeHtml(project.version)}` : '';
  const branch = project.branch
    ? `<div class="meta-item"><dt>Ветка</dt><dd class="meta-value">${escapeHtml(project.branch)}</dd></div>`
    : '';
  const commit = project.commit
    ? `<code title="${escapeHtml(project.commit)}">${escapeHtml(project.commit.slice(0, 7))}</code>`
    : 'Коммит недоступен';

  return `
  <header class="report-header">
    <h1>Техническое здоровье проекта</h1>
    <dl class="header-meta">
      <div class="meta-item"><dt>Проект</dt><dd class="meta-value">${escapeHtml(name)}${version}</dd></div>
      <div class="meta-item"><dt>Запуск</dt><dd class="meta-value"><time datetime="${escapeHtml(runAt)}">${escapeHtml(formatDateTime(runAt))}</time></dd></div>
      <div class="meta-item"><dt>Коммит</dt><dd class="meta-value">${commit}</dd></div>
      ${branch}
    </dl>
  </header>`;
}

const statusNotes = {
  fix: 'Есть находки высокой важности',
  plan: 'Есть находки средней важности',
  ok: 'Отклонений нет или важность низкая',
  'no-data': 'Инструмент не дал результата',
} as const;
const statusOrder = ['fix', 'plan', 'ok', 'no-data'] as const;

function renderStatusIcon(status: IResultCheck['status']): string {
  return `<svg class="status-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STATUS_ICONS[status]}</svg>`;
}

function renderMeter(
  label: string,
  value: number | null,
  thresholds?: { warn?: number; target?: number; status?: IResultCheck['status'] },
): string {
  const { warn, target, status } = thresholds ?? {};
  const bounded = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  const marks = ([
    ['warn', 'Порог', warn],
    ['target', 'Цель', target],
  ] as const).flatMap(([kind, title, level]) => level === undefined ? [] : [{ kind, title, level }]);
  return `<div class="meter${status ? ` status-${escapeHtml(status)}` : ''}">
    <div class="meter-track" ${value === null ? 'aria-hidden="true"' : `role="meter" aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${bounded(value)}"`}>
      ${value === null ? '' : `<span class="meter-fill" style="width:${bounded(value)}%"></span>`}
      ${marks.map(({ kind, level }) => `<span class="meter-mark meter-${kind}" style="left:${bounded(level)}%" aria-hidden="true"></span>`).join('')}
    </div>
    ${marks.length === 0 ? '' : `<div class="meter-labels"><span aria-hidden="true">0%</span>${marks.map(({ kind, title, level }) =>
      `<span><i class="meter-key meter-${kind}" aria-hidden="true"></i>${title} ${decimals.format(level)}%</span>`,
    ).join('')}</div>`}
  </div>`;
}

function renderScoreAndCounters(score: FrontisResult['score'], indicators: readonly IResultIndicator[]): string {
  const { value, zone, known, total } = score;
  const coverage = value === null
    ? `Недостаточно данных для оценки. Доступно ${known} из ${total} показателей, требуется минимум 3.`
    : `Охват: ${known} из ${total} показателей. Зелёная зона от 90, жёлтая от 60.`;
  const counters = statusOrder.map((status) => {
    const count = indicators.filter((item) => item.status === status).length;
    return `<div class="counter-card status-${status}${count === 0 ? ' is-zero' : ''}">
      <span class="counter-icon">${renderStatusIcon(status)}</span>
      <div><div class="counter-label">${STATUS_LABELS[status]}</div><div class="counter-note">${statusNotes[status]}</div></div>
      <div class="counter-count number">${count}</div>
    </div>`;
  }).join('');

  return `
  <section class="overview-grid" aria-labelledby="score-title">
    <div class="score-card zone-${escapeHtml(zone ?? 'none')}">
      <h2 class="score-label" id="score-title">Оценка проекта</h2>
      <div><span class="score-value number">${escapeHtml(value ?? '—')}</span>${value === null ? '' : '<span class="score-max">/ 100</span>'}</div>
      ${renderMeter('Оценка проекта', value)}
      ${zone === null ? '' : `<p class="score-zone">${ZONE_LABELS[zone]}</p>`}
      <p class="score-coverage">${escapeHtml(coverage)}</p>
    </div>
    <div class="counters-grid">${counters}</div>
  </section>`;
}

const recommendationTitles: Record<string, string> = {
  'audit.critical': 'Уязвимости критического уровня',
  'audit.high': 'Уязвимости высокого уровня',
  'audit.moderate': 'Уязвимости среднего уровня',
  'audit.low': 'Уязвимости низкого уровня',
  'outdated.major': 'Мажорные отставания зависимостей',
  'outdated.minor': 'Минорные отставания зависимостей',
  'outdated.patch': 'Патчевые отставания зависимостей',
  'tests.failed': 'Тесты с ошибкой',
  'tests.skipped': 'Пропущенные тесты',
  'tests.failedSuites': 'Файлы тестов с ошибкой',
  'lint.errors': 'Ошибки линтера',
  'lint.warnings': 'Предупреждения линтера',
  'lint.format': 'Файлы не по формату',
  'prettier.parseErrors': 'Ошибки разбора Prettier',
  'unusedCode.files': 'Неиспользуемые файлы',
  'unusedCode.dependencies': 'Неиспользуемые зависимости',
  'unusedCode.exports': 'Неиспользуемые экспорты',
  'unusedCode.types': 'Неиспользуемые типы',
  'unusedCode.other': 'Другие находки knip',
  'coverage.lines': 'Покрытие строк',
};

function renderRecommendations({ recommendations, indicators }: FrontisResult): string {
  const findings = new Map(indicators.map(({ id, findings }) => [id, [...findings]]));
  const rows = recommendations.map(({ importance, indicator, now, target, text }) => {
    const related = findings.get(indicator) ?? [];
    const index = related.findIndex((item) => item.importance === importance && item.now === now && item.target === target);
    const [finding] = index === -1 ? [] : related.splice(index, 1);
    const title = (finding && recommendationTitles[finding.kind]) || INDICATOR_TITLES[indicator];
    return `
    <tr>
      <td><span class="badge badge-importance-${escapeHtml(importance)}">${escapeHtml(IMPORTANCE_LABELS[importance])}</span></td>
      <td><strong>${escapeHtml(title)}</strong></td>
      <td class="cell-now"><code>${escapeHtml(now)}</code></td>
      <td class="cell-target"><code>${escapeHtml(target)}</code></td>
      <td>${escapeHtml(text)}</td>
    </tr>`;
  }).join('');

  return `
  <section class="section" id="recommendations">
    <div class="section-heading">
      <h2 class="section-title">Рекомендации</h2>
    </div>
    ${rows === '' ? '<p class="empty-state">По доступным данным рекомендаций нет.</p>' : `
    <div class="table-wrapper" role="region" aria-label="Таблица рекомендаций" tabindex="0">
      <table class="summary-table">
        <thead><tr><th scope="col">Важность</th><th scope="col">Показатель</th><th scope="col" class="column-number">Сейчас</th><th scope="col" class="column-number">Цель</th><th scope="col">Описание</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`}
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
    const reasons = new Set<string>();
    for (const check of ind.checks) {
      if ((check.status === 'no-data' || check.incomplete) && check.reason && !reasons.has(check.reason)) {
        reasons.add(check.reason);
        items.push({
          name: ind.checks.length > 1 ? CHECK_TITLES[check.id] : INDICATOR_TITLES[ind.id],
          reason: check.reason,
          action: check.action || '',
        });
      }
    }
    if (ind.status === 'no-data' && ind.reason && reasons.size === 0) {
      items.push({ name: INDICATOR_TITLES[ind.id], reason: ind.reason, action: ind.action ?? '' });
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
    <div class="section-heading"><h2 class="section-title">Показатели без данных</h2></div>
    <div class="table-wrapper" role="region" aria-label="Таблица причин пропуска" tabindex="0">
      <table class="summary-table">
        <thead>
          <tr>
            <th scope="col">Показатель</th>
            <th scope="col">Причина</th>
            <th scope="col">Рекомендуемое действие</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </section>`;
}

function renderIssues(issues: IResultIssue[], sectionTitle?: string, reference: 'file' | 'package' = 'file'): string {
  if (issues.length === 0) {
    return '';
  }
  const total = issues.length;
  const sliced = issues.slice(0, MAX_LIST_ITEMS);

  const rows = sliced.map((issue) => {
    const sev = issue.severity || 'info';
    const sourceFile = issue.source && 'file' in issue.source ? issue.source.file : undefined;
    const line = issue.source && 'position' in issue.source && issue.source.position ? `:${issue.source.position.startLine}` : '';
    const location = reference === 'package' ? issue.package : sourceFile ? `${sourceFile}${line}` : undefined;
    return `
      <tr>
        <td><span class="badge badge-${sev === 'error' ? 'fix' : sev === 'warning' ? 'plan' : 'no-data'}">${sev === 'error' ? 'Ошибка' : sev === 'warning' ? 'Предупреждение' : 'Сведения'}</span></td>
        <td class="code-path">${escapeHtml(location ?? '—')}</td>
        <td>${escapeHtml(issue.message)}</td>
      </tr>`;
  }).join('');

  const limitNote = total >= MAX_LIST_ITEMS
    ? `<div class="limit-note">${total > MAX_LIST_ITEMS ? `Показано ${MAX_LIST_ITEMS} из ${total} находок. ` : ''}Полный список аудитов и находок в report.json.</div>`
    : '';

  const table = `
      <div class="table-wrapper"${sectionTitle ? ` role="region" aria-label="Находки: ${escapeHtml(sectionTitle)}" tabindex="0"` : ''}>
        <table${sectionTitle ? ' class="summary-table"' : ''}>
          <thead>
            <tr>
              <th scope="col">Уровень</th>
              <th scope="col">${reference === 'package' ? 'Пакет' : 'Файл'}</th>
              <th scope="col">Сообщение</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      ${limitNote}`;

  return sectionTitle ? table : `
  <details>
    <summary>Находки (${total})</summary>
    <div class="details-content">${table}</div>
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
      <td style="text-align: right;">${escapeHtml(r.count)}</td>
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

const checkSources: Record<IResultCheck['id'], string> = {
  outdated: 'npm outdated', audit: 'npm audit', knip: 'knip', lint: 'ESLint', prettier: 'Prettier',
  coverage: 'LCOV', tests: 'Jest / Vitest', 'node-version': '.nvmrc / engines.node, nodejs.org', 'build-size': 'Каталог сборки',
};

const indicatorChecks = {
  outdated: ['outdated'], audit: ['audit'], coverage: ['coverage', 'tests'], codeQuality: ['lint', 'prettier'],
  nodeVersion: ['node-version'], unusedCode: ['knip'], buildSize: ['build-size'],
} as const satisfies Record<IResultIndicator['id'], readonly IResultCheck['id'][]>;

type Fact = [label: string, value: string | number | undefined];
type NumericFact = number | undefined;

function asNumber(value: unknown): NumericFact {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sumKnown(...values: NumericFact[]): NumericFact {
  const known = values.filter((n) => n !== undefined);
  return known.length > 0 ? known.reduce((sum, n) => sum + n, 0) : undefined;
}

function formatPercent(n: NumericFact): string | undefined {
  return n === undefined ? undefined : `${decimals.format(n)}%`;
}

function renderMetrics(facts: readonly Fact[], tiles = false): string {
  const entries = facts.filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return '';
  }
  const classes = tiles ? `metric-tiles${entries.length === 4 ? ' two-columns' : ''}` : 'metric-rows';
  return `<dl class="${classes}">${entries.map(([label, value]) =>
    `<div${tiles ? ' class="metric-tile"' : ''}><dt>${escapeHtml(label)}</dt><dd class="number">${escapeHtml(typeof value === 'number' ? decimals.format(value) : value)}</dd></div>`,
  ).join('')}</dl>`;
}

function testFacts(facts?: IResultCheck['facts']): Fact[] {
  return [
    ['Тестов пройдено', asNumber(facts?.passed)], ['Тестов с ошибкой', asNumber(facts?.failed)],
    ['Тестов пропущено', asNumber(facts?.skipped)], ['Файлов тестов с ошибкой', asNumber(facts?.failedSuites)],
  ];
}

function indicatorMetrics(indicator: IResultIndicator): {
  value?: string | number;
  tiles?: Fact[];
  rows?: Fact[];
  scale?: string;
} {
  const check = (id: IResultCheck['id']) => indicator.checks.find((item) => item.id === id);
  const primary = check(indicatorChecks[indicator.id][0]);
  const first = primary?.facts ?? {};
  const n = (key: string) => asNumber(first[key]);
  switch (indicator.id) {
    case 'outdated':
      return {
        value: sumKnown(n('production'), n('development')),
        tiles: [['Мажорных', n('major')], ['Минорных', n('minor')], ['Патчевых', n('patch')]],
        rows: [
          ['Сопоставимых зависимостей', sumKnown(n('productionComparable'), n('developmentComparable'))],
          ['Отстаёт в dependencies', formatPercent(n('productionOutdatedPercent'))],
          ['Отстаёт в devDependencies', formatPercent(n('developmentOutdatedPercent'))],
        ],
      };
    case 'audit':
      return {
        value: sumKnown(n('production'), n('development')),
        tiles: [['Критических', n('critical')], ['Высоких', n('high')], ['Средних', n('moderate')], ['Низких', n('low')]],
        rows: [['Информационных', n('info')]],
      };
    case 'coverage': {
      const lines = n('lines');
      return {
        value: formatPercent(lines),
        tiles: [['Ветви', formatPercent(n('branches'))], ['Функции', formatPercent(n('functions'))]],
        scale: lines === undefined ? '' : renderMeter('Покрытие строк', lines, {
          warn: n('warn'), target: n('target'), status: primary?.status,
        }),
        rows: [
          ...testFacts(check('tests')?.facts),
          ['LCOV обновлён', typeof first.reportDate === 'string' ? formatDateTime(first.reportDate) : undefined],
        ],
      };
    }
    case 'codeQuality': {
      const prettier = check('prettier')?.facts;
      return {
        value: sumKnown(n('errors'), n('warnings')),
        tiles: [['Ошибок', n('errors')], ['Предупреждений', n('warnings')]],
        rows: [
          ['Проверено файлов ESLint', n('checkedFiles')], ['Ошибок разбора ESLint', n('parseErrors')],
          ['Проверено файлов Prettier', asNumber(prettier?.checkedFiles)],
          ['Файлов не по формату', asNumber(prettier?.unformatted)],
          ['Ошибок разбора Prettier', asNumber(prettier?.parseErrors)],
        ],
      };
    }
    case 'nodeVersion':
      return {
        value: typeof first.version === 'string' ? first.version : undefined,
        rows: [['Последняя LTS', typeof first.latestLts === 'string' ? first.latestLts : undefined]],
      };
    case 'unusedCode':
      return {
        value: sumKnown(n('files'), n('exports'), n('dependencies'), n('types'), n('otherFindings')),
        tiles: [['Файлов', n('files')], ['Экспортов', n('exports')], ['Зависимостей', n('dependencies')]],
        rows: [['Типов', n('types')], ['Других находок', n('otherFindings')]],
      };
    case 'buildSize': {
      const size = n('sizeBytes');
      const limit = n('limitBytes');
      const largest = check('build-size')?.details?.largestFiles?.[0];
      return {
        value: size === undefined ? undefined : formatBytes(size),
        rows: [['Файлов в сборке', n('files')], ['Самый большой', largest ? `${largest.file}, ${formatBytes(largest.bytes)}` : undefined],
          ['Предел из конфига', limit === undefined ? undefined : formatBytes(limit)]],
      };
    }
  }
}

function renderStatus(status: IResultCheck['status']): string {
  return `<span class="badge badge-${escapeHtml(status)}">${renderStatusIcon(status)}${STATUS_LABELS[status]}</span>`;
}

const findingsSectionIds: Partial<Record<IResultCheck['id'], string>> = {
  outdated: 'outdated-findings',
  audit: 'audit-findings',
  lint: 'eslint-findings',
  prettier: 'prettier-findings',
  coverage: 'coverage-findings',
  tests: 'test-findings',
};

function renderCheckProblem({ id, status, reason, action, code, logFile, incomplete }: IResultCheck): string {
  const showReason = (status === 'no-data' || status === 'disabled' || incomplete) && reason;
  if (!showReason) {
    return '';
  }
  const diagnosis = logFile
    ? `<div class="check-diagnostic"><code>${escapeHtml(checkSources[id])} · ${escapeHtml(code)}</code><span>Журнал: <code>${escapeHtml(logFile)}</code></span></div>`
    : '';
  return `<div class="callout"><p class="callout-title">${escapeHtml(reason)}</p>${action ? `<p class="callout-action">${escapeHtml(action)}</p>` : ''}</div>${diagnosis}`;
}

function renderCheck(check: IResultCheck, showStatus: boolean, showFindingsSections: boolean): string {
  const { id, status, details } = check;
  const sectionId = showFindingsSections ? findingsSectionIds[id] : undefined;
  const body = renderCheckProblem(check);
  const detail = [
    sectionId === undefined && details?.issues ? renderIssues(details.issues) : '',
    details?.largestFiles ? renderLargestFiles(details.largestFiles) : '',
    sectionId === undefined && details?.rules ? renderRules(details.rules) : '',
  ].join('');
  const link = sectionId
    ? `<p><a href="#${sectionId}">Подробности (${escapeHtml(checkSources[id])})</a></p>`
    : '';
  if (!showStatus && body === '' && detail === '' && link === '') {
    return '';
  }
  const heading = showStatus
    ? `<div class="check-header"><span class="check-title">${escapeHtml(CHECK_TITLES[id])}</span>${renderStatus(status)}</div>`
    : '';
  return `<div class="check-item">${heading}${body}${detail}${link}</div>`;
}

function renderCoverageFacts(check: IResultCheck): string {
  if (check.id === 'tests') {
    return renderMetrics(testFacts(check.facts), true);
  }
  if (check.id === 'coverage') {
    return renderMetrics([
      ['Покрытие строк', formatPercent(asNumber(check.facts.lines))],
      ['Покрытие ветвей', formatPercent(asNumber(check.facts.branches))],
      ['Покрытие функций', formatPercent(asNumber(check.facts.functions))],
    ], true);
  }
  return '';
}

function renderCoverageFindings(check: IResultCheck, indicator: IResultIndicator): string {
  if (check.id !== 'coverage' && check.id !== 'tests') {
    return '';
  }
  const findings = indicator.findings.filter(({ kind }) => kind.startsWith(`${check.id}.`));
  if (findings.length === 0) {
    return '';
  }
  const rows = findings.map(({ kind, importance, now, target }) => `
    <tr>
      <td><span class="badge badge-importance-${escapeHtml(importance)}">${escapeHtml(IMPORTANCE_LABELS[importance])}</span></td>
      <td><strong>${escapeHtml(recommendationTitles[kind] ?? CHECK_TITLES[check.id])}</strong></td>
      <td class="cell-now"><code>${escapeHtml(now)}</code></td>
      <td class="cell-target"><code>${escapeHtml(target)}</code></td>
    </tr>`).join('');
  return `<div class="table-wrapper" role="region" aria-label="Отклонения: ${escapeHtml(CHECK_TITLES[check.id])}" tabindex="0">
    <table class="summary-table">
      <thead><tr><th scope="col">Важность</th><th scope="col">Показатель</th><th scope="col" class="column-number">Сейчас</th><th scope="col" class="column-number">Цель</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderFindingsSections({ indicators }: FrontisResult): string {
  return indicators.flatMap((indicator) => indicator.checks.map((check) => {
    const { id } = check;
    const sectionId = findingsSectionIds[id];
    if (sectionId === undefined) {
      return '';
    }
    const title = CHECK_TITLES[id];
    const problem = renderCheckProblem(check);
    const isDependencyCheck = id === 'audit' || id === 'outdated';
    const issues = renderIssues(check.details?.issues ?? [], title, isDependencyCheck ? 'package' : 'file');
    const metrics = renderCoverageFacts(check);
    const findings = renderCoverageFindings(check, indicator);
    const rules = renderRules(check.details?.rules ?? []);
    const empty = check.status === 'no-data' || check.status === 'disabled' ? 'Данные о находках недоступны.' : 'Находок нет.';
    return `<section class="section" id="${sectionId}" aria-labelledby="${sectionId}-title">
      <div class="section-heading">
        <h2 class="section-title" id="${sectionId}-title">${escapeHtml(title)}</h2>
        ${renderStatus(check.status)}
      </div>
      <div class="findings-body">
        ${problem}
        ${metrics}
        ${findings}
        ${issues}
        ${findings === '' && issues === '' && problem === '' ? `<p class="empty-state">${empty}</p>` : ''}
        ${rules}
      </div>
    </section>`;
  })).join('');
}

function renderIndicators(indicators: readonly IResultIndicator[], options: GenerateReportOptions): string {
  if (indicators.length === 0) {
    return '';
  }
  const cards = Object.keys(indicatorChecks).flatMap((id) => {
    const indicator = indicators.find((item) => item.id === id);
    if (indicator === undefined) {
      return [];
    }
    const { status, checks, incomplete } = indicator;
    const metrics = status === 'no-data' ? {} : indicatorMetrics(indicator);
    const active = checks.filter((check) => check.status !== 'disabled');
    const duration = sumKnown(...active.map((check) => options.durations?.get(check.id)));
    const sources = active.map((check) => check.id === 'build-size' ? options.buildDir ?? checkSources[check.id] : checkSources[check.id]);
    const elapsed = formatDuration(duration);
    const checksHtml = checks.map((check) => renderCheck(check, checks.length > 1, options.result !== undefined)).join('');
    const fallback = status === 'no-data' && checksHtml === '' && indicator.reason
      ? `<div class="callout"><p>${escapeHtml(indicator.reason)}</p><p class="callout-action">${escapeHtml(indicator.action)}</p></div>`
      : '';

    return [`<article class="indicator-card status-${escapeHtml(status)}" id="indicator-${escapeHtml(id)}">
      <div class="indicator-badges">${renderStatus(status)}${incomplete ? '<span class="badge badge-incomplete">Неполные данные</span>' : ''}</div>
      <div class="indicator-header">
        <h3 class="indicator-title">${escapeHtml(INDICATOR_TITLES[indicator.id])}</h3>
        ${metrics.value === undefined ? '' : `<span class="indicator-value number">${escapeHtml(typeof metrics.value === 'number' ? decimals.format(metrics.value) : metrics.value)}</span>`}
      </div>
      <div class="indicator-body">
        ${metrics.scale ?? ''}
        ${renderMetrics(metrics.tiles ?? [], true)}
        ${renderMetrics(metrics.rows ?? [])}
        ${fallback}
        ${checksHtml === '' ? '' : `<div class="checks-list">${checksHtml}</div>`}
      </div>
      <footer class="card-footer">${sources.length > 0 ? `<code>${escapeHtml(sources.join(', '))}</code>` : '<span>Проверки не запущены</span>'}${elapsed ? `<span>${escapeHtml(elapsed)}</span>` : ''}</footer>
    </article>`];
  }).join('');

  return `<section class="instrument-section" id="indicators">
    <div class="section-heading"><h2 class="section-title">Инструменты</h2></div>
    <div class="indicators-list">${cards}</div>
  </section>`;
}

function renderImportMap(map: FrontisResult['importMap']): string {
  if (map === undefined) {
    return '';
  }
  let content: string;
  if (map.status === 'no-data') {
    content = `<div class="callout">
      <p class="callout-title">${escapeHtml(map.reason)}</p>
      <p class="callout-action">${escapeHtml(map.action)}</p>
    </div>`;
  } else if (map.packages.length === 0) {
    content = '<p class="empty-state">Отстающих пакетов нет.</p>';
  } else {
    const rows = map.packages.map(({ name, current, latest, imports }) => {
      const locations = imports.slice(0, MAX_LIST_ITEMS).map(({ file, line, specifier }) =>
        `<li><code>${escapeHtml(file)}:${escapeHtml(line)}</code> <code class="import-specifier">${escapeHtml(specifier)}</code></li>`,
      ).join('');
      const more = imports.length > MAX_LIST_ITEMS
        ? `<p class="limit-note">Показано ${MAX_LIST_ITEMS} из ${imports.length}. Полный список в <code>result.json</code>.</p>`
        : '';
      return `<tr>
        <td><strong><code>${escapeHtml(name)}</code></strong></td>
        <td class="cell-now"><code>${escapeHtml(current)}</code></td>
        <td class="cell-target"><code>${escapeHtml(latest)}</code></td>
        <td>${locations === '' ? '<span class="empty-state">Импорты не найдены.</span>' : `<details>
          <summary aria-label="Импорты ${escapeHtml(name)}: ${imports.length}">Найдено: ${imports.length}</summary>
          <div class="details-content"><ul>${locations}</ul>${more}</div>
        </details>`}</td>
      </tr>`;
    }).join('');
    content = `<div class="table-wrapper" role="region" aria-label="Таблица импортов отстающих пакетов" tabindex="0">
      <table class="summary-table">
        <thead>
          <tr><th scope="col">Пакет</th><th scope="col" class="column-number">Сейчас</th><th scope="col" class="column-number">Доступно</th><th scope="col">Импорты</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  return `<section class="section" id="import-map" aria-labelledby="import-map-title">
    <div class="section-heading">
      <h2 class="section-title" id="import-map-title">Места использования отстающих пакетов</h2>
      ${map.status === 'no-data' ? renderStatus('no-data') : ''}
    </div>
    ${content}
  </section>`;
}

function diagnosticIndicators(noData: readonly PluginNoData[]): IResultIndicator[] {
  return (Object.entries(indicatorChecks) as [IResultIndicator['id'], readonly IResultCheck['id'][]][]).flatMap(([id, ids]) => {
    const checks = ids.flatMap((checkId): IResultCheck[] => {
      const problem = noData.find(({ plugin }) => plugin === checkId);
      return problem ? [{ ...problem, id: checkId, status: problem.code === 'disabled' ? 'disabled' : 'no-data', audits: [], facts: {} }] : [];
    });
    if (checks.length === 0 || ((id === 'nodeVersion' || id === 'buildSize') && checks.every(({ status }) => status === 'disabled'))) {
      return [];
    }
    return [{ id, status: 'no-data', audits: [], findings: [], checks }];
  });
}

function renderDiagnostics(noData: readonly PluginNoData[]): string {
  const rows = noData.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.plugin)}</strong></td>
      <td><code>${escapeHtml(item.code)}</code></td>
      <td>${escapeHtml(item.reason)}</td>
      <td>${escapeHtml(item.action)}</td>
      <td>${item.logFile ? `<code>${escapeHtml(item.logFile)}</code>` : '—'}</td>
    </tr>
  `).join('');
  return `<section class="section">
    <div class="section-heading"><h2 class="section-title">Причины отсутствия данных по модулям</h2></div>
    ${rows === '' ? '<p class="empty-state">Нет сведений о причинах отсутствия данных.</p>' : `
    <div class="table-wrapper" role="region" aria-label="Таблица диагностики" tabindex="0">
      <table class="summary-table">
        <thead><tr><th scope="col">Плагин</th><th scope="col">Код</th><th scope="col">Причина</th><th scope="col">Действие</th><th scope="col">Журнал</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`}
  </section>`;
}

function renderFooter(version: string, engineVersion: string, duration?: number): string {
  const elapsed = formatDuration(duration);
  return `<footer class="report-footer">
    <div><strong>Frontis</strong><span>Версия ${escapeHtml(version)} · Code PushUp ${escapeHtml(engineVersion)}${elapsed ? ` · Общее время ${elapsed}` : ''}</span></div>
    <a href="https://github.com/danilbiriukov/Frontis#readme">Документация на GitHub</a>
  </footer>`;
}

export function generateHtmlReport(options: GenerateReportOptions): string {
  const { result } = options;
  const project = result?.project ?? options.project ?? {};
  const runAt = result?.runAt ?? options.runAt ?? new Date().toISOString();
  const duration = result?.durationMs ?? options.durationMs;
  const version = result?.tool.version ?? frontisVersion();
  const engineVersion = result?.report.codePushUpVersion ?? options.report?.version ?? codePushUpPackage().version;
  const noData = options.noData ?? [];
  const indicators = result?.indicators ?? diagnosticIndicators(noData);
  const score = result?.score ?? { value: null, zone: null, known: 0, total: indicators.length };
  const title = result ? project.name || 'Аудит проекта' : 'Диагностический отчёт';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="only light">
  <title>Frontis: ${escapeHtml(title)}</title>
  <style>${REPORT_STYLES}</style>
</head>
<body>
  <div class="container">
    ${renderHeader(project, runAt)}
    <main>
      ${result ? '' : '<p class="diagnostic-notice">Диагностический отчёт. Проверки не дали пригодных аудитов.</p>'}
      ${renderScoreAndCounters(score, indicators)}
      ${result ? renderRecommendations(result) + renderNoDataTable(result.indicators) : renderDiagnostics(noData)}
      ${renderIndicators(indicators, options)}
      ${result ? renderFindingsSections(result) : ''}
      ${renderImportMap(result?.importMap)}
    </main>
    ${renderFooter(version, engineVersion, duration)}
  </div>
</body>
</html>`;
}
