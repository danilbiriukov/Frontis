import type { Finding } from './importance.js';

export type Status = 'ok' | 'plan' | 'fix' | 'no-data';

/**
 * Статус модуля по его находкам. Низкая важность статус не портит.
 * Модули без данных сюда не передаются: их статус no-data задаётся сразу.
 */
export function resolveStatus(findings: Finding[]): Status {
  if (findings.some((finding) => finding.importance === 'high')) return 'fix';
  if (findings.some((finding) => finding.importance === 'mid')) return 'plan';
  return 'ok';
}
