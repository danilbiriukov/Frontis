import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CollectorRunError } from '../../dist/index.js';

export function prepare({ mode, slug }, outputDir) {
  if (mode === 'unavailable') {
    return {
      code: 'tool-unavailable',
      reason: 'Инструмент не найден.',
      action: 'Установите инструмент в проект.',
    };
  }
  return {
    slug,
    title: 'Контрольный плагин',
    icon: mode === 'invalid' ? 'invalid-icon' : 'file',
    audits: [{ slug: 'findings', title: 'Находки' }],
    runner: async () => {
      await writeFile(join(outputDir, 'scratch.txt'), 'Временные данные плагина');
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
          "setTimeout(() => require('node:fs').writeFileSync('late.txt', 'late'), 2200)",
        ], { stdio: 'ignore', windowsHide: true });
        console.log(`Запущен дочерний процесс: ${child.pid}`);
        await new Promise(() => {});
      }
      return [{ slug: 'findings', score: 1, value: 0 }];
    },
  };
}

export function validate(_report, { checkedFiles }) {
  if (checkedFiles === 0) {
    return {
      code: 'no-files',
      reason: 'ESLint проверил 0 файлов.',
      action: 'Проверьте шаблоны файлов и настройки ESLint.',
    };
  }
}
