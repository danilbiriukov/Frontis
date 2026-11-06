export interface CollectorContext {
  /** Абсолютный путь к проверяемому проекту. */
  projectDir: string;
  signal?: AbortSignal;
}

export interface CollectorFinding {
  /** Стабильный код типа находки, например unused-export. */
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  source?: {
    /** Путь от корня проверяемого проекта. */
    file: string;
    position?: {
      /** Нумерация строк и столбцов начинается с 1. */
      startLine: number;
      startColumn?: number;
    };
  };
}

export interface CollectorSuccess<TData> {
  status: 'ok';
  data: TData;
  findings: readonly CollectorFinding[];
}

export interface CollectorFailure {
  status: 'no-data' | 'error';
  code: string;
  reason: string;
  action: string;
  cause?: unknown;
}

export type CollectorResult<TData> = CollectorSuccess<TData> | CollectorFailure;

export type Collector<TData> = (
  context: CollectorContext,
) => CollectorResult<TData> | Promise<CollectorResult<TData>>;
