import { STATUS_LABELS as CORE_STATUS_LABELS } from '../core/labels.js';
import type { Zone } from '../core/score.js';
import type { Status } from '../core/status.js';
import type { TCheckId, TIndicatorId } from '../core/types/result.js';

export const INDICATOR_TITLES: Record<TIndicatorId, string> = {
  outdated: 'Устаревшие зависимости',
  audit: 'Уязвимости',
  unusedCode: 'Неиспользуемый код',
  codeQuality: 'Качество кода',
  coverage: 'Покрытие тестами',
  nodeVersion: 'Node.js',
  buildSize: 'Размер сборки',
};

export const CHECK_TITLES: Record<TCheckId, string> = {
  outdated: 'Устаревшие зависимости (npm outdated)',
  audit: 'Уязвимости (npm audit)',
  knip: 'Неиспользуемый код (knip)',
  lint: 'Линтер (ESLint)',
  prettier: 'Форматирование (Prettier)',
  coverage: 'Покрытие кода (LCOV)',
  tests: 'Итоги тестов (Jest / Vitest)',
  'node-version': 'Версия Node.js против LTS',
  'build-size': 'Размер каталога сборки',
};

export const STATUS_LABELS: Record<Status | 'disabled', string> = {
  ...CORE_STATUS_LABELS,
  disabled: 'Отключено',
};

export const STATUS_ICONS: Record<Status | 'disabled', string> = {
  ok: '<path d="m3 8 3 3 7-7"/>',
  plan: '<path d="M8 2 1.5 13.5h13L8 2Zm0 4v3m0 2v.2"/>',
  fix: '<path d="m4.5 4.5 7 7m0-7-7 7"/>',
  'no-data': '<circle cx="8" cy="8" r="5.6"/><path d="M5.5 8h5"/>',
  disabled: '<path d="M4 8h8"/>',
};

export { IMPORTANCE_LABELS } from '../core/labels.js';

export const ZONE_LABELS: Record<Zone, string> = {
  green: 'Хорошее состояние',
  yellow: 'Требуются плановые работы',
  red: 'Требуются срочные исправления',
};
