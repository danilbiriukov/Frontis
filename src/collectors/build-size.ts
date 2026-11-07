import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Collector, CollectorFailure } from './index.js';

export interface BuildSizeOptions {
  /** Абсолютный путь к папке сборки из разрешённой конфигурации. */
  buildDir: string;
  /** thresholds.buildSize.maxMb, 1 МБ = 1 048 576 байт. */
  maxMb: number;
}

export interface BuildSizeData {
  /** Путь от корня проекта. */
  buildDir: string;
  totalBytes: number;
  files: number;
  /** Пять крупнейших файлов, пути от корня проекта. */
  largest: { file: string; bytes: number }[];
  maxBytes: number;
  exceeded: boolean;
}

/** 1 МБ в байтах, общий с правилами отчёта. */
export const BYTES_IN_MB = 1024 * 1024;
const LARGEST = 5;

function noData(code: string, reason: string, action: string, cause?: unknown): CollectorFailure {
  return { status: 'no-data', code, reason, action, ...(cause === undefined ? {} : { cause }) };
}

function toPath(projectDir: string, path: string): string {
  return relative(projectDir, path).split(sep).join('/') || '.';
}

export function createBuildSizeCollector(options: BuildSizeOptions): Collector<BuildSizeData> {
  return async ({ projectDir, signal }) => {
    const buildDir = toPath(projectDir, options.buildDir);
    try {
      if (!(await stat(options.buildDir)).isDirectory()) {
        return noData('no-build-dir', `${buildDir} не является папкой`, 'Укажите папку сборки в buildDir в frontis.config.');
      }
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? noData('no-build-dir', `Папка сборки ${buildDir} не найдена`, 'Соберите проект перед запуском frontis или укажите buildDir в frontis.config.', error)
        : noData('build-dir-unreadable', `Нет доступа к папке сборки ${buildDir}`, 'Проверьте права на чтение папки сборки.', error);
    }

    const sizes: { file: string; bytes: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      signal?.throwIfAborted();
      const entries: Dirent[] = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) sizes.push({ file: toPath(projectDir, path), bytes: (await stat(path)).size });
      }
    };
    try {
      await walk(options.buildDir);
    } catch (error) {
      signal?.throwIfAborted();
      return noData('build-dir-unreadable', `Не удалось прочитать папку сборки ${buildDir}`, 'Проверьте права на чтение папки сборки.', error);
    }
    if (sizes.length === 0) {
      return noData('empty-build-dir', `Папка сборки ${buildDir} пуста`, 'Соберите проект перед запуском frontis.');
    }

    const totalBytes = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
    const maxBytes = Math.floor(options.maxMb * BYTES_IN_MB);
    const exceeded = totalBytes > maxBytes;
    const largest = [...sizes]
      .sort((a, b) => b.bytes - a.bytes || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
      .slice(0, LARGEST);
    return {
      status: 'ok',
      data: { buildDir, totalBytes, files: sizes.length, largest, maxBytes, exceeded },
      findings: exceeded
        ? [{
            code: 'build-size-exceeded',
            message: `Размер сборки ${totalBytes} байт превышает предел ${maxBytes} байт (${options.maxMb} МБ)`,
            severity: 'error',
          }]
        : [],
    };
  };
}
