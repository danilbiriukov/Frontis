import {
  auditReportSchema,
  commitSchema,
  pluginReportSchema,
  reportSchema,
  type AuditReport,
  type PluginReport,
  type Report,
} from '@code-pushup/models';
import type { ProjectInfo } from '../collectors/project-info.js';
import { codePushUpPackage } from './package-info.js';

interface ReportInput {
  plugins: readonly PluginReport[];
  categories?: Report['categories'];
  commit: NonNullable<ProjectInfo['git']>['commit'];
  runAt: string;
  durationMs: number;
}

function validPlugin(plugin: PluginReport): PluginReport | undefined {
  if (plugin.isSkipped) {
    return undefined;
  }

  const uniqueAudits = new Map<string, AuditReport | undefined>();
  for (const candidate of plugin.audits) {
    const audit = auditReportSchema.safeParse(candidate);
    if (audit.success && !audit.data.isSkipped) {
      const { slug } = audit.data;
      uniqueAudits.set(slug, uniqueAudits.has(slug) ? undefined : audit.data);
    }
  }
  const audits = [...uniqueAudits.values()].filter((audit) => audit !== undefined);
  const auditSlugs = new Set(audits.map(({ slug }) => slug));
  const groups = plugin.groups
    ?.filter(({ isSkipped }) => !isSkipped)
    .map((group) => ({ ...group, refs: group.refs.filter(({ slug }) => auditSlugs.has(slug)) }))
    .filter(({ refs }) => refs.length > 0);

  const validated = pluginReportSchema.safeParse({ ...plugin, audits, groups });
  return validated.success ? validated.data : undefined;
}

export function createReport(input: ReportInput): Report | undefined {
  const uniquePlugins = new Map<string, PluginReport | undefined>();
  for (const candidate of input.plugins) {
    const plugin = validPlugin(candidate);
    if (plugin !== undefined) {
      uniquePlugins.set(plugin.slug, uniquePlugins.has(plugin.slug) ? undefined : plugin);
    }
  }
  const plugins = [...uniquePlugins.values()].filter((plugin) => plugin !== undefined);
  if (plugins.length === 0) {
    return undefined;
  }
  const categories = input.categories
    ?.filter(({ isSkipped }) => !isSkipped)
    .map((category) => ({
      ...category,
      refs: category.refs.filter((ref) => {
        const plugin = uniquePlugins.get(ref.plugin);
        const targets = ref.type === 'audit' ? plugin?.audits : plugin?.groups;
        return targets?.some(({ slug }) => slug === ref.slug) ?? false;
      }),
    }))
    .filter(({ refs }) => refs.length > 0);
  const { name, version } = codePushUpPackage();
  const commit = commitSchema.safeParse(input.commit);
  return reportSchema.parse({
    packageName: name,
    version,
    date: input.runAt,
    duration: input.durationMs,
    plugins,
    categories,
    commit: commit.success ? commit.data : null,
  });
}
