import type { PluginConfig } from '@code-pushup/models';
import { resolve } from 'node:path';
import { createCollectorRunner } from '../collectors/code-pushup.js';
import { createNodeVersionCollector } from '../collectors/node-version.js';
import type { NodeVersionOptions } from '../collectors/node-version.js';
import { toIssues } from './utils/issues.js';

const lagValues = { patch: 1, minor: 2, major: 3 };

export function createNodeVersionPlugin(
  projectDir = process.cwd(),
  options?: NodeVersionOptions,
): PluginConfig {
  const root = resolve(projectDir);
  return {
    slug: 'frontis-node-version',
    title: 'Версия Node.js',
    icon: 'nodejs',
    audits: [
      { slug: 'project-version', title: 'Версия проекта' },
      { slug: 'latest-lts', title: 'Последняя LTS' },
      { slug: 'version-lag', title: 'Отставание от последней LTS' },
    ],
    runner: createCollectorRunner({ projectDir: root }, createNodeVersionCollector(options), ({ data, findings }) => [
      { slug: 'project-version', score: 1, value: 1, displayValue: data.version },
      { slug: 'latest-lts', score: 1, value: 1, displayValue: data.latestLts.version },
      {
        slug: 'version-lag',
        score: data.lag === null ? 1 : 0,
        value: data.lag === null ? 0 : lagValues[data.lag],
        displayValue: data.lag ?? 'Нет',
        details: { issues: toIssues(findings, root) },
      },
    ]),
  };
}

export function prepare(): PluginConfig {
  return createNodeVersionPlugin();
}
