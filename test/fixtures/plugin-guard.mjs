import { spawn } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { CollectorRunError } from '../../dist/index.js';
import { PLUGIN_RESULT_MESSAGE } from '../../dist/core/plugin-guard.js';

const audits = [{ slug: 'findings', title: 'Находки' }];
const auditResult = [{ slug: 'findings', score: 1, value: 0 }];

export async function prepare({ mode, slug }, outputDir) {
  if (mode === 'unavailable') {
    return {
      code: 'tool-unavailable',
      reason: 'Инструмент не найден.',
      action: 'Установите инструмент в проект.',
    };
  }
  const metadata = {
    slug,
    title: 'Контрольный плагин',
    icon: mode === 'invalid' ? 'invalid-icon' : 'file',
    audits: mode === 'missing-audit' ? [...audits, { slug: 'second', title: 'Второй аудит' }] : mode === 'skipped' ? [{ ...audits[0], isSkipped: true }] : audits,
  };
  if (['file-runner', 'outside-output', 'root-output', 'linked-output'].includes(mode)) {
    const protectedDir = join(process.cwd(), 'protected');
    let outputFile = join(outputDir, 'runner', 'audits.json');
    if (mode === 'outside-output') {
      outputFile = join(protectedDir, 'nested', 'audits.json');
    } else if (mode === 'root-output') {
      outputFile = join(outputDir, 'audits.json');
    } else if (mode === 'linked-output') {
      const link = join(outputDir, 'linked');
      await symlink(protectedDir, link, process.platform === 'win32' ? 'junction' : 'dir');
      outputFile = join(link, 'nested', 'audits.json');
    }
    await mkdir(dirname(outputFile), { recursive: true });
    await writeFile(outputFile, JSON.stringify(auditResult));
    return {
      ...metadata,
      runner: {
        command: 'node',
        args: ['--version'],
        outputFile: relative(process.cwd(), outputFile),
      },
    };
  }
  return {
    ...metadata,
    runner: async () => {
      await writeFile(join(outputDir, 'scratch.txt'), 'Временные данные плагина');
      if (mode === 'progress') {
        process.send?.({ progress: 50 });
      }
      if (mode === 'invalid-message') {
        process.send?.({ type: PLUGIN_RESULT_MESSAGE, outcome: { problem: { code: 42 } } });
      }
      if (mode === 'no-result') {
        process.send?.({ progress: 50 }, () => process.exit(0));
        await new Promise(() => {});
      }
      if (mode === 'crash') {
        throw new Error('Техническая ошибка контрольного плагина');
      }
      if (mode === 'collector-error') {
        throw new CollectorRunError({
          status: 'error',
          code: 'collector-failed',
          reason: 'Сборщик завершился с ошибкой.',
          action: 'Проверьте настройки сборщика.',
          cause: new Error('Исходная ошибка сборщика'),
        });
      }
      if (mode === 'hang') {
        const child = spawn(process.execPath, [
          '--input-type=commonjs', '-e',
          "setTimeout(() => require('node:fs').writeFileSync('late.txt', 'late'), 5700)",
        ], { stdio: 'ignore', windowsHide: true });
        console.log(`Запущен дочерний процесс: ${child.pid}`);
        await new Promise(() => {});
      }
      if (mode === 'logged-success') {
        console.log('Технический вывод успешной проверки');
      }
      return auditResult;
    },
  };
}

export function validate(report, { mode, checkedFiles }) {
  if (mode === 'invalidated') {
    report.audits.length = 0;
  }
  if (checkedFiles === 0) {
    return {
      code: 'no-files',
      reason: 'ESLint проверил 0 файлов.',
      action: 'Проверьте шаблоны файлов и настройки ESLint.',
    };
  }
}
