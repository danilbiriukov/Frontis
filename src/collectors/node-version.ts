import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import semver from 'semver';
import type { Collector, CollectorFailure, CollectorFinding } from './index.js';

export interface NodeRelease {
  version: string;
  /** Кодовое имя LTS-линии или false. */
  lts: string | false;
}

export interface NodeVersionOptions {
  /** Файл кэша списка релизов. По умолчанию .frontis/cache/node-releases.json в проекте. */
  cacheFile?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export interface NodeVersionData {
  source: { file: '.nvmrc' | '.node-version' | 'package.json'; value: string };
  /** exact — полная версия, range — диапазон или неполная версия, alias — lts/*, node и т. п. */
  kind: 'exact' | 'range' | 'alias';
  /** Версия для сравнения: точная, разрешённый алиас или новейшая версия из диапазона. */
  version: string;
  latestLts: { version: string; codename: string };
  /** Допускает ли указанная версия или диапазон последнюю LTS. */
  allowsLatestLts: boolean;
  lag: 'major' | 'minor' | 'patch' | null;
  /** Откуда получен список релизов. stale-cache — устаревший кэш при недоступном сайте. */
  releases: 'network' | 'cache' | 'stale-cache';
}

export const NODE_RELEASES_URL = 'https://nodejs.org/dist/index.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const LATEST_ALIASES = new Set(['node', 'stable', 'latest', 'current']);

type Fields = Record<string, unknown>;

function noData(code: string, reason: string, action: string, cause?: unknown): CollectorFailure {
  return { status: 'no-data', code, reason, action, ...(cause === undefined ? {} : { cause }) };
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** Первая значимая строка без комментария, как её читают nvm и fnm. */
function firstValue(content: string): string | undefined {
  return content.split(/\r?\n/).map((line) => line.replace(/#.*/, '').trim()).find((line) => line !== '');
}

async function findSource(projectDir: string): Promise<NodeVersionData['source'] | undefined> {
  for (const file of ['.nvmrc', '.node-version'] as const) {
    const content = await readText(join(projectDir, file));
    const value = content === undefined ? undefined : firstValue(content);
    if (value !== undefined) return { file, value };
  }
  const manifest = await readText(join(projectDir, 'package.json'));
  if (manifest === undefined) return undefined;
  try {
    const engines = (JSON.parse(manifest) as Fields)['engines'];
    const value = typeof engines === 'object' && engines !== null ? (engines as Fields)['node'] : undefined;
    return typeof value === 'string' && value.trim() !== '' ? { file: 'package.json', value: value.trim() } : undefined;
  } catch {
    return undefined;
  }
}

export function parseReleases(index: unknown): NodeRelease[] | undefined {
  if (!Array.isArray(index)) return undefined;
  const releases: NodeRelease[] = [];
  for (const entry of index) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const { version, lts } = entry as Fields;
    if (typeof version !== 'string') return undefined;
    if (!/^v\d+\.\d+\.\d+$/.test(version)) continue;
    releases.push({ version: version.slice(1), lts: typeof lts === 'string' && lts !== '' ? lts : false });
  }
  return releases.length > 0 ? releases : undefined;
}

function readCache(content: string | undefined): { fetchedAt: number; releases: NodeRelease[] } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content ?? '');
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { fetchedAt, releases } = parsed as Fields;
  if (typeof fetchedAt !== 'number' || !Array.isArray(releases) || releases.length === 0) return undefined;
  const valid = releases.every((release: Fields) =>
    typeof release?.['version'] === 'string' && semver.valid(release['version']) !== null && (release['lts'] === false || typeof release['lts'] === 'string'));
  return valid ? { fetchedAt, releases: releases as NodeRelease[] } : undefined;
}

async function loadReleases(cacheFile: string, options: NodeVersionOptions, signal?: AbortSignal) {
  const now = (options.now ?? Date.now)();
  const cached = readCache(await readText(cacheFile));
  if (cached !== undefined && now - cached.fetchedAt < CACHE_TTL_MS && now >= cached.fetchedAt) {
    return { releases: cached.releases, origin: 'cache' as const };
  }

  let error: unknown;
  try {
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const response = await (options.fetch ?? globalThis.fetch)(NODE_RELEASES_URL, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = parseReleases(await response.json());
    if (releases === undefined) throw new Error('Неожиданный формат списка релизов');
    await mkdir(dirname(cacheFile), { recursive: true })
      .then(() => writeFile(cacheFile, `${JSON.stringify({ fetchedAt: now, releases })}\n`))
      .catch(() => undefined);
    return { releases, origin: 'network' as const };
  } catch (caught) {
    signal?.throwIfAborted();
    error = caught;
  }
  if (cached !== undefined) return { releases: cached.releases, origin: 'stale-cache' as const };
  return { error };
}

function lagLevel(version: string, latest: string): NodeVersionData['lag'] {
  if (semver.gte(version, latest)) return null;
  const diff = semver.diff(version, latest);
  return diff === 'major' || diff === 'minor' ? diff : 'patch';
}

export function createNodeVersionCollector(options: NodeVersionOptions = {}): Collector<NodeVersionData> {
  return async ({ projectDir, signal }) => {
    const source = await findSource(projectDir);
    if (source === undefined) {
      return noData('no-node-version', 'В проекте не указана версия Node.js', 'Добавьте .nvmrc с версией Node.js или поле engines.node в package.json.');
    }

    const loaded = await loadReleases(options.cacheFile ?? join(projectDir, '.frontis', 'cache', 'node-releases.json'), options, signal);
    if (loaded.releases === undefined) {
      return noData('node-releases-unavailable', 'Не удалось получить список релизов Node.js', 'Проверьте подключение к сети и запустите frontis снова.', loaded.error);
    }
    const versions = loaded.releases.map(({ version }) => version);
    const ltsReleases = loaded.releases.filter((release): release is NodeRelease & { lts: string } => release.lts !== false);
    const latestLts = ltsReleases.reduce<(typeof ltsReleases)[number] | undefined>((best, release) => (best === undefined || semver.gt(release.version, best.version) ? release : best), undefined);
    if (latestLts === undefined) {
      return noData('node-releases-unavailable', 'В списке релизов Node.js нет LTS-версий', 'Запустите frontis снова позже.');
    }

    const raw = source.value.replace(/^v(?=\d)/, '');
    const alias = raw.toLowerCase();
    let kind: NodeVersionData['kind'];
    let version: string | null;
    let allowsLatestLts: boolean;
    if (LATEST_ALIASES.has(alias) || alias.startsWith('lts/')) {
      kind = 'alias';
      const codename = alias.slice(4);
      const line = alias === 'lts/*' || alias === 'lts/latest' ? ltsReleases : ltsReleases.filter(({ lts }) => lts.toLowerCase() === codename);
      version = LATEST_ALIASES.has(alias) ? semver.maxSatisfying(versions, '*') : semver.maxSatisfying(line.map((release) => release.version), '*');
      allowsLatestLts = version !== null && semver.gte(version, latestLts.version);
    } else if (semver.valid(raw) !== null) {
      kind = 'exact';
      version = semver.valid(raw);
      allowsLatestLts = version === latestLts.version;
    } else if (semver.validRange(raw) !== null) {
      kind = 'range';
      version = semver.maxSatisfying(versions, raw);
      allowsLatestLts = semver.satisfies(latestLts.version, raw);
    } else {
      return noData('invalid-node-version', `Не удалось разобрать версию Node.js «${source.value}» в ${source.file}`, 'Укажите версию вида 22.12.0, диапазон вида ^22 или алиас lts/*.');
    }
    if (version === null) {
      return noData('invalid-node-version', `Ни один релиз Node.js не подходит под «${source.value}» в ${source.file}`, 'Проверьте версию Node.js в настройках проекта.');
    }

    const lag = lagLevel(version, latestLts.version);
    const findings: CollectorFinding[] = lag === null ? [] : [{
      code: `node-${lag}-behind`,
      message: `Node.js ${version} отстаёт от последней LTS ${latestLts.version} (${latestLts.lts})`,
      severity: lag === 'major' ? 'error' : lag === 'minor' ? 'warning' : 'info',
      source: { file: source.file },
    }];
    return {
      status: 'ok',
      data: {
        source,
        kind,
        version,
        latestLts: { version: latestLts.version, codename: latestLts.lts },
        allowsLatestLts,
        lag,
        releases: loaded.origin,
      },
      findings,
    };
  };
}
