import type { Importance } from '../core/importance.js';
import type { Zone } from '../core/score.js';
import type { Status } from '../core/status.js';
import type { TCheckId, TIndicatorId } from '../core/types/result.js';

export const INDICATOR_TITLES: Record<TIndicatorId, string> = {
  outdated: 'Устаревшие зависимости',
  audit: 'Уязвимости зависимостей',
  unusedCode: 'Неиспользуемый код',
  codeQuality: 'Качество кода',
  coverage: 'Тесты и покрытие',
  nodeVersion: 'Версия Node.js',
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
  ok: 'Действий не требуется',
  plan: 'Запланировать',
  fix: 'Исправить',
  'no-data': 'Нет данных',
  disabled: 'Отключено',
};

export const STATUS_ICONS: Record<Status | 'disabled', string> = {
  ok: '✓',
  plan: '◷',
  fix: '⚠',
  'no-data': '⊘',
  disabled: '—',
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  high: 'Высокая',
  mid: 'Средняя',
  low: 'Низкая',
};

export const ZONE_LABELS: Record<Zone, string> = {
  green: 'Хорошее состояние',
  yellow: 'Требуются плановые работы',
  red: 'Требуются срочные исправления',
};
