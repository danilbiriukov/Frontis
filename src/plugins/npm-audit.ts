import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginConfig, RunnerFunction } from '@code-pushup/models';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { PluginProblem } from '../core/plugin-guard.js';
import { createNpmPackagesPlugin } from './js-packages.js';
import { npmInProject } from './npm-process.js';

const noLock: PluginProblem = {
  code: 'no-npm-lockfile',
  reason: 'Для npm audit нужен package-lock.json или npm-shrinkwrap.json.',
  action: 'Создайте lock-файл npm и повторите проверку.',
};
const registryUnavailable: PluginProblem = {
  code: 'registry-unavailable',
  reason: 'Реестр npm не предоставил данные об уязвимостях.',
  action: 'Проверьте подключение к реестру и поддержку npm audit.',
};
const auditFailed: PluginProblem = {
  code: 'npm-audit-failed',
  reason: 'npm audit не вернул пригодный отчёт.',
  action: 'Проверьте настройки npm, lock-файл и технический журнал.',
};
const registryError = /^(?:E[45]\d{2}|EAUDITNOAUDIT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ENOTCACHED)$/;

function npmAuditProblem(cause: unknown): PluginProblem {
  const { stdout, stderr } = (cause ?? {}) as { stdout?: string; stderr?: string };
  if (typeof stdout === 'string') {
    try {
      const output = JSON.parse(stdout) as { method?: string; error?: { code?: string } } | null;
      const code = output?.error?.code;
      if (code === 'ENOLOCK') {
        return noLock;
      }
      if (output?.method === 'POST' || (typeof code === 'string' && registryError.test(code))) {
        return registryUnavailable;
      }
    } catch {
      // npm иногда пишет диагностику только в stderr.
    }
  }
  if (typeof stderr === 'string' && /audit endpoint returned an error/i.test(stderr)) {
    return registryUnavailable;
  }
  return auditFailed;
}

export async function prepare(options: { packageManager?: string }, outputDir: string): Promise<PluginConfig | PluginProblem> {
  if (options.packageManager !== 'npm') {
    return {
      code: 'unsupported-package-manager',
      reason: 'Проверка уязвимостей подключена для npm.',
      action: 'Для этой проверки используйте проект с npm и его lock-файлом.',
    };
  }
  const projectDir = process.cwd();
  const locks = await Promise.all(['package-lock.json', 'npm-shrinkwrap.json'].map((file) =>
    stat(join(projectDir, file)).catch(() => undefined)
  ));
  if (!locks.some((file) => file?.isFile())) {
    return noLock;
  }

  const npm = npmInProject(projectDir, outputDir);
  try {
    const offline = await npm(['config', 'get', 'offline']);
    if (offline.code !== 0) {
      return auditFailed;
    }
    if (offline.stdout.trim() === 'true') {
      return registryUnavailable;
    }
    const plugin = await createNpmPackagesPlugin('audit');
    const runner = plugin.runner as RunnerFunction;
    return {
      ...plugin,
      runner: async (context) => {
        try {
          return await runner(context);
        } catch (cause) {
          throw new CollectorRunError({ status: 'error', ...npmAuditProblem(cause), cause });
        }
      },
    };
  } catch (cause) {
    throw new CollectorRunError({ status: 'error', ...auditFailed, cause });
  }
}
