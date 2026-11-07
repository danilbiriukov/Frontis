import type { AuditReport, Issue } from '@code-pushup/models';
import type { ModuleName, ResolvedConfig, Thresholds } from '../config.js';
import type { Finding, Importance } from '../importance.js';
import type { PluginNoData, PluginProblem } from '../plugin-guard.js';
import type { Score } from '../score.js';
import type { Status } from '../status.js';

export type TIndicatorId = 'outdated' | 'audit' | 'unusedCode' | 'codeQuality' | 'coverage' | 'nodeVersion' | 'buildSize';
export type TCheckId = Exclude<ModuleName, 'project-info'> | 'tests';
export type TResultFact = number | string | boolean | null;

export interface IResultIssue extends Issue {
  audit: string;
  group?: 'prod' | 'dev';
  package?: string;
  level?: string;
  currentVersion?: string;
  targetVersion?: string;
}

export interface IResultDetails {
  issues?: IResultIssue[];
  largestFiles?: { file: string; bytes: number }[];
  rules?: { rule: string; count: number }[];
}

export interface IResultCheck extends Partial<PluginProblem> {
  id: TCheckId;
  status: Status | 'disabled';
  audits: string[];
  facts: Record<string, TResultFact>;
  details?: IResultDetails;
  logFile?: string;
  incomplete?: true;
}

export interface IResultFinding {
  importance: Importance;
  kind: string;
  now: string;
  target: string;
}

export interface IResultIndicator extends Partial<PluginProblem> {
  id: TIndicatorId;
  status: Status;
  audits: string[];
  findings: IResultFinding[];
  checks: IResultCheck[];
  incomplete?: true;
}

interface IProject {
  name: string | null;
  version: string | null;
  branch: string | null;
}

export interface IResultContext {
  toolVersion: string;
  project: IProject;
  modules: ResolvedConfig['modules'];
  thresholds: Thresholds;
  noData: readonly PluginNoData[];
}

export interface FrontisResult {
  schemaVersion: 1;
  tool: { name: 'frontis'; version: string };
  report: { file: 'report.json'; codePushUpVersion: string };
  project: IProject & { commit: string | null };
  runAt: string;
  durationMs: number;
  score: Score;
  indicators: IResultIndicator[];
  recommendations: {
    importance: Importance;
    indicator: TIndicatorId;
    now: string;
    target: string;
    text: string;
  }[];
}

export interface ICheckEvidence {
  plugin: string;
  audits: AuditReport[];
  facts: Record<string, TResultFact | undefined>;
  findings: Finding[];
  details?: IResultDetails;
  problem?: PluginProblem;
  partial?: PluginProblem;
}
