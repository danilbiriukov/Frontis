import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Collector, CollectorContext, CollectorFailure, CollectorFinding } from './index.js';

export interface KnipData {
  /** Сводка для оценки: неиспользуемые файлы, зависимости, экспорты и типы. */
  counts: { files: number; dependencies: number; exports: number; types: number };
  /** Число находок по каждой категории, которую выдал knip. */
  categories: Record<string, number>;
  knipVersion: string;
}

const SUMMARY: Record<string, keyof KnipData['counts']> = {
  files: 'files',
  dependencies: 'dependencies',
  devDependencies: 'dependencies',
  optionalPeerDependencies: 'dependencies',
  exports: 'exports',
  nsExports: 'exports',
  types: 'types',
  nsTypes: 'types',
};

const FINDINGS: Record<string, { code: string; message: string }> = {
  files: { code: 'unused-file', message: 'Неиспользуемый файл' },
  dependencies: { code: 'unused-dependency', message: 'Неиспользуемая зависимость' },
  devDependencies: { code: 'unused-dev-dependency', message: 'Неиспользуемая dev-зависимость' },
  optionalPeerDependencies: { code: 'unused-optional-peer-dependency', message: 'Неиспользуемая необязательная peer-зависимость' },
  unlisted: { code: 'unlisted-dependency', message: 'Зависимость не указана в package.json' },
  binaries: { code: 'unlisted-binary', message: 'Команда из пакета, не указанного в package.json' },
  unresolved: { code: 'unresolved-import', message: 'Импорт не удалось разрешить' },
  exports: { code: 'unused-export', message: 'Неиспользуемый экспорт' },
  nsExports: { code: 'unused-namespace-export', message: 'Неиспользуемый экспорт в пространстве имён' },
  types: { code: 'unused-type', message: 'Неиспользуемый экспортируемый тип' },
  nsTypes: { code: 'unused-namespace-type', message: 'Неиспользуемый тип в пространстве имён' },
  enumMembers: { code: 'unused-enum-member', message: 'Неиспользуемый член перечисления' },
  namespaceMembers: { code: 'unused-namespace-member', message: 'Неиспользуемый член пространства имён' },
  duplicates: { code: 'duplicate-export', message: 'Повторный экспорт' },
  catalog: { code: 'unused-catalog-entry', message: 'Неиспользуемая запись каталога' },
  catalogReferences: { code: 'unresolved-catalog-reference', message: 'Ссылка на отсутствующую запись каталога' },
  cycles: { code: 'import-cycle', message: 'Циклический импорт' },
};

const MAX_OUTPUT = 64 * 1024 * 1024;

interface KnipItem {
  name: string;
  line?: number;
  col?: number;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(status: CollectorFailure['status'], code: string, reason: string, action: string, cause?: unknown): CollectorFailure {
  return { status, code, reason, action, ...(cause === undefined ? {} : { cause }) };
}

function findKnip(projectDir: string): { bin: string; version: string } | undefined {
  let dir: string;
  try {
    dir = dirname(createRequire(join(projectDir, 'package.json')).resolve('knip'));
  } catch {
    return undefined;
  }
  for (; dirname(dir) !== dir; dir = dirname(dir)) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (manifest.name !== 'knip') continue;
      const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.knip;
      return typeof bin === 'string' ? { bin: join(dir, bin), version: String(manifest.version) } : undefined;
    } catch {
      continue;
    }
  }
  return undefined;
}

function runKnip(bin: string, context: CollectorContext) {
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string; error?: Error }>((resolve) => {
    execFile(
      process.execPath,
      [bin, '--reporter', 'json', '--no-progress'],
      { cwd: context.projectDir, signal: context.signal, maxBuffer: MAX_OUTPUT, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
        resolve({ exitCode, stdout, stderr, error: error ?? undefined });
      },
    );
  });
}

function toItem(entry: unknown): KnipItem | undefined {
  // duplicates и cycles приходят группами символов
  if (Array.isArray(entry)) {
    const items = entry.map(toItem).filter((item) => item !== undefined);
    return items.length > 0 ? { ...items[0], name: items.map((item) => item.name).join(', ') } : undefined;
  }
  if (!isFields(entry) || typeof entry['name'] !== 'string') return undefined;
  return {
    name: entry['name'],
    line: typeof entry['line'] === 'number' && entry['line'] > 0 ? entry['line'] : undefined,
    col: typeof entry['col'] === 'number' && entry['col'] > 0 ? entry['col'] : undefined,
  };
}

function toFinding(category: string, file: string, item: KnipItem): CollectorFinding {
  const known = FINDINGS[category] ?? { code: `knip-${category.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, message: `Находка knip (${category})` };
  return {
    code: known.code,
    message: category === 'files' ? known.message : `${known.message}: ${item.name}`,
    severity: 'warning',
    source: {
      file,
      ...(item.line === undefined ? {} : { position: { startLine: item.line, ...(item.col === undefined ? {} : { startColumn: item.col }) } }),
    },
  };
}

export function parseKnipReport(output: unknown): { counts: KnipData['counts']; categories: Record<string, number>; findings: CollectorFinding[] } | undefined {
  if (!isFields(output) || !Array.isArray(output['issues'])) return undefined;
  const counts = { files: 0, dependencies: 0, exports: 0, types: 0 };
  const categories: Record<string, number> = {};
  const findings: CollectorFinding[] = [];
  // knip 5 выводит неиспользуемые файлы отдельным списком путей
  const legacyFiles = output['files'];
  if (Array.isArray(legacyFiles)) {
    for (const file of legacyFiles) {
      if (typeof file !== 'string') return undefined;
      categories['files'] = (categories['files'] ?? 0) + 1;
      counts.files += 1;
      findings.push(toFinding('files', file.replaceAll('\\', '/'), { name: file }));
    }
  }
  for (const row of output['issues']) {
    if (!isFields(row) || typeof row['file'] !== 'string') return undefined;
    const file = row['file'].replaceAll('\\', '/');
    for (const [category, entries] of Object.entries(row)) {
      if (category === 'file' || category === 'owners' || !Array.isArray(entries)) continue;
      for (const entry of entries) {
        const item = toItem(entry);
        if (item === undefined) return undefined;
        categories[category] = (categories[category] ?? 0) + 1;
        const summary = SUMMARY[category];
        if (summary !== undefined) counts[summary] += 1;
        findings.push(toFinding(category, file, item));
      }
    }
  }
  return { counts, categories, findings };
}

export const collectKnip: Collector<KnipData> = async (context) => {
  const knip = findKnip(context.projectDir);
  if (knip === undefined) {
    return failure('no-data', 'knip-not-installed', 'knip не установлен в проекте', 'Установите knip: npm install -D knip');
  }

  const run = await runKnip(knip.bin, context);
  context.signal?.throwIfAborted();
  if (run.exitCode !== 0 && run.exitCode !== 1) {
    const message = (run.stderr.trim() || run.error?.message || '').split('\n')[0].replace(/^ERROR:\s*/, '');
    return failure(
      'error',
      'knip-failed',
      `knip завершился с ошибкой${message ? `: ${message}` : ''}`,
      'Запустите npx knip в корне проекта и исправьте конфигурацию.',
      run.error,
    );
  }

  let parsed: ReturnType<typeof parseKnipReport>;
  try {
    parsed = parseKnipReport(JSON.parse(run.stdout));
  } catch (error) {
    return failure('error', 'invalid-output', 'knip вернул некорректный JSON', 'Проверьте, что версия knip поддерживает --reporter json.', error);
  }
  if (parsed === undefined) {
    return failure('error', 'invalid-output', 'Ответ knip не соответствует ожидаемому формату', 'Проверьте, что используется knip 5 или новее.');
  }

  return {
    status: 'ok',
    data: { counts: parsed.counts, categories: parsed.categories, knipVersion: knip.version },
    findings: parsed.findings,
  };
};
