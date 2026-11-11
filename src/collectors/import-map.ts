import { execFile } from 'node:child_process';
import { constants, type Dirent } from 'node:fs';
import { open, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Collector, CollectorContext } from './index.js';

export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
}

export interface ImportMapOptions {
  /** Отстающие зависимости из #22. undefined, если сведения недоступны. */
  packages: readonly OutdatedPackage[] | undefined;
  /** Сколько наиболее отстающих пакетов показать. По умолчанию 5. */
  limit?: number;
}

export interface ImportMapData {
  packages: {
    name: string;
    current: string;
    latest: string;
    /** Импорты пакета и его подпутей, отсортированы по файлу и строке. */
    imports: { file: string; line: number; specifier: string }[];
  }[];
  scannedFiles: number;
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/i;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const SPECIFIER = /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*(['"`])([^'"`\n]+)\1/g;
const GIT_TIMEOUT_MS = 10_000;

const NO_SOURCES = {
  status: 'no-data',
  code: 'no-sources',
  reason: 'В проекте нет доступных исходных файлов.',
  action: 'Проверьте projectDir в frontis.config и доступ к файлам.',
} as const;

function skippedDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRS.has(name);
}

function parseVersion(version: string): number[] | undefined {
  // Поиск начинается только с первой цифры группы.
  const match = version.match(/(?<!\d)(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : undefined;
}

/** Отставание как [major, minor, patch]: младшие части учитываются только при равных старших. */
function lag({ current, latest }: OutdatedPackage): number[] | undefined {
  const from = parseVersion(current);
  const to = parseVersion(latest);
  if (from === undefined || to === undefined) return undefined;
  if (to[0] !== from[0]) return [to[0] - from[0], 0, 0];
  if (to[1] !== from[1]) return [0, to[1] - from[1], 0];
  return [0, 0, to[2] - from[2]];
}

export function selectMostOutdated(packages: readonly OutdatedPackage[], limit = 5): OutdatedPackage[] {
  const compare = (a: OutdatedPackage, b: OutdatedPackage): number => {
    const left = lag(a);
    const right = lag(b);
    if (left === undefined || right === undefined) {
      if (left !== right) return left === undefined ? 1 : -1;
    } else {
      for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return right[i] - left[i];
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  };
  return [...packages].sort(compare).slice(0, limit);
}

function gitFiles(context: CollectorContext): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: context.projectDir, signal: context.signal, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error ? undefined : stdout.split('\0').filter((file) => file !== '')),
    );
  });
}

async function walkFiles(projectDir: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skippedDirectory(entry.name)) {
          await walk(join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        files.push(relative(projectDir, join(dir, entry.name)).split(sep).join('/'));
      }
    }
  };
  await walk(projectDir);
  return files;
}

export function findImports(source: string, names: readonly string[]): { name: string; line: number; specifier: string }[] {
  const found: { name: string; line: number; specifier: string }[] = [];
  let line = 1;
  let nextLine = source.indexOf('\n');
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[2];
    const name = names.find((candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`));
    if (name === undefined) {
      continue;
    }
    while (nextLine !== -1 && nextLine < match.index) {
      line += 1;
      nextLine = source.indexOf('\n', nextLine + 1);
    }
    found.push({ name, line, specifier });
  }
  return found;
}

async function readSource(projectDir: string, file: string, signal?: AbortSignal): Promise<string | undefined> {
  const path = resolve(projectDir, file);
  const within = relative(projectDir, path);
  if (isAbsolute(file) || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
    return;
  }
  try {
    if (relative(path, await realpath(path)) !== '') {
      return;
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      if ((await handle.stat()).isFile()) {
        return await readFile(handle, { encoding: 'utf8', signal });
      }
    } finally {
      await handle.close();
    }
  } catch {
    signal?.throwIfAborted();
  }
}

export function createImportMapCollector(options: ImportMapOptions): Collector<ImportMapData> {
  return async (context) => {
    if (options.packages === undefined) {
      return {
        status: 'no-data',
        code: 'no-outdated-data',
        reason: 'Нет сведений об отстающих зависимостях',
        action: 'Карта импортов строится по результату проверки устаревших зависимостей.',
      };
    }

    const selected = selectMostOutdated(options.packages, options.limit);
    if (selected.length === 0) {
      return { status: 'ok', data: { packages: [], scannedFiles: 0 }, findings: [] };
    }

    const { signal } = context;
    const projectDir = await realpath(context.projectDir).catch(() => undefined);
    if (projectDir === undefined) {
      return NO_SOURCES;
    }
    const listed = (await gitFiles({ projectDir, signal })) ?? (await walkFiles(projectDir, signal));
    signal?.throwIfAborted();
    const sources = listed
      .filter((file) => SOURCE_EXTENSIONS.test(file) && !file.split('/').slice(0, -1).some(skippedDirectory))
      .sort();
    const names = selected.map(({ name }) => name);
    const imports = new Map<string, ImportMapData['packages'][number]['imports']>(names.map((name) => [name, []]));
    let scannedFiles = 0;
    for (const file of sources) {
      signal?.throwIfAborted();
      const source = await readSource(projectDir, file, signal);
      if (source !== undefined) {
        scannedFiles += 1;
        for (const { name, line, specifier } of findImports(source, names)) {
          imports.get(name)?.push({ file, line, specifier });
        }
      }
    }
    if (scannedFiles === 0) {
      return NO_SOURCES;
    }

    return {
      status: 'ok',
      data: {
        packages: selected.map(({ name, current, latest }) => ({ name, current, latest, imports: imports.get(name) ?? [] })),
        scannedFiles,
      },
      findings: [],
    };
  };
}
