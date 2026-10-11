import { MODULE_NAMES, type ModuleName } from './config.js';
import { IMPORTANCE_ORDER, type Finding } from './importance.js';

/** Модуль, который не дал данных. Важности не имеет и в оценку проекта не входит. */
export interface NoData {
  module: ModuleName;
  /** Почему данных нет. */
  reason: string;
  /** Что сделать. */
  action: string;
}

/**
 * Список рекомендаций: по важности от высокой к низкой, внутри важности —
 * в порядке MODULE_NAMES. Сортировка устойчивая, порядок находок одного
 * модуля сохраняется.
 */
export function buildRecommendations(findings: Finding[]): Finding[] {
  return findings
    .filter((finding) => finding.current !== finding.target)
    .sort(
      (a, b) =>
        IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance) ||
        MODULE_NAMES.indexOf(a.module) - MODULE_NAMES.indexOf(b.module),
    );
}
