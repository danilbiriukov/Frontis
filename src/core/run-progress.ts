import type { TPluginProgress, TPluginStatus } from './types/run.js';

const labels: Record<TPluginStatus, string> = {
  waiting: 'ожидает',
  running: 'запущен',
  done: 'готово',
  error: 'ошибка',
  'no-data': 'нет данных',
};

const colors: Record<TPluginStatus, number> = {
  waiting: 90,
  running: 36,
  done: 32,
  error: 31,
  'no-data': 33,
};

export function createRunProgress() {
  const interactive = process.stdout.isTTY && process.env.CI === undefined && process.env.NO_COLOR === undefined;
  const counts = { done: 0, error: 0, 'no-data': 0 };
  const update: TPluginProgress = (plugin, status) => {
    if (status === 'done' || status === 'error' || status === 'no-data') {
      counts[status]++;
    }
    const label = labels[status];
    console.log(`[${plugin}] ${interactive ? `\x1b[${colors[status]}m${label}\x1b[0m` : label}`);
  };
  return {
    update,
    summary(audits: number) {
      console.log(
        `Аудиты Frontis: ${audits}. Модули без данных: ${counts['no-data']}. Успешные проверки: ${counts.done}. Ошибки: ${counts.error}.`,
      );
    },
  };
}
