import type { Status } from './status.js';

export type Zone = 'green' | 'yellow' | 'red';

export interface Score {
  /** null, когда модулей с данными меньше трёх. */
  value: number | null;
  /** Сколько модулей дали данные. */
  known: number;
  /** Сколько модулей запускалось. */
  total: number;
  zone: Zone | null;
}

const WEIGHTS: Record<Exclude<Status, 'no-data'>, number> = { ok: 100, plan: 60, fix: 20 };
const MIN_KNOWN = 3;

export function projectScore(statuses: Status[]): Score {
  const weights = statuses.flatMap((status) => (status === 'no-data' ? [] : [WEIGHTS[status]]));
  const known = weights.length;
  const total = statuses.length;
  if (known < MIN_KNOWN) return { value: null, known, total, zone: null };

  const value = Math.round(weights.reduce((sum, weight) => sum + weight, 0) / known);
  const zone = value >= 90 ? 'green' : value >= 60 ? 'yellow' : 'red';
  return { value, known, total, zone };
}
