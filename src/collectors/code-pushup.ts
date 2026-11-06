import type { AuditOutput, RunnerFunction } from '@code-pushup/models';
import type { Collector, CollectorContext, CollectorFailure, CollectorSuccess } from './index.js';

export class CollectorRunError extends Error {
  constructor(readonly result: CollectorFailure) {
    super(result.reason, { cause: result.cause });
    this.name = 'CollectorRunError';
  }
}

export function createCollectorRunner<TData>(
  context: CollectorContext,
  collect: Collector<TData>,
  toAudits: (result: CollectorSuccess<TData>) => AuditOutput[],
): RunnerFunction {
  return async () => {
    const result = await collect(context);
    if (result.status !== 'ok') {
      throw new CollectorRunError(result);
    }
    return toAudits(result);
  };
}
