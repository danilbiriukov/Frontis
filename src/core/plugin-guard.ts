import type { PluginConfig, PluginReport } from '@code-pushup/models';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { CollectorFailure } from '../collectors/index.js';
import type { ResolvedModuleConfig } from './config.js';

export interface GuardedPlugin extends ResolvedModuleConfig {
  slug: string;
  /** Имя npm-пакета или абсолютный file URL модуля с фабрикой. */
  module: string;
  options?: unknown;
}

export type PluginProblem = Pick<CollectorFailure, 'code' | 'reason' | 'action'>;
type Awaitable<T> = T | Promise<T>;

export interface GuardedPluginModule<TOptions = unknown> {
  prepare(options: TOptions, outputDir: string): Awaitable<PluginConfig | PluginProblem>;
  validate?(report: PluginReport, options: TOptions, outputDir: string): Awaitable<PluginProblem | undefined>;
}

export interface PluginRequest {
  module: string;
  options: unknown;
  outputDir: string;
  temporaryGit: boolean;
}

export type PluginOutcome = { report: PluginReport } | {
  problem: PluginProblem;
  diagnostic?: string;
};

export interface PluginNoData extends PluginProblem {
  plugin: string;
  logFile?: string;
}

const execFileAsync = promisify(execFile);
const WORKER = new URL('./plugin-worker.js', import.meta.url);
const MAX_OUTPUT = 64 * 1024;

function failed(diagnostic: string): PluginOutcome {
  return {
    problem: {
      code: 'plugin-error',
      reason: 'Плагин завершился с ошибкой.',
      action: 'Проверьте технический журнал и настройки инструмента.',
    },
    diagnostic,
  };
}

async function stopProcessTree(child: ChildProcess): Promise<string | undefined> {
  if (child.pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 5000,
      });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH' || child.exitCode !== null) {
      return;
    }
    child.kill('SIGKILL');
    return `Не удалось остановить дерево процессов: ${String(error)}`;
  }
}

async function prepareGitEnvironment(projectDir: string, workDir: string): Promise<NodeJS.ProcessEnv | undefined> {
  const options = { cwd: projectDir, timeout: 5000, windowsHide: true };
  try {
    await execFileAsync('git', ['rev-parse', '--show-toplevel'], options);
    return undefined;
  } catch (error) {
    if ((error as { code?: number | string }).code !== 128) {
      return undefined;
    }
  }

  // Code PushUp требует корень Git даже для аудитов без файлов.
  const env = { ...process.env, GIT_DIR: join(workDir, 'git'), GIT_WORK_TREE: projectDir };
  await execFileAsync('git', ['init', '--template='], { ...options, env });
  return env;
}

async function runPlugin(
  task: GuardedPlugin,
  projectDir: string,
  outputDir: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<PluginOutcome> {
  let child: ChildProcess;
  try {
    child = fork(WORKER, {
      cwd: projectDir,
      env,
      detached: process.platform !== 'win32',
      windowsHide: true,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  } catch (error) {
    return failed(String(error));
  }
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8').on('data', (chunk: string) => {
      output = (output + chunk).slice(-MAX_OUTPUT);
    });
  }

  let result: PluginOutcome | undefined;
  let processError: Error | undefined;
  child.once('message', (message: PluginOutcome) => {
    result = message;
  });
  const completion = new Promise<PluginOutcome>((complete) => {
    child.on('error', (error) => {
      processError = error;
    });
    child.once('close', (code, signal) => {
      if (code === 0 && result !== undefined) {
        complete(result);
      } else {
        complete(failed(
          processError?.stack ?? `Процесс плагина завершился: ${signal ?? code ?? 'неизвестный код'}.`,
        ));
      }
    });
  });
  const request: PluginRequest = {
    module: task.module,
    options: task.options,
    outputDir,
    temporaryGit: env !== undefined,
  };
  try {
    child.send(request);
  } catch (error) {
    const stopError = await stopProcessTree(child);
    return failed([String(error), stopError].filter(Boolean).join('\n'));
  }

  const timer = new AbortController();
  const deadline = setTimeout(task.timeoutMs, undefined, { signal: timer.signal });
  let outcome = await Promise.race([completion, deadline]);
  timer.abort();
  if (outcome === undefined) {
    const stopError = await stopProcessTree(child);
    child.stdout?.destroy();
    child.stderr?.destroy();
    if (child.connected) {
      child.disconnect();
    }
    child.unref();
    outcome = {
      problem: {
        code: 'timeout',
        reason: `Плагин не завершился за ${task.timeoutMs} мс.`,
        action: 'Проверьте работу инструмента или увеличьте timeoutMs для модуля.',
      },
      diagnostic: [processError?.stack, stopError].filter(Boolean).join('\n'),
    };
  }
  if ('problem' in outcome) {
    return { ...outcome, diagnostic: [outcome.diagnostic, output.trimEnd()].filter(Boolean).join('\n') };
  }
  return outcome;
}

export async function runGuardedPlugins(
  projectDir: string,
  plugins: readonly GuardedPlugin[],
  preflight: readonly PluginNoData[] = [],
): Promise<{ reports: PluginReport[]; noData: PluginNoData[] }> {
  const root = resolve(projectDir);
  const outputDir = join(root, '.frontis');
  const id = randomUUID();
  const logFile = `logs/${id}.log`;
  const log: string[] = [];
  const reports: PluginReport[] = [];
  const noData = [...preflight];

  await mkdir(outputDir, { recursive: true });
  const workDir = await mkdtemp(join(outputDir, 'work-'));
  try {
    const env = plugins.some(({ enabled }) => enabled) ? await prepareGitEnvironment(root, workDir) : undefined;
    for (const [index, plugin] of plugins.entries()) {
      if (!plugin.enabled) {
        noData.push({
          plugin: plugin.slug,
          code: 'disabled',
          reason: 'Плагин отключён в конфигурации.',
          action: 'Включите модуль, если нужна эта проверка.',
        });
        continue;
      }
      const pluginDir = join(workDir, String(index));
      await mkdir(pluginDir);
      const outcome = await runPlugin(plugin, root, pluginDir, env);
      if ('report' in outcome) {
        reports.push(outcome.report);
      } else {
        const { code, reason, action } = outcome.problem;
        noData.push({ plugin: plugin.slug, code, reason, action, logFile });
        log.push(`[${plugin.slug}] ${code}: ${reason}`);
        if (outcome.diagnostic) {
          log.push(outcome.diagnostic);
        }
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true, maxRetries: 2 });
  }

  if (log.length > 0) {
    await mkdir(join(outputDir, 'logs'), { recursive: true });
    await writeFile(join(outputDir, logFile), `${log.join('\n')}\n`);
  }
  const temporary = join(outputDir, `no-data.${id}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(noData, null, 2)}\n`);
    await rename(temporary, join(outputDir, 'no-data.json'));
  } finally {
    await rm(temporary, { force: true });
  }
  return { reports, noData };
}
