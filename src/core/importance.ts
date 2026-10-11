import type { ModuleName } from './config.js';

export type Importance = 'high' | 'mid' | 'low';

export interface Finding {
  module: ModuleName;
  /** Устойчивый ключ показателя для кода, например 'outdated.major'. */
  metric: string;
  importance: Importance;
  /** Уже отформатированное значение: '9', '63,4%', '9,6 МБ'. */
  current: string;
  /** Уже отформатированная цель: '0', '90%', '5 МБ'. */
  target: string;
  /** Что сделать, без повтора чисел из current и target. */
  description: string;
}

/** Порядок важностей от высокой к низкой. */
export const IMPORTANCE_ORDER: readonly Importance[] = ['high', 'mid', 'low'];
