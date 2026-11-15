import type { Issue } from '@code-pushup/models';

export const ISSUE_SEVERITIES = ['error', 'warning', 'info'] as const;

export function issueSeverity({ severity }: Pick<Issue, 'severity'>): typeof ISSUE_SEVERITIES[number] {
  return severity === 'error' || severity === 'warning' ? severity : 'info';
}

export function compareIssueSeverity(a: Issue, b: Issue): number {
  return ISSUE_SEVERITIES.indexOf(issueSeverity(a)) - ISSUE_SEVERITIES.indexOf(issueSeverity(b));
}
