import type { ModuleName, Thresholds } from './config.js';
import type { Finding, Importance } from './importance.js';
import type { NoData } from './recommendations.js';

// Правила превращают нормализованный результат одного инструмента в находки.
// Нулевые показатели находок не создают: в рекомендациях только отклонения.

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

const formatCount = (count: number): string => numberFormat.format(count);

// Округление в сторону «хуже»: 89,96% покрытия не должно выглядеть как 90%,
// а 5,02 МБ сверх предела в 5 МБ — как 5 МБ
const tenthsDown = (value: number): number => Math.floor(Number((value * 10).toFixed(6))) / 10;
const tenthsUp = (value: number): number => Math.ceil(Number((value * 10).toFixed(6))) / 10;

const BYTES_IN_MB = 1024 * 1024;

interface CountRule<T> {
  key: keyof T;
  metric: string;
  importance: Importance;
  description: string;
}

function countFindings<T extends { [K in keyof T]: number }>(
  module: ModuleName,
  counts: T,
  rules: readonly CountRule<T>[],
): Finding[] {
  return rules.flatMap(({ key, metric, importance, description }) => {
    const count = counts[key];
    if (!(count > 0)) return [];
    return [{ module, metric, importance, current: formatCount(count), target: '0', description }];
  });
}

export interface AuditCounts {
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

/** Уязвимости зависимостей: число уязвимостей каждого уровня. */
export function auditFindings(counts: AuditCounts): Finding[] {
  return countFindings('audit', counts, [
    {
      key: 'critical',
      metric: 'audit.critical',
      importance: 'high',
      description: 'Обновите или замените пакеты с критическими уязвимостями в первую очередь.',
    },
    {
      key: 'high',
      metric: 'audit.high',
      importance: 'high',
      description: 'Обновите или замените пакеты с уязвимостями высокого уровня.',
    },
    {
      key: 'moderate',
      metric: 'audit.moderate',
      importance: 'mid',
      description: 'Запланируйте обновление пакетов с уязвимостями среднего уровня.',
    },
    {
      key: 'low',
      metric: 'audit.low',
      importance: 'low',
      description: 'Обновите пакеты с уязвимостями низкого уровня при плановом обновлении.',
    },
  ]);
}

export interface OutdatedCounts {
  major: number;
  minor: number;
  patch: number;
}

/** Устаревшие зависимости: число пакетов по наибольшему отставанию. */
export function outdatedFindings(counts: OutdatedCounts): Finding[] {
  return countFindings('outdated', counts, [
    {
      key: 'major',
      metric: 'outdated.major',
      importance: 'high',
      description: 'Обновите пакеты, отстающие на мажорную версию, сверившись с журналами изменений.',
    },
    {
      key: 'minor',
      metric: 'outdated.minor',
      importance: 'mid',
      description: 'Обновите пакеты, отстающие на минорную версию.',
    },
    {
      key: 'patch',
      metric: 'outdated.patch',
      importance: 'low',
      description: 'Обновите пакеты, отстающие на патч-версию.',
    },
  ]);
}

export interface TestCounts {
  failed: number;
  skipped: number;
}

/** Результат прогона тестов. Отдельные находки, не часть покрытия. */
export function testFindings(counts: TestCounts): Finding[] {
  return countFindings('coverage', counts, [
    {
      key: 'failed',
      metric: 'tests.failed',
      importance: 'high',
      description: 'Исправьте упавшие тесты.',
    },
    {
      key: 'skipped',
      metric: 'tests.skipped',
      importance: 'low',
      description: 'Включите пропущенные тесты или удалите их, если они больше не нужны.',
    },
  ]);
}

export interface LintCounts {
  errors: number;
  warnings: number;
  /** Файлы, не прошедшие проверку форматирования. */
  unformatted: number;
}

export function lintFindings(counts: LintCounts): Finding[] {
  return countFindings('lint', counts, [
    {
      key: 'errors',
      metric: 'lint.errors',
      importance: 'high',
      description: 'Исправьте ошибки линтера.',
    },
    {
      key: 'warnings',
      metric: 'lint.warnings',
      importance: 'mid',
      description: 'Исправьте предупреждения линтера или осознанно отключите правило.',
    },
    {
      key: 'unformatted',
      metric: 'lint.format',
      importance: 'mid',
      description: 'Отформатируйте файлы форматтером проекта.',
    },
  ]);
}

export interface UnusedCodeCounts {
  files: number;
  dependencies: number;
  exports: number;
  types: number;
}

/** Неиспользуемый код. Порогов нет: любая находка — высокая важность. */
export function unusedCodeFindings(counts: UnusedCodeCounts): Finding[] {
  return countFindings('knip', counts, [
    {
      key: 'files',
      metric: 'unusedCode.files',
      importance: 'high',
      description: 'Удалите неиспользуемые файлы.',
    },
    {
      key: 'dependencies',
      metric: 'unusedCode.dependencies',
      importance: 'high',
      description: 'Удалите неиспользуемые зависимости из package.json.',
    },
    {
      key: 'exports',
      metric: 'unusedCode.exports',
      importance: 'high',
      description: 'Удалите неиспользуемые экспорты или сделайте их внутренними.',
    },
    {
      key: 'types',
      metric: 'unusedCode.types',
      importance: 'high',
      description: 'Удалите неиспользуемые экспортируемые типы.',
    },
  ]);
}

/**
 * Покрытие тестами. Находка создаётся только по строкам: ветви, функции
 * и инструкции остаются детализацией в карточке модуля.
 */
export function coverageFindings(linesPercent: number, thresholds: Thresholds['coverage']): Finding[] {
  if (linesPercent >= thresholds.target) return [];
  const high = linesPercent < thresholds.warn;
  return [
    {
      module: 'coverage',
      metric: 'coverage.lines',
      importance: high ? 'high' : 'mid',
      current: `${numberFormat.format(tenthsDown(linesPercent))}%`,
      target: `${numberFormat.format(thresholds.target)}%`,
      description: high
        ? 'Добавьте тесты на непокрытый код, начиная с основной логики.'
        : 'Доведите покрытие строк до цели тестами на непокрытые участки.',
    },
  ];
}

/** Размер сборки в байтах против предела из thresholds.buildSize. */
export function buildSizeFindings(bytes: number, thresholds: Thresholds['buildSize']): Finding[] {
  const mb = bytes / BYTES_IN_MB;
  if (!(mb > thresholds.maxMb)) return [];
  return [
    {
      module: 'build-size',
      metric: 'buildSize.total',
      importance: 'high',
      current: `${numberFormat.format(tenthsUp(mb))} МБ`,
      target: `${numberFormat.format(thresholds.maxMb)} МБ`,
      description: 'Уменьшите сборку: разделите код на части и уберите тяжёлые зависимости.',
    },
  ];
}

interface Version {
  text: string;
  parts: number[];
}

const VERSION = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

function parseVersion(raw: string): Version {
  const match = VERSION.exec(raw.trim());
  if (match === null) throw new RangeError(`Не удалось разобрать версию Node.js: ${raw}`);
  const parts = match.slice(1).flatMap((part) => (part === undefined ? [] : [Number(part)]));
  return { text: parts.join('.'), parts };
}

const NODE_LAG: readonly { metric: string; importance: Importance; description: string }[] = [
  {
    metric: 'node.major',
    importance: 'high',
    description: 'Переведите проект на актуальную LTS-версию Node.js: обновите .nvmrc и поле engines.',
  },
  {
    metric: 'node.minor',
    importance: 'mid',
    description: 'Обновите Node.js до последней минорной версии LTS.',
  },
  {
    metric: 'node.patch',
    importance: 'low',
    description: 'Обновите Node.js до последней патч-версии LTS.',
  },
];

/**
 * Версия Node.js проекта (из .nvmrc или engines) против последней LTS
 * по правилам семантических версий. Если в проекте указаны не все части
 * версии, например "24", сравниваются только указанные.
 */
export function nodeFindings(projectVersion: string, latestLts: string): Finding[] {
  const project = parseVersion(projectVersion);
  const lts = parseVersion(latestLts);

  for (const [index, lag] of NODE_LAG.entries()) {
    const own = project.parts[index];
    const latest = lts.parts[index];
    if (own === undefined || latest === undefined || own > latest) return [];
    if (own < latest) {
      return [{ module: 'node-version', ...lag, current: project.text, target: lts.text }];
    }
  }
  return [];
}

/** Список релизов nodejs.org не получен: своего зашитого списка версий нет. */
export const NODE_RELEASES_UNAVAILABLE: NoData = {
  module: 'node-version',
  reason: 'не удалось получить список релизов Node.js',
  action: 'Проверьте подключение к сети и запустите frontis снова.',
};
