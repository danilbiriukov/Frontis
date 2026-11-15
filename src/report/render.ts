import type { Report } from '@code-pushup/models';
import { compareIssueSeverity, ISSUE_SEVERITIES, issueSeverity } from '../core/issue-severity.js';
import { codePushUpPackage, frontisVersion } from '../core/package-info.js';
import type { PluginNoData } from '../core/plugin-guard.js';
import { formatLineCoverage } from '../core/rules.js';
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
const morePrecise = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, useGrouping: 'always' });

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

function formatBytes(bytes: number, numberFormat = decimals): string {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  if (bytes < 1024 * 1024) {
    return `${numberFormat.format(bytes / 1024)} КБ`;
  }
  return `${numberFormat.format(bytes / (1024 * 1024))} МБ`;
}

function formatBuildSize(size?: number, limit?: number): [string | undefined, string | undefined] {
  const value = size === undefined ? undefined : formatBytes(size);
  const threshold = limit === undefined ? undefined : formatBytes(limit);
  if (size === undefined || limit === undefined || size === limit || value !== threshold) {
    return [value, threshold];
  }
  const preciseValue = formatBytes(size, morePrecise);
  const preciseThreshold = formatBytes(limit, morePrecise);
  return preciseValue === preciseThreshold
    ? [`${decimals.format(size)} Б`, `${decimals.format(limit)} Б`]
    : [preciseValue, preciseThreshold];
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

function renderIcon(paths: string): string {
  return `<svg class="status-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function renderStatusIcon(status: IResultCheck['status']): string {
  return renderIcon(STATUS_ICONS[status]);
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

function collectNoDataItems(indicators: readonly IResultIndicator[]): NoDataItem[] {
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

function renderNoDataSection(indicators: readonly IResultIndicator[]): string {
  const items = collectNoDataItems(indicators);
  if (items.length === 0) {
    return '';
  }
  const blocks = items.map(({ name, reason, action }) => `<li class="callout">
    <h3 class="availability-item-title">${escapeHtml(name)}</h3>
    <p>${escapeHtml(reason)}</p>
    ${action ? `<p class="callout-action">${escapeHtml(action)}</p>` : ''}
  </li>`).join('');
  return `<section class="section" id="no-data-reasons" aria-labelledby="no-data-title">
    <div class="section-heading"><h2 class="section-title" id="no-data-title">Показатели без данных</h2></div>
    <ul class="availability-list" role="list">${blocks}</ul>
  </section>`;
}

const issueLevels = {
  error: { label: 'Ошибка', filter: 'Ошибки', tone: 'fix', icon: STATUS_ICONS.fix },
  warning: { label: 'Предупреждение', filter: 'Предупреждения', tone: 'plan', icon: STATUS_ICONS.plan },
  info: { label: 'Информация', filter: 'Информация', tone: 'no-data', icon: '<circle cx="8" cy="8" r="5.6"/><path d="M8 7.5V11m0-6V5.2"/>' },
} as const;

function renderIssueFilter(sectionId: string): string {
  const name = `${sectionId}-severity`;
  const options = ISSUE_SEVERITIES.map((severity) =>
    `<label><input type="radio" name="${name}" value="${severity}"><span>${issueLevels[severity].filter}</span></label>`,
  ).join('');
  return `<fieldset class="issue-filter" aria-label="Фильтр по уровню">
    <label><input type="radio" name="${name}" value="all" checked><span>Все</span></label>
    ${options}
  </fieldset>`;
}

function renderIssues(issues: IResultIssue[], sectionId?: string, reference: 'file' | 'package' = 'file'): string {
  if (issues.length === 0) {
    return '';
  }
  const total = issues.length;
  const sliced = [...issues].sort(compareIssueSeverity).slice(0, MAX_LIST_ITEMS);

  const rows = sliced.map((issue) => {
    const severity = issueSeverity(issue);
    const level = issueLevels[severity];
    const sourceFile = issue.source && 'file' in issue.source ? issue.source.file : undefined;
    const line = issue.source && 'position' in issue.source && issue.source.position ? `:${issue.source.position.startLine}` : '';
    const location = reference === 'package' ? issue.package : sourceFile ? `${sourceFile}${line}` : undefined;
    return `<li class="finding-item status-${level.tone}" data-severity="${severity}">
      <span class="finding-icon" role="img" aria-label="${level.label}" title="${level.label}">${renderIcon(level.icon)}</span>
      <div class="finding-content">
        ${location ? `<code class="finding-location">${escapeHtml(location)}</code>` : ''}
        <p class="finding-message">${escapeHtml(issue.message)}</p>
      </div>
    </li>`;
  }).join('');

  const limitNote = total >= MAX_LIST_ITEMS
    ? `<div class="limit-note">${total > MAX_LIST_ITEMS ? `В разделе ${MAX_LIST_ITEMS} из ${total} находок. ` : ''}${sectionId === undefined ? '' : 'Фильтр действует только на список в HTML. '}Полный список аудитов и находок в report.json.</div>`
    : '';

  const list = `<ul class="finding-list" role="list">${rows}</ul>`;
  if (sectionId !== undefined) {
    return `<div class="issue-panel">
      ${renderIssueFilter(sectionId)}
      ${list}
      <p class="filter-empty empty-state">В списке HTML нет находок выбранного уровня.</p>
      ${limitNote}
    </div>`;
  }
  return `
  <details>
    <summary>Находки (${total})</summary>
    <div class="details-content">${list}${limitNote}</div>
  </details>`;
}

function renderLargestFiles(files: { file: string; bytes: number }[]): string {
  if (files.length === 0) {
    return '';
  }
  const facts: Fact[] = files.slice(0, MAX_LIST_ITEMS).map(({ file, bytes }) => [file, formatBytes(bytes)]);
  return `<div class="largest-files">
    <h4 class="largest-files-title">Крупнейшие файлы (${facts.length})</h4>
    ${renderMetrics(facts)}
  </div>`;
}

function renderRules(rules: { rule: string; count: number }[]): string {
  if (rules.length === 0) {
    return '';
  }
  const facts: Fact[] = rules.slice(0, MAX_LIST_ITEMS).map(({ rule, count }) => [rule, count]);
  return `<details>
    <summary>Наиболее частые правила (${rules.length})</summary>
    <div class="details-content rule-counts">${renderMetrics(facts)}</div>
  </details>`;
}

const checkSources: Record<IResultCheck['id'], string> = {
  outdated: 'npm outdated', audit: 'npm audit', knip: 'knip', lint: 'ESLint', prettier: 'Prettier',
  coverage: 'LCOV', tests: 'Jest / Vitest', 'node-version': '.nvmrc / .node-version / engines.node, nodejs.org', 'build-size': 'Каталог сборки',
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
        rows: [
          ['Критических', n('critical')], ['Высоких', n('high')], ['Средних', n('moderate')],
          ['Низких', n('low')], ['Информационных', n('info')],
        ],
      };
    case 'coverage': {
      const lines = n('lines');
      const formattedLines = lines === undefined ? undefined : formatLineCoverage(lines);
      return {
        value: formattedLines,
        tiles: [['Строки', formattedLines], ['Ветви', formatPercent(n('branches'))], ['Функции', formatPercent(n('functions'))]],
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
        rows: [
          ['Файлов', n('files')], ['Экспортов', n('exports')], ['Зависимостей', n('dependencies')],
          ['Типов', n('types')], ['Других находок', n('otherFindings')],
        ],
      };
    case 'buildSize': {
      const [value, limit] = formatBuildSize(n('sizeBytes'), n('limitBytes'));
      return {
        value,
        rows: [['Файлов в сборке', n('files')], ['Предел из конфига', limit]],
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
  knip: 'knip-findings',
  lint: 'eslint-findings',
  prettier: 'prettier-findings',
  coverage: 'coverage-findings',
  tests: 'test-findings',
};
const checkDescriptions: Partial<Record<IResultCheck['id'], string>> = {
  outdated: 'Проверяет версии зависимостей.',
  audit: 'Ищет уязвимости в зависимостях.',
  knip: 'Ищет неиспользуемый код и зависимости.',
  lint: 'Проверяет код по правилам проекта.',
  prettier: 'Проверяет форматирование файлов.',
  coverage: 'Измеряет покрытие кода тестами.',
  tests: 'Показывает сбои и пропуски тестов.',
};
const checksWithOwnSections = new Set<IResultCheck['id']>(['coverage', 'tests', 'lint', 'prettier']);

function renderDetailsLink(id: IResultCheck['id']): string {
  const sectionId = findingsSectionIds[id];
  if (sectionId === undefined || id === 'coverage' || id === 'tests') {
    return '';
  }
  return `<a class="details-link" href="#${sectionId}">Подробности (${escapeHtml(checkSources[id])})</a>`;
}

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

function renderCheck(check: IResultCheck): string {
  const { id, details } = check;
  if (checksWithOwnSections.has(id)) {
    return '';
  }
  const sectionId = findingsSectionIds[id];
  const body = renderCheckProblem(check);
  const detail = [
    sectionId === undefined && details?.issues ? renderIssues(details.issues) : '',
    details?.largestFiles ? renderLargestFiles(details.largestFiles) : '',
    sectionId === undefined && details?.rules ? renderRules(details.rules) : '',
  ].join('');
  if (body === '' && detail === '') {
    return '';
  }
  return `<div class="check-item">${body}${detail}</div>`;
}

function coverageDeviations(check: IResultCheck, indicator: IResultIndicator): IResultIssue[] {
  if (check.id !== 'coverage' && check.id !== 'tests') {
    return [];
  }
  const severity = { high: 'error', mid: 'warning', low: 'info' } as const;
  return indicator.findings.filter(({ kind }) => kind.startsWith(`${check.id}.`)).map(({ kind, importance, now, target }) => ({
    audit: kind,
    severity: severity[importance],
    message: `${recommendationTitles[kind] ?? CHECK_TITLES[check.id]}. Сейчас ${now}, цель ${target}.`,
  }));
}

function renderFindingsSection(indicator: IResultIndicator, check: IResultCheck): string {
  const { id } = check;
  const sectionId = findingsSectionIds[id];
  if (sectionId === undefined) {
    return '';
  }
  const title = CHECK_TITLES[id];
  const description = checkDescriptions[id];
  const problem = renderCheckProblem(check);
  const isDependencyCheck = id === 'audit' || id === 'outdated';
  const entries = [...(check.details?.issues ?? []), ...coverageDeviations(check, indicator)];
  const issues = renderIssues(entries, sectionId, isDependencyCheck ? 'package' : 'file');
  const rules = renderRules(check.details?.rules ?? []);
  const empty = check.status === 'no-data' || check.status === 'disabled' ? 'Данные о находках недоступны.' : 'Находок нет.';
  return `<section class="section" id="${sectionId}" aria-labelledby="${sectionId}-title">
    <header class="findings-heading">
      <h2 class="section-title" id="${sectionId}-title">${escapeHtml(title)}</h2>
      ${description === undefined ? '' : `<p class="tool-description">${escapeHtml(description)}</p>`}
    </header>
    <div class="findings-body">
      ${problem}
      ${issues}
      ${issues === '' && problem === '' ? `<p class="empty-state">${empty}</p>` : ''}
      ${rules}
    </div>
  </section>`;
}

function renderFindingsSections(indicators: readonly IResultIndicator[]): string {
  return indicators.flatMap((indicator) => indicator.checks.map((check) => renderFindingsSection(indicator, check)))
    .join('');
}

function renderIndicatorCard(indicator: IResultIndicator, options: GenerateReportOptions, standalone = false): string {
  const { id, status, checks, incomplete } = indicator;
  const metrics = status === 'no-data' ? {} : indicatorMetrics(indicator);
  const active = checks.filter((check) => check.status !== 'disabled');
  const duration = sumKnown(...active.map((check) => options.durations?.get(check.id)));
  const sources = active.map((check) => check.id === 'build-size' ? options.buildDir ?? checkSources[check.id] : checkSources[check.id]);
  const elapsed = formatDuration(duration);
  const checksHtml = checks.map(renderCheck).join('');
  const detailsLinks = checks.map(({ id: checkId }) => renderDetailsLink(checkId)).join('');
  const fallback = status === 'no-data' && checksHtml === '' && indicator.reason
    ? `<div class="callout"><p>${escapeHtml(indicator.reason)}</p><p class="callout-action">${escapeHtml(indicator.action)}</p></div>`
    : '';
  const tag = standalone ? 'section' : 'article';
  const titleTag = standalone ? 'h2' : 'h3';
  const titleClass = standalone ? 'section-title' : 'indicator-title';
  return `<${tag} class="${standalone ? 'section ' : ''}indicator-card status-${escapeHtml(status)}" id="indicator-${escapeHtml(id)}">
      <div class="indicator-header">
        <${titleTag} class="${titleClass}">${escapeHtml(INDICATOR_TITLES[id])}</${titleTag}>
        ${metrics.value === undefined ? '' : `<span class="indicator-value number">${escapeHtml(typeof metrics.value === 'number' ? decimals.format(metrics.value) : metrics.value)}</span>`}
      </div>
      ${incomplete ? '<span class="badge badge-incomplete indicator-incomplete">Неполные данные</span>' : ''}
      <div class="indicator-body">
        ${metrics.scale ?? ''}
        ${renderMetrics(metrics.tiles ?? [], true)}
        ${renderMetrics(metrics.rows ?? [])}
        ${fallback}
        ${checksHtml === '' ? '' : `<div class="checks-list">${checksHtml}</div>`}
      </div>
      ${detailsLinks ? `<footer class="card-footer card-actions">${detailsLinks}</footer>` :
        `<footer class="card-footer">${sources.length > 0 ? `<code>${escapeHtml(sources.join(', '))}</code>` : '<span>Проверки не запущены</span>'}${elapsed ? `<span>${escapeHtml(elapsed)}</span>` : ''}</footer>`}
    </${tag}>`;
}

function renderOverviewDetails(indicators: readonly IResultIndicator[], options: GenerateReportOptions): string {
  const build = indicators.find(({ id }) => id === 'buildSize');
  const missing = options.result === undefined ? '' : renderNoDataSection(indicators);
  if (build === undefined && missing === '') {
    return '';
  }
  return `<div class="overview-details">
    ${missing}
    ${build === undefined ? '' : renderIndicatorCard(build, options, true)}
  </div>`;
}

function renderIndicators(indicators: readonly IResultIndicator[], options: GenerateReportOptions): string {
  const cards = Object.keys(indicatorChecks).filter((id) => id !== 'buildSize').map((id) => {
    const indicator = indicators.find((item) => item.id === id);
    return indicator === undefined ? '' : renderIndicatorCard(indicator, options);
  }).join('');
  if (cards === '') {
    return '';
  }
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
        <td>${locations === '' ? '<span class="empty-state">Импорты не найдены.</span>' : `<ul class="import-locations">${locations}</ul>${more}`}</td>
      </tr>`;
    }).join('');
    content = `<div class="table-wrapper" role="region" aria-label="Таблица импортов отстающих пакетов" tabindex="0">
      <table class="summary-table import-map-table">
        <colgroup>
          <col class="import-package-column">
          <col class="import-version-column">
          <col class="import-version-column">
          <col>
        </colgroup>
        <thead>
          <tr><th scope="col">Пакет</th><th scope="col" class="column-number">Сейчас</th><th scope="col" class="column-number">Новая версия</th><th scope="col">Импорты</th></tr>
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
  const knip = indicators.find(({ id }) => id === 'unusedCode');
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
      ${result ? renderRecommendations(result) : renderDiagnostics(noData)}
      ${renderIndicators(indicators, options)}
      ${renderFindingsSections(indicators.filter(({ id }) => id !== 'unusedCode'))}
      ${renderImportMap(result?.importMap)}
      ${knip === undefined ? '' : renderFindingsSections([knip])}
      ${renderOverviewDetails(indicators, options)}
    </main>
    ${renderFooter(version, engineVersion, duration)}
  </div>
</body>
</html>`;
}
