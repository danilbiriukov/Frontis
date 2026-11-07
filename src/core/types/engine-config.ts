import type { CollectorResult } from '../../collectors/index.js';
import type { ProjectInfo } from '../../collectors/project-info.js';
import type { ModuleName, ResolvedConfig } from '../config.js';
import type { GuardedPlugin, PluginNoData } from '../plugin-guard.js';

/** Имена пакетов или абсолютные file: URL модулей с фабрикой prepare. */
export type TEngineAdapters = Partial<Record<ModuleName, string>>;

export interface IEngineConfig {
  config: ResolvedConfig;
  projectInfo: CollectorResult<ProjectInfo>;
  outputDir: string;
  plugins: GuardedPlugin[];
  noData: PluginNoData[];
}
