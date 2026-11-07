import { MAX_ISSUE_MESSAGE_LENGTH } from '@code-pushup/models';
import type { AuditOutput, Issue } from '@code-pushup/models';
import { resolve } from 'node:path';
import type { CollectorFinding } from '../../collectors/index.js';

export function toIssues(findings: readonly CollectorFinding[], projectDir: string): Issue[] {
  return findings.map(({ message, severity, source }) => ({
    message: message.slice(0, MAX_ISSUE_MESSAGE_LENGTH),
    severity,
    ...(source === undefined ? {} : { source: { ...source, file: resolve(projectDir, source.file) } }),
  }));
}

export function countIssues(
  slug: string,
  findings: readonly CollectorFinding[],
  projectDir: string,
): AuditOutput {
  return {
    slug,
    score: findings.length === 0 ? 1 : 0,
    value: findings.length,
    details: { issues: toIssues(findings, projectDir) },
  };
}
