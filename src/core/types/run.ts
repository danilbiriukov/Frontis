export type TPluginStatus = 'waiting' | 'running' | 'done' | 'error' | 'no-data';
export type TPluginProgress = (plugin: string, status: TPluginStatus) => void;
