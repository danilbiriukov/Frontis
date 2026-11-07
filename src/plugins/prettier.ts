import type { PluginConfig } from '@code-pushup/models';
import { resolve } from 'node:path';
import { createCollectorRunner } from '../collectors/code-pushup.js';
import { collectPrettier } from '../collectors/prettier.js';
import { countIssues } from './utils/issues.js';

export function createPrettierPlugin(projectDir = process.cwd()): PluginConfig {
  const root = resolve(projectDir);
  return {
    slug: 'frontis-prettier',
    title: 'Prettier',
    icon: 'prettier',
    audits: [
      { slug: 'checked-files', title: 'Проверенные файлы' },
      { slug: 'unformatted-files', title: 'Файлы, которым нужно форматирование' },
      { slug: 'parse-errors', title: 'Ошибки разбора файлов' },
    ],
    runner: createCollectorRunner({ projectDir: root }, collectPrettier, ({ data, findings }) => [
      { slug: 'checked-files', score: 1, value: data.checkedFiles },
      countIssues('unformatted-files', findings.filter(({ code }) => code === 'unformatted-file'), root),
      countIssues('parse-errors', findings.filter(({ code }) => code === 'prettier-error'), root),
    ]),
  };
}

export function prepare(): PluginConfig {
  return createPrettierPlugin();
}
