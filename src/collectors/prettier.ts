import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Collector, CollectorFailure, CollectorFinding } from './index.js';

type Position = NonNullable<CollectorFinding['source']>['position'];

export interface PrettierData {
  /** Файлы, которые Prettier умеет форматировать и которые не исключены. */
  checkedFiles: number;
  /** Пути от корня проекта, которым нужно форматирование. */
  unformatted: string[];
  /** Файлы, которые Prettier не смог разобрать. */
  errors: { file: string; message: string; position?: Position }[];
  /** Путь к файлу настроек от корня проекта. */
  configFile: string;
  prettierVersion: string;
}

interface PrettierApi {
  version: string;
  getFileInfo(file: string, options: { ignorePath: string[]; resolveConfig?: boolean }): Promise<{ ignored: boolean; inferredParser: string | null }>;
  resolveConfigFile(file: string): Promise<string | null>;
  resolveConfig(file: string, options: { editorconfig: boolean }): Promise<Record<string, unknown> | null>;
  check(source: string, options: Record<string, unknown>): Promise<boolean>;
}

// Каталоги, которые Prettier пропускает при обходе
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.hg', '.jj', '.sl', '.svn']);
const IGNORE_FILES = ['.gitignore', '.prettierignore'];
const CONCURRENCY = 8;

function failure(status: CollectorFailure['status'], code: string, reason: string, action: string, cause?: unknown): CollectorFailure {
  return { status, code, reason, action, ...(cause === undefined ? {} : { cause }) };
}

function toRelative(projectDir: string, file: string): string {
  return relative(projectDir, file).split(sep).join('/');
}

function errorPosition(error: unknown): Position {
  if (!(error instanceof Error) || !('loc' in error)) {
    return undefined;
  }
  const start = (error.loc as { start?: { line?: unknown; column?: unknown } } | undefined)?.start;
  const line = start?.line;
  const column = start?.column;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
    return undefined;
  }
  return typeof column === 'number' && Number.isInteger(column) && column > 0
    ? { startLine: line, startColumn: column }
    : { startLine: line };
}

async function loadPrettier(projectDir: string): Promise<PrettierApi | undefined> {
  let entry: string;
  try {
    entry = createRequire(join(projectDir, 'package.json')).resolve('prettier');
  } catch {
    return undefined;
  }
  const module = await import(pathToFileURL(entry).href);
  return (module.default ?? module) as PrettierApi;
}

async function listFiles(prettier: PrettierApi, projectDir: string, ignorePath: string[], signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === projectDir && entry.name === '.frontis') {
          continue;
        }
        if (SKIPPED_DIRS.has(entry.name)) continue;
        if ((await prettier.getFileInfo(path, { ignorePath })).ignored) continue;
        await walk(path);
      } else if (entry.isFile()) {
        const info = await prettier.getFileInfo(path, { ignorePath, resolveConfig: true });
        if (!info.ignored && info.inferredParser !== null) files.push(path);
      }
    }
  };
  await walk(projectDir);
  return files;
}

export const collectPrettier: Collector<PrettierData> = async (context) => {
  const { projectDir, signal } = context;
  let prettier: PrettierApi | undefined;
  try {
    prettier = await loadPrettier(projectDir);
  } catch (error) {
    return failure('error', 'prettier-failed', 'Не удалось загрузить Prettier', 'Переустановите зависимости проекта.', error);
  }
  if (prettier === undefined) {
    return failure('no-data', 'prettier-not-installed', 'Prettier не установлен в проекте', 'Установите Prettier: npm install -D prettier');
  }
  if (Number.parseInt(prettier.version, 10) < 3) {
    return failure('no-data', 'prettier-unsupported', `Prettier ${prettier.version} не поддерживается`, 'Обновите Prettier до версии 3 или новее.');
  }

  let configFile: string | null;
  let files: string[];
  try {
    configFile = await prettier.resolveConfigFile(join(projectDir, 'package.json'));
    if (configFile === null) {
      return failure('no-data', 'no-prettier-config', 'В проекте нет настроек Prettier', 'Добавьте .prettierrc или поле prettier в package.json.');
    }
    files = await listFiles(prettier, projectDir, IGNORE_FILES.map((file) => join(projectDir, file)), signal);
  } catch (error) {
    signal?.throwIfAborted();
    return failure('error', 'prettier-failed', 'Не удалось прочитать настройки Prettier', 'Проверьте файл настроек и .prettierignore.', error);
  }
  if (files.length === 0) {
    return failure('no-data', 'no-files', 'Prettier не нашёл файлов для проверки', 'Проверьте исключения в .prettierignore и .gitignore.');
  }

  const unformatted: string[] = [];
  const errors: PrettierData['errors'] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      signal?.throwIfAborted();
      const file = files[next++];
      try {
        const options = await prettier.resolveConfig(file, { editorconfig: true });
        if (!(await prettier.check(await readFile(file, 'utf8'), { ...options, filepath: file }))) {
          unformatted.push(toRelative(projectDir, file));
        }
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).split('\n')[0];
        const position = errorPosition(error);
        errors.push({ file: toRelative(projectDir, file), message, ...(position === undefined ? {} : { position }) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
  signal?.throwIfAborted();

  unformatted.sort();
  errors.sort((a, b) => (a.file < b.file ? -1 : 1));
  const findings: CollectorFinding[] = [
    ...unformatted.map((file): CollectorFinding => ({
      code: 'unformatted-file',
      message: 'Файл не отформатирован Prettier',
      severity: 'warning',
      source: { file },
    })),
    ...errors.map(({ file, message, position }): CollectorFinding => ({
      code: 'prettier-error',
      message: `Prettier не смог разобрать файл: ${message}`,
      severity: 'error',
      source: position === undefined ? { file } : { file, position },
    })),
  ];
  return {
    status: 'ok',
    data: {
      checkedFiles: files.length,
      unformatted,
      errors,
      configFile: toRelative(projectDir, configFile),
      prettierVersion: prettier.version,
    },
    findings,
  };
};
