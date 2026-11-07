import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectProjectInfo } from '../collectors/project-info.js';
import { findConfigFile, loadConfigFile } from './config-file.js';
import { FRONTIS_OUTPUT_DIR, MODULE_NAMES, resolveConfig } from './config.js';
import type { ModuleName, ResolvedConfig } from './config.js';
import type { GuardedPlugin, PluginNoData, PluginProblem } from './plugin-guard.js';
import type { IEngineConfig, TEngineAdapters } from './types/engine-config.js';

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc',
];
const LCOV_REPORTS = ['coverage/lcov.info', 'lcov.info'] as const;

const disabled: PluginProblem = {
  code: 'disabled',
  reason: 'Плагин отключён в конфигурации.',
  action: 'Включите модуль, если нужна эта проверка.',
};
const adapterUnavailable: PluginProblem = {
  code: 'adapter-unavailable',
  reason: 'Адаптер Code PushUp для модуля не подключён.',
  action: 'Подключите адаптер при подготовке запуска Frontis.',
};

async function findProjectFile(projectDir: string, names: readonly string[]): Promise<string | null> {
  for (const name of names) {
    const file = join(projectDir, name);
    if ((await stat(file).catch(() => undefined))?.isFile()) {
      return file;
    }
  }
  return null;
}

export async function createEngineConfig(
  config: ResolvedConfig,
  adapters: TEngineAdapters = {},
): Promise<IEngineConfig> {
  const { projectDir, buildDir, testCommand, thresholds } = config;
  const [projectInfo, eslintrc, lcovFile, buildStats] = await Promise.all([
    collectProjectInfo({ projectDir }),
    findProjectFile(projectDir, ESLINT_CONFIGS),
    findProjectFile(projectDir, LCOV_REPORTS),
    stat(buildDir).catch(() => undefined),
  ]);
  const metadata = projectInfo.status === 'ok' ? projectInfo.data : undefined;
  const packageManager = metadata?.packageManager?.name;
  const options: Record<ModuleName, unknown> = {
    'project-info': metadata,
    outdated: { packageManager },
    audit: { packageManager },
    knip: undefined,
    lint: { eslintrc },
    prettier: undefined,
    coverage: {
      reports: [lcovFile ?? join(projectDir, LCOV_REPORTS[0])],
      testCommand: lcovFile === null ? testCommand : undefined,
    },
    'node-version': undefined,
    'build-size': { buildDir, maxMb: thresholds.buildSize.maxMb },
  };

  const problems: Partial<Record<ModuleName, PluginProblem>> = {};
  if (projectInfo.status !== 'ok') {
    problems['project-info'] = projectInfo;
  }
  if (packageManager === undefined) {
    const problem = problems['project-info'] ?? {
      code: 'no-package-manager',
      reason: 'Не удалось определить менеджер пакетов.',
      action: 'Укажите packageManager в package.json или создайте lock-файл.',
    };
    problems.outdated = problem;
    problems.audit = problem;
  }
  if (eslintrc === null) {
    problems.lint = {
      code: 'no-eslint-config',
      reason: 'В корне проекта не найден файл конфигурации ESLint.',
      action: 'Добавьте конфигурацию ESLint в корень проекта.',
    };
  }
  if (lcovFile === null && testCommand === undefined) {
    problems.coverage = {
      code: 'no-lcov',
      reason: 'Нет отчёта LCOV и команды для его создания.',
      action: 'Создайте coverage/lcov.info или укажите testCommand в frontis.config.',
    };
  }
  if (!buildStats?.isDirectory()) {
    problems['build-size'] = {
      code: 'no-build-dir',
      reason: `Не найдена доступная папка сборки ${buildDir}.`,
      action: 'Соберите проект или укажите путь в buildDir в frontis.config.',
    };
  }

  const plugins: GuardedPlugin[] = [];
  const noData: PluginNoData[] = [];
  for (const name of MODULE_NAMES) {
    const settings = config.modules[name];
    const adapter = adapters[name];
    const problem = settings.enabled ? problems[name] : disabled;
    if (problem !== undefined || adapter === undefined) {
      const { code, reason, action } = problem ?? adapterUnavailable;
      noData.push({ plugin: name, code, reason, action });
    } else {
      plugins.push({ ...settings, slug: name, module: adapter, options: options[name] });
    }
  }

  return { config, projectInfo, outputDir: join(projectDir, FRONTIS_OUTPUT_DIR), plugins, noData };
}

export async function loadEngineConfig(cwd: string, adapters?: TEngineAdapters) {
  const configPath = findConfigFile(cwd);
  const config = resolveConfig(await loadConfigFile(configPath), configPath);
  return { configPath, ...await createEngineConfig(config, adapters) };
}
