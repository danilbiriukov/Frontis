import type { PluginConfig } from '@code-pushup/models';
import { resolve } from 'node:path';
import { createCollectorRunner } from '../collectors/code-pushup.js';
import type { CollectorFinding } from '../collectors/index.js';
import { collectKnip } from '../collectors/knip.js';
import { countIssues } from './utils/issues.js';

const audits = [
  { slug: 'unused-files', title: 'Неиспользуемые файлы' },
  { slug: 'unused-dependencies', title: 'Неиспользуемые зависимости' },
  { slug: 'unused-exports', title: 'Неиспользуемые экспорты' },
  { slug: 'unused-types', title: 'Неиспользуемые типы' },
  { slug: 'other-findings', title: 'Другие находки knip' },
] as const;

const auditByCode = new Map<string, (typeof audits)[number]['slug']>([
  ['unused-file', 'unused-files'],
  ['unused-dependency', 'unused-dependencies'],
  ['unused-dev-dependency', 'unused-dependencies'],
  ['unused-optional-peer-dependency', 'unused-dependencies'],
  ['unused-export', 'unused-exports'],
  ['unused-namespace-export', 'unused-exports'],
  ['unused-type', 'unused-types'],
  ['unused-namespace-type', 'unused-types'],
]);

export function createKnipPlugin(projectDir = process.cwd()): PluginConfig {
  const root = resolve(projectDir);
  return {
    slug: 'frontis-knip',
    title: 'knip',
    icon: 'knip',
    audits: [...audits],
    runner: createCollectorRunner({ projectDir: root }, collectKnip, ({ findings }) => {
      const byAudit: Record<(typeof audits)[number]['slug'], CollectorFinding[]> = {
        'unused-files': [],
        'unused-dependencies': [],
        'unused-exports': [],
        'unused-types': [],
        'other-findings': [],
      };
      for (const finding of findings) {
        const slug = auditByCode.get(finding.code) ?? 'other-findings';
        byAudit[slug].push(finding);
      }
      return audits.map(({ slug }) => countIssues(slug, byAudit[slug], root));
    }),
  };
}

export function prepare(): PluginConfig {
  return createKnipPlugin();
}
