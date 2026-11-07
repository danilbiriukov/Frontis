import type { AuditReport, Report } from '@code-pushup/models';
import semver from 'semver';
import { ESLINT_CHECKED_FILES, ESLINT_PARSE_ERRORS } from '../plugins/eslint-evidence.js';
import type { ModuleName, Thresholds } from './config.js';
import type { Finding } from './importance.js';
import type { PluginProblem } from './plugin-guard.js';
import { buildRecommendations } from './recommendations.js';
import {
  auditFindings,
  buildSizeFindings,
  coverageFindings,
  lintFindings,
  nodeFindings,
  outdatedFindings,
  unusedCodeFindings,
} from './rules.js';
import { projectScore } from './score.js';
import { resolveStatus } from './status.js';
import type {
  FrontisResult,
  ICheckEvidence,
  IResultCheck,
  IResultContext,
  IResultIndicator,
  IResultIssue,
  TCheckId,
  TIndicatorId,
  TResultFact,
} from './types/result.js';

export type { FrontisResult } from './types/result.js';

const indicatorByModule: Record<Exclude<ModuleName, 'project-info'>, TIndicatorId> = {
  outdated: 'outdated',
  audit: 'audit',
  knip: 'unusedCode',
  lint: 'codeQuality',
  prettier: 'codeQuality',
  coverage: 'coverage',
  'node-version': 'nodeVersion',
  'build-size': 'buildSize',
};

const disabled: PluginProblem = {
  code: 'disabled',
  reason: 'Модуль отключён в конфигурации.',
  action: 'Включите модуль в frontis.config, если нужна эта проверка.',
};
const missingAudit: PluginProblem = {
  code: 'missing-audit',
  reason: 'В отчёте Code PushUp не хватает аудитов для проверки.',
  action: 'Проверьте настройки инструмента и повторите запуск.',
};
const invalidAudit: PluginProblem = {
  code: 'invalid-audit-value',
  reason: 'Аудит Code PushUp содержит непригодные для оценки данные.',
  action: 'Проверьте версию и настройки плагина Code PushUp.',
};

const npmAuditSlugs = ['npm-audit-prod', 'npm-audit-dev'];
const outdatedSlugs = ['npm-outdated-prod', 'npm-outdated-dev'];
const coverageSlugs = ['line-coverage', 'branch-coverage', 'function-coverage'];
const knipSlugs = ['unused-files', 'unused-dependencies', 'unused-exports', 'unused-types', 'other-findings'];
const prettierSlugs = ['checked-files', 'unformatted-files', 'parse-errors'];
const nodeSlugs = ['project-version', 'latest-lts', 'version-lag'];
const buildSlugs = ['size-bytes', 'file-count', 'limit-bytes'];

function selectAudits(report: Report, plugin: string, slugs?: readonly string[]): AuditReport[] {
  const audits = report.plugins.find(({ slug }) => slug === plugin)?.audits ?? [];
  return audits.filter((audit) => !audit.isSkipped && (slugs === undefined || slugs.includes(audit.slug)));
}

function findAudit(audits: AuditReport[], slug: string): AuditReport | undefined {
  return audits.find((audit) => audit.slug === slug);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function count(audits: AuditReport[], slug: string): number | undefined {
  const value = findAudit(audits, slug)?.value;
  return isCount(value) ? value : undefined;
}

function percent(audits: AuditReport[], slug: string): number | undefined {
  const value = findAudit(audits, slug)?.value;
  return typeof value === 'number' && value >= 0 && value <= 100 ? value : undefined;
}

function auditProblem(
  audits: AuditReport[],
  required: readonly string[],
  values: readonly (TResultFact | undefined)[],
): PluginProblem | undefined {
  if (required.some((slug) => findAudit(audits, slug) === undefined)) {
    return missingAudit;
  }
  return values.includes(undefined) ? invalidAudit : undefined;
}

function issues(plugin: string, audits: AuditReport[]): IResultIssue[] {
  return audits.flatMap((audit) => (audit.details?.issues ?? []).map((issue) => ({
    ...issue,
    audit: `${plugin}/${audit.slug}`,
  })));
}

function dependencyIssues(audits: AuditReport[]): IResultIssue[] {
  return issues('js-packages', audits).map((issue) => ({
    ...issue,
    group: issue.audit.endsWith('-prod') ? 'prod' : 'dev',
  }));
}

function npmAudit(report: Report): ICheckEvidence {
  const plugin = 'js-packages';
  const audits = selectAudits(report, plugin, npmAuditSlugs);
  const totals = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  const items = dependencyIssues(audits).map((issue) => {
    const match = /^`([^`]+)` dependency has an? \*\*(critical|high|moderate|low|info)\*\* vulnerability\b/.exec(issue.message);
    const fallback = issue.severity === 'error' ? 'high' : issue.severity === 'warning' ? 'moderate' : 'low';
    const level = match === null ? fallback : match[2] as keyof typeof totals;
    totals[level] += 1;
    return match === null ? issue : { ...issue, package: match[1], level };
  });
  const [production, development] = npmAuditSlugs.map((slug) => count(audits, slug));
  const missingDetails = audits.some(({ value, details }) => value > 0 && !details?.issues?.length);
  return {
    plugin,
    audits,
    facts: {
      production,
      development,
      ...(items.length > 0 || (production === 0 && development === 0) ? totals : {}),
    },
    findings: auditFindings({ ...totals, low: totals.low + totals.info }),
    details: { issues: items },
    problem: auditProblem(audits, npmAuditSlugs, [production, development]) ?? (missingDetails ? invalidAudit : undefined),
  };
}

function npmOutdated(report: Report): ICheckEvidence {
  const plugin = 'js-packages';
  const audits = selectAudits(report, plugin, outdatedSlugs);
  const totals = { major: 0, minor: 0, patch: 0 };
  const items = dependencyIssues(audits).map((issue) => {
    const match = /^Package (?:\[)?`([^`]+)`(?:\]\(.*?\))? requires a \*\*(major|minor|patch)\*\* update from \*\*(.+?)\*\* to \*\*(.+?)\*\*\./.exec(issue.message);
    if (match === null) {
      return issue;
    }
    const level = match[2] as keyof typeof totals;
    totals[level] += 1;
    return { ...issue, package: match[1], level, currentVersion: match[3], targetVersion: match[4] };
  });
  const [production, development] = outdatedSlugs.map((slug) => count(audits, slug));
  const recognized = totals.major + totals.minor + totals.patch;
  const mismatchedCount = audits.some(({ slug, value }) =>
    value !== items.filter(({ audit, level }) => audit === `${plugin}/${slug}` && level !== undefined).length);
  const unconfirmed = production === 0 || development === 0;
  const problem = auditProblem(audits, outdatedSlugs, [production, development]) ??
    (mismatchedCount ? invalidAudit : undefined) ??
    (unconfirmed ? {
      code: 'registry-unconfirmed',
      reason: 'Отчёт не подтверждает получение метаданных для группы без устаревших пакетов.',
      action: 'Проверьте доступ к npm-реестру и результат npm outdated.',
    } : undefined);
  return {
    plugin,
    audits,
    facts: {
      production: production === 0 ? undefined : production,
      development: development === 0 ? undefined : development,
      ...(recognized === 0 ? {} : totals),
    },
    findings: outdatedFindings(totals),
    details: { issues: items },
    problem,
  };
}

function eslint(report: Report): ICheckEvidence {
  const plugin = 'eslint';
  const audits = selectAudits(report, plugin);
  const coverageAudit = findAudit(audits, ESLINT_CHECKED_FILES);
  const checkedFiles = count(audits, ESLINT_CHECKED_FILES);
  const parseErrors = count(audits, ESLINT_PARSE_ERRORS);
  const findingAudits = audits.filter(({ slug }) => slug !== ESLINT_CHECKED_FILES);
  const parseRef = `${plugin}/${ESLINT_PARSE_ERRORS}`;
  const items = issues(plugin, findingAudits).sort((a, b) =>
    Number(b.audit === parseRef) - Number(a.audit === parseRef)
  );
  const errors = items.filter(({ severity }) => severity === 'error').length;
  const warnings = items.filter(({ severity }) => severity === 'warning').length;
  const findings = lintFindings({ errors, warnings, unformatted: 0 });
  const rules = (coverageAudit?.details?.table?.rows ?? []).flatMap((row) => {
    if (Array.isArray(row) || typeof row.rule !== 'string' || !isCount(row.count) || row.count === 0) {
      return [];
    }
    return [{ rule: row.rule, count: row.count }];
  }).slice(0, 10);
  let problem: PluginProblem | undefined;
  if (audits.length === 0) {
    problem = missingAudit;
  } else if ((coverageAudit !== undefined && checkedFiles === undefined) ||
    findingAudits.some(({ value, details }) =>
      value !== (details?.issues ?? []).filter(({ severity }) => severity === 'error' || severity === 'warning').length)) {
    problem = invalidAudit;
  } else if (checkedFiles === 0) {
    problem = {
      code: 'no-files',
      reason: 'ESLint не проверил ни одного файла.',
      action: 'Проверьте конфигурацию ESLint и шаблоны файлов.',
    };
  } else if (checkedFiles === undefined && findings.length === 0) {
    problem = {
      code: 'eslint-coverage-unconfirmed',
      reason: 'По аудитам ESLint нельзя определить, проверены ли файлы.',
      action: 'Проверьте конфигурацию ESLint и шаблоны файлов.',
    };
  }
  return {
    plugin,
    audits,
    facts: {
      checkedFiles,
      parseErrors,
      ...(checkedFiles || findings.length > 0 ? { errors, warnings } : {}),
    },
    findings,
    details: { issues: items, rules },
    problem,
  };
}

function prettier(report: Report): ICheckEvidence {
  const plugin = 'frontis-prettier';
  const audits = selectAudits(report, plugin, prettierSlugs);
  const [checkedFiles, unformatted, parseErrors] = prettierSlugs.map((slug) => count(audits, slug));
  const findings = lintFindings({ errors: 0, warnings: 0, unformatted: unformatted ?? 0 });
  if (parseErrors !== undefined && parseErrors > 0) {
    findings.push({
      module: 'prettier',
      metric: 'prettier.parseErrors',
      importance: 'high',
      current: String(parseErrors),
      target: '0',
      description: 'Исправьте ошибки разбора файлов Prettier.',
    });
  }
  const problem = auditProblem(audits, prettierSlugs, [checkedFiles, unformatted, parseErrors]) ??
    (checkedFiles === 0 ? {
      code: 'no-files',
      reason: 'Prettier не проверил ни одного файла.',
      action: 'Проверьте исключения в .prettierignore и .gitignore.',
    } : undefined);
  return { plugin, audits, facts: { checkedFiles, unformatted, parseErrors }, findings, problem };
}

function knip(report: Report): ICheckEvidence {
  const plugin = 'frontis-knip';
  const audits = selectAudits(report, plugin, knipSlugs);
  const values = knipSlugs.map((slug) => count(audits, slug));
  const [files, dependencies, exports, types, otherFindings] = values;
  const findings = unusedCodeFindings({
    files: files ?? 0,
    dependencies: dependencies ?? 0,
    exports: exports ?? 0,
    types: types ?? 0,
  });
  if (otherFindings !== undefined && otherFindings > 0) {
    findings.push({
      module: 'knip',
      metric: 'unusedCode.other',
      importance: 'high',
      current: String(otherFindings),
      target: '0',
      description: 'Разберите остальные находки knip по указанным файлам.',
    });
  }
  return {
    plugin, audits, facts: { files, dependencies, exports, types, otherFindings }, findings,
    problem: auditProblem(audits, knipSlugs, values),
  };
}

function coverage(report: Report, thresholds: Thresholds['coverage']): ICheckEvidence {
  const plugin = 'coverage';
  const audits = selectAudits(report, plugin, coverageSlugs);
  const [lines, branches, functions] = coverageSlugs.map((slug) => percent(audits, slug));
  return {
    plugin,
    audits,
    facts: { lines, branches, functions },
    findings: lines === undefined ? [] : coverageFindings(lines, thresholds),
    problem: auditProblem(audits, ['line-coverage'], [lines]),
  };
}

function nodeVersion(report: Report): ICheckEvidence {
  const plugin = 'frontis-node-version';
  const audits = selectAudits(report, plugin, nodeSlugs);
  const projectVersion = findAudit(audits, 'project-version')?.displayValue;
  const latestLts = findAudit(audits, 'latest-lts')?.displayValue;
  const rank = count(audits, 'version-lag');
  const lags = [null, 'patch', 'minor', 'major'] as const;
  const lag = rank === undefined ? undefined : lags[rank];
  const validVersion = (value: unknown): value is string => typeof value === 'string' && semver.valid(value) !== null;
  const version = validVersion(projectVersion) ? projectVersion : undefined;
  const lts = validVersion(latestLts) ? latestLts : undefined;
  const findings = version !== undefined && lts !== undefined && lag !== undefined
    ? nodeFindings({ version, latestLts: { version: lts, codename: '' }, lag })
    : [];
  return {
    plugin, audits, facts: { version, latestLts: lts, lag }, findings,
    problem: auditProblem(audits, nodeSlugs, [version, lts, lag]),
  };
}

function buildSize(report: Report, thresholds: Thresholds['buildSize']): ICheckEvidence {
  const plugin = 'frontis-build-size';
  const audits = selectAudits(report, plugin, buildSlugs);
  const [sizeBytes, files, limitBytes] = buildSlugs.map((slug) => count(audits, slug));
  const rows = findAudit(audits, 'size-bytes')?.details?.table?.rows ?? [];
  const largestFiles = rows.flatMap((row) => {
    if (Array.isArray(row) || typeof row.file !== 'string' || !isCount(row.bytes)) {
      return [];
    }
    return [{ file: row.file, bytes: row.bytes }];
  });
  return {
    plugin, audits, facts: { sizeBytes, files, limitBytes },
    findings: sizeBytes === undefined ? [] : buildSizeFindings(sizeBytes, thresholds),
    details: { largestFiles },
    problem: auditProblem(audits, ['size-bytes'], [sizeBytes]),
  };
}

function tests(): ICheckEvidence {
  return {
    plugin: 'tests', audits: [], facts: {}, findings: [],
    problem: {
      code: 'tests-report-unavailable',
      reason: 'В отчёте нет итогов прогона тестов.',
      action: 'Для итогов тестов требуется отдельная проверка Jest или Vitest.',
    },
  };
}

function createCheck(id: TCheckId, evidence: ICheckEvidence, context: IResultContext) {
  const module = id === 'tests' ? 'coverage' : id;
  if (!context.modules[module].enabled) {
    const check: IResultCheck = { id, status: 'disabled', audits: [], facts: {}, ...disabled };
    return { check, findings: [] };
  }
  const diagnostic = context.noData.find(({ plugin }) => plugin === id) ??
    context.noData.find(({ plugin }) => plugin === evidence.plugin);
  const problem = diagnostic ?? evidence.problem;
  const check: IResultCheck = {
    id,
    status: problem === undefined ? resolveStatus(evidence.findings) : 'no-data',
    audits: evidence.audits.map(({ slug }) => `${evidence.plugin}/${slug}`),
    facts: Object.fromEntries(
      Object.entries(evidence.facts).filter((entry): entry is [string, TResultFact] => entry[1] !== undefined),
    ),
  };
  if (problem !== undefined) {
    Object.assign(check, { code: problem.code, reason: problem.reason, action: problem.action });
  }
  if (diagnostic?.logFile !== undefined) {
    check.logFile = diagnostic.logFile;
  }
  const entries = evidence.details?.issues ?? issues(evidence.plugin, evidence.audits);
  const largestFiles = evidence.details?.largestFiles ?? [];
  const rules = evidence.details?.rules ?? [];
  if (entries.length > 0 || largestFiles.length > 0 || rules.length > 0) {
    check.details = {
      ...(entries.length > 0 ? { issues: entries.slice(0, 10) } : {}),
      ...(largestFiles.length > 0 ? { largestFiles } : {}),
      ...(rules.length > 0 ? { rules } : {}),
    };
  }
  return { check, findings: evidence.findings };
}

export function createResult(report: Report, context: IResultContext): FrontisResult {
  const findings: Finding[] = [];
  const indicators: IResultIndicator[] = [];
  const addIndicator = (id: TIndicatorId, evidence: [TCheckId, ICheckEvidence][]) => {
    const results = evidence.map(([checkId, data]) => createCheck(checkId, data, context));
    const checks = results.map(({ check }) => check);
    const confirmed = results.flatMap((result) => result.findings);
    findings.push(...confirmed);
    const gap = checks.find(({ status }) => status === 'no-data') ?? checks.find(({ status }) => status === 'disabled');
    const known = confirmed.length > 0 || checks.some(({ status }) => status !== 'no-data' && status !== 'disabled');
    indicators.push({
      id,
      status: known ? resolveStatus(confirmed) : 'no-data',
      audits: [...new Set(checks.flatMap(({ audits }) => audits))],
      findings: confirmed.map(({ importance, metric, current, target }) => ({ importance, kind: metric, now: current, target })),
      checks,
      ...(known && gap !== undefined ? { incomplete: true } : {}),
      ...(!known && gap !== undefined ? { code: gap.code, reason: gap.reason, action: gap.action } : {}),
    });
  };
  addIndicator('outdated', [['outdated', npmOutdated(report)]]);
  addIndicator('audit', [['audit', npmAudit(report)]]);
  addIndicator('unusedCode', [['knip', knip(report)]]);
  addIndicator('codeQuality', [['lint', eslint(report)], ['prettier', prettier(report)]]);
  addIndicator('coverage', [['coverage', coverage(report, context.thresholds.coverage)], ['tests', tests()]]);
  if (context.modules['node-version'].enabled) {
    addIndicator('nodeVersion', [['node-version', nodeVersion(report)]]);
  }
  if (context.modules['build-size'].enabled) {
    addIndicator('buildSize', [['build-size', buildSize(report, context.thresholds.buildSize)]]);
  }

  return {
    schemaVersion: 1,
    tool: { name: 'frontis', version: context.toolVersion },
    report: { file: 'report.json', codePushUpVersion: report.version },
    project: { ...context.project, commit: report.commit?.hash ?? null },
    runAt: report.date,
    durationMs: report.duration,
    score: projectScore(indicators.map(({ status }) => status)),
    indicators,
    recommendations: buildRecommendations(findings).flatMap(({ module, importance, current, target, description }) => (
      module === 'project-info' ? [] : [{ importance, indicator: indicatorByModule[module], now: current, target, text: description }]
    )),
  };
}
