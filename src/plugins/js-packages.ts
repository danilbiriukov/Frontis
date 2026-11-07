import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import jsPackagesPlugin from '@code-pushup/js-packages-plugin';
import { npmToOutdatedResult } from '@code-pushup/js-packages-plugin/src/lib/package-managers/npm/outdated-result.js';
import { outdatedResultToAuditOutput } from '@code-pushup/js-packages-plugin/src/lib/runner/outdated/transform.js';
import type { OutdatedDependency } from '@code-pushup/js-packages-plugin/src/lib/runner/outdated/types.js';
import type { PluginConfig } from '@code-pushup/models';
import semver from 'semver';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { PluginProblem } from '../core/plugin-guard.js';
import { OUTDATED_EVIDENCE_AUDIT } from './js-packages-contract.js';
import { npmInProject } from './npm-process.js';

const groups = { prod: 'dependencies', dev: 'devDependencies' } as const;
type Group = keyof typeof groups;
const groupNames = ['prod', 'dev'] as const;
const npmOptions = {
  packageManager: 'npm',
  dependencyGroups: [...groupNames],
  auditLevelMapping: { critical: 'error', high: 'error', moderate: 'warning', low: 'info', info: 'info' },
} satisfies NonNullable<Parameters<typeof jsPackagesPlugin>[0]>;

export function createNpmPackagesPlugin(check: 'audit' | 'outdated'): Promise<PluginConfig> {
  return jsPackagesPlugin({ ...npmOptions, checks: [check] });
}
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const distTag = /^[a-z][a-z0-9._-]*$/i;
const registryUnavailable: PluginProblem = {
  code: 'registry-unavailable',
  reason: 'Не удалось подтвердить метаданные зависимостей из npm-реестра.',
  action: 'Проверьте доступ к реестру из настроек проекта и запустите проверку снова.',
};

interface Dependency {
  name: string;
  group: Group;
  current: string;
}

interface CheckedDependency extends Dependency {
  verified: boolean;
  outdated?: OutdatedDependency;
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function installedVersion(projectDir: string, name: string): Promise<string | null> {
  try {
    const manifest = fields(JSON.parse(await readFile(join(projectDir, 'node_modules', name, 'package.json'), 'utf8')));
    return typeof manifest.version === 'string' ? semver.valid(manifest.version) : null;
  } catch {
    return null;
  }
}

async function comparableDependencies(projectDir: string): Promise<Dependency[]> {
  const manifest = fields(JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8')));
  const production = fields(manifest.dependencies);
  const optional = fields(manifest.optionalDependencies);
  const candidates = groupNames.flatMap((group) => Object.entries(fields(manifest[groups[group]])).flatMap(([name, spec]) => {
    if (!packageName.test(name) || typeof spec !== 'string' ||
      (semver.validRange(spec) === null && !distTag.test(spec)) ||
      Object.hasOwn(optional, name) || (group === 'dev' && Object.hasOwn(production, name))) {
      return [];
    }
    return [{ name, group }];
  }));
  const installed = await Promise.all(candidates.map(async (candidate) => {
    const current = await installedVersion(projectDir, candidate.name);
    return current === null ? undefined : { ...candidate, current };
  }));
  return installed.filter((dependency) => dependency !== undefined);
}

function version(value: unknown): string | null {
  return typeof value === 'string' ? semver.valid(value) : null;
}

function normalizeOutdated(stdout: string): Map<string, OutdatedDependency> {
  const parsed: unknown = JSON.parse(stdout);
  const diagnostic = fields(fields(parsed).error);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || typeof diagnostic.code === 'string') {
    throw new Error('npm outdated вернул непригодный JSON.');
  }
  return new Map(npmToOutdatedResult(stdout).map((entry) => [entry.name, entry]));
}

async function verifyDependencies(
  dependencies: Dependency[],
  listed: Map<string, OutdatedDependency>,
  npm: ReturnType<typeof npmInProject>,
): Promise<CheckedDependency[]> {
  const results: CheckedDependency[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, dependencies.length) }, async () => {
    while (next < dependencies.length) {
      const item = dependencies[next++];
      const row = listed.get(item.name);
      const latest = version(row?.latest);
      if (row?.type === groups[item.group] && version(row.current) === item.current && latest !== null) {
        const outdated = semver.lt(item.current, latest)
          ? { ...row, current: item.current, latest, url: typeof row.url === 'string' ? row.url : undefined }
          : undefined;
        results.push({ ...item, verified: true, outdated });
        continue;
      }
      let published: string | null = null;
      try {
        const check = await npm(['view', item.name, 'version', '--json', '--prefer-online', '--fetch-retries=0']);
        published = check.code === 0 ? version(JSON.parse(check.stdout)) : null;
      } catch {
        // npm outdated может опустить пакет при ошибке получения метаданных.
      }
      const outdated = published !== null && semver.lt(item.current, published)
        ? { name: item.name, current: item.current, latest: published, type: groups[item.group] }
        : undefined;
      results.push({ ...item, verified: published !== null, outdated });
    }
  }));
  return results.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export async function prepare(options: { packageManager?: string }, outputDir: string): Promise<PluginConfig | PluginProblem> {
  if (options.packageManager !== 'npm') {
    return {
      code: 'unsupported-package-manager',
      reason: 'Проверка устаревших зависимостей подключена для npm.',
      action: 'Для этой проверки используйте проект с npm и его lock-файлом.',
    };
  }
  const projectDir = process.cwd();
  try {
    const dependencies = await comparableDependencies(projectDir);
    if (dependencies.length === 0) {
      return {
        code: 'no-comparable-dependencies',
        reason: 'Нет установленных зависимостей npm с сопоставимыми версиями.',
        action: 'Установите зависимости проекта и проверьте package.json.',
      };
    }
    const npm = npmInProject(projectDir, outputDir);
    const response = await npm(['outdated', '--long', '--json', '--include=prod', '--include=dev', '--omit=optional',
      '--prefer-online', '--fetch-retries=0']);
    let listed = new Map<string, OutdatedDependency>();
    if (response.code === 0 || response.code === 1) {
      try {
        listed = normalizeOutdated(response.stdout);
      } catch {
        // Проверим пакеты по отдельности, если общий вызов не вернул пригодный список.
      }
    }
    const checked = await verifyDependencies(dependencies, listed, npm);
    if (!checked.some(({ verified }) => verified)) {
      return registryUnavailable;
    }
    const evidence = groupNames.map((group) => {
      const candidates = checked.filter((item) => item.group === group);
      const comparable = candidates.length;
      const state = comparable === 0 ? 'empty' : candidates.every(({ verified }) => verified) ? 'verified' : 'unconfirmed';
      return { group, comparable, state };
    });
    const audits = evidence.flatMap(({ group, comparable, state }) => {
      const outdated = checked.flatMap((item) => item.group === group && item.outdated !== undefined ? [item.outdated] : []);
      return state === 'verified' || outdated.length > 0
        ? [outdatedResultToAuditOutput(outdated, 'npm', group, comparable)]
        : [];
    });
    if (audits.length === 0) {
      return registryUnavailable;
    }
    const plugin = await createNpmPackagesPlugin('outdated');
    const slugs = new Set(audits.map(({ slug }) => slug));
    return {
      ...plugin,
      audits: [
        ...plugin.audits.filter(({ slug }) => slugs.has(slug)),
        { slug: OUTDATED_EVIDENCE_AUDIT, title: 'Проверка метаданных npm' },
      ],
      groups: plugin.groups?.map((group) => ({
        ...group, refs: group.refs.filter(({ slug }) => slugs.has(slug)),
      })).filter(({ refs }) => refs.length > 0),
      runner: async () => [
        ...audits,
        {
          slug: OUTDATED_EVIDENCE_AUDIT, score: 1, value: 1,
          details: { table: {
            columns: [
              { key: 'group', label: 'Группа' }, { key: 'comparable', label: 'Сопоставимые зависимости' },
              { key: 'state', label: 'Метаданные' },
            ],
            rows: evidence,
          } },
        },
      ],
    };
  } catch (cause) {
    throw new CollectorRunError({
      status: 'error',
      code: 'outdated-failed',
      reason: 'Не удалось проверить устаревшие зависимости npm.',
      action: 'Проверьте настройки npm и технический журнал.',
      cause,
    });
  }
}
