import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collector, CollectorContext, CollectorResult } from './index.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface ProjectInfo {
  name: string | null;
  version: string | null;
  packageManager: {
    name: PackageManager;
    /** Откуда определён менеджер: поле packageManager или lock-файл. */
    source: 'package-json' | 'lock-file';
    /** Версия из поля packageManager. */
    version: string | null;
  } | null;
  /** Найденные lock-файлы в порядке приоритета. */
  lockFiles: string[];
  git: {
    /** null для отсоединённого HEAD. */
    branch: string | null;
    /** null в репозитории без коммитов. */
    commit: { hash: string; message: string; date: string; author: string } | null;
  } | null;
  /** Окружение, в котором запущен Frontis, а не требования проекта. */
  runtime: { node: string };
}

const LOCK_FILES: readonly [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

const GIT_TIMEOUT_MS = 10_000;

type Fields = Record<string, unknown>;

function text(fields: Fields, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function detectPackageManager(manifest: Fields, lockFiles: string[]): ProjectInfo['packageManager'] {
  const declared = text(manifest, 'packageManager')?.match(/^(npm|pnpm|yarn)@([^+\s]+)/);
  if (declared) {
    return { name: declared[1] as PackageManager, source: 'package-json', version: declared[2] };
  }
  const lockFile = LOCK_FILES.find(([file]) => file === lockFiles[0]);
  return lockFile ? { name: lockFile[1], source: 'lock-file', version: null } : null;
}

function git(args: string[], context: CollectorContext): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: context.projectDir, signal: context.signal, timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout.trim()),
    );
  });
}

export async function readProjectGit(context: CollectorContext): Promise<ProjectInfo['git']> {
  if ((await git(['rev-parse', '--is-inside-work-tree'], context)) !== 'true') {
    return null;
  }
  const [branch, log] = await Promise.all([
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], context),
    git(['log', '-1', '--format=%H%n%aI%n%an%n%s'], context),
  ]);
  const [hash, date, author = '', message = ''] = log ? log.split(/\r?\n/) : [];
  return {
    branch: branch || null,
    commit: hash && date ? { hash, date, author, message } : null,
  };
}

export const collectProjectInfo: Collector<ProjectInfo> = async (context) => {
  const manifestPath = join(context.projectDir, 'package.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    return manifestFailure(error);
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return {
      status: 'error',
      code: 'invalid-package-json',
      reason: 'package.json не содержит объект',
      action: 'Проверьте содержимое package.json в корне проекта.',
    };
  }

  const fields = manifest as Fields;
  const git = await readProjectGit(context);
  context.signal?.throwIfAborted();
  const lockFiles = LOCK_FILES.map(([file]) => file).filter((file) => existsSync(join(context.projectDir, file)));
  return {
    status: 'ok',
    data: {
      name: text(fields, 'name'),
      version: text(fields, 'version'),
      packageManager: detectPackageManager(fields, lockFiles),
      lockFiles,
      git,
      runtime: { node: process.versions.node },
    },
    findings: [],
  };
};

function manifestFailure(error: unknown): CollectorResult<ProjectInfo> {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      status: 'no-data',
      code: 'no-package-json',
      reason: 'В корне проекта нет package.json',
      action: 'Запустите frontis в корне проекта или укажите projectDir в frontis.config.',
    };
  }
  return {
    status: 'error',
    code: error instanceof SyntaxError ? 'invalid-package-json' : 'package-json-unreadable',
    reason: error instanceof SyntaxError ? 'package.json содержит некорректный JSON' : 'Не удалось прочитать package.json',
    action: 'Проверьте содержимое package.json в корне проекта.',
    cause: error,
  };
}
