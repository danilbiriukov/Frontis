import type { PluginConfig } from '@code-pushup/models';
import { resolve } from 'node:path';
import { createBuildSizeCollector } from '../collectors/build-size.js';
import type { BuildSizeOptions } from '../collectors/build-size.js';
import { createCollectorRunner } from '../collectors/code-pushup.js';
import { toIssues } from './utils/issues.js';

export function createBuildSizePlugin(
  projectDir = process.cwd(),
  { buildDir = 'dist', maxMb = 5 }: Partial<BuildSizeOptions> = {},
): PluginConfig {
  const root = resolve(projectDir);
  const collect = createBuildSizeCollector({ buildDir: resolve(root, buildDir), maxMb });
  return {
    slug: 'frontis-build-size',
    title: 'Размер сборки',
    icon: 'folder-dist',
    audits: [
      { slug: 'size-bytes', title: 'Размер сборки в байтах' },
      { slug: 'file-count', title: 'Число файлов' },
      { slug: 'limit-bytes', title: 'Предел размера в байтах' },
    ],
    runner: createCollectorRunner({ projectDir: root }, collect, ({ data, findings }) => [
      {
        slug: 'size-bytes',
        score: data.exceeded ? 0 : 1,
        value: data.totalBytes,
        details: {
          issues: toIssues(findings, root),
          table: {
            title: 'Крупнейшие файлы',
            columns: [{ key: 'file', label: 'Файл' }, { key: 'bytes', label: 'Байты', align: 'right' }],
            rows: data.largest,
          },
        },
      },
      { slug: 'file-count', score: 1, value: data.files },
      { slug: 'limit-bytes', score: 1, value: data.maxBytes },
    ]),
  };
}

export function prepare(options: BuildSizeOptions): PluginConfig {
  return createBuildSizePlugin(process.cwd(), options);
}
