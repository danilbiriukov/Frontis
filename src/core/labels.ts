import type { Importance } from './importance.js';
import type { Status } from './status.js';

// Единственное место, где статусы и важности превращаются в текст:
// консоль и отчёт берут подписи отсюда
export const STATUS_LABELS: Record<Status, string> = {
  ok: 'Действий не требуется',
  plan: 'Запланировать',
  fix: 'Исправить',
  'no-data': 'Нет данных',
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  high: 'Высокая',
  mid: 'Средняя',
  low: 'Низкая',
};
