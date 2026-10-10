import { basename, dirname, resolve } from 'node:path';
import { ConfigError } from './errors.js';

export const MODULE_NAMES = [
  'project-info',
  'outdated',
  'audit',
  'knip',
  'lint',
  'coverage',
  'node-version',
  'build-size',
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export interface ModuleConfig {
  /** Выключить модуль. По умолчанию true. */
  enabled?: boolean;
  /** Ограничение времени для модуля, мс. По умолчанию берётся общий timeoutMs. */
  timeoutMs?: number;
}

export interface FrontisConfig {
  /** Версия формата конфига. */
  configVersion?: 1;
  /** Корень проверяемого проекта. По умолчанию ".". */
  projectDir?: string;
  /** Папка сборки. По умолчанию "dist". */
  buildDir?: string;
  /** Путь к создаваемому отчёту. По умолчанию "frontis-report.html". */
  outFile?: string;
  /** Открывать отчёт в браузере после работы. По умолчанию true. */
  open?: boolean;
  /** Ограничение времени на один модуль, мс, от 1000 до 600000. По умолчанию 120000. */
  timeoutMs?: number;
  targets?: {
    /** Целевая версия Node: "22" или "22.4.1". По умолчанию "22". */
    nodeVersion?: string;
    /** Цель по покрытию тестами, от 0 до 100 процентов. По умолчанию 90. */
    coverage?: number;
  };
  /** Переопределение настроек модулей. */
  modules?: { [name in ModuleName]?: ModuleConfig };
}

export interface ResolvedModuleConfig {
  enabled: boolean;
  timeoutMs: number;
}

export interface ResolvedConfig {
  configVersion: 1;
  /** Абсолютный путь. */
  projectDir: string;
  /** Абсолютный путь. */
  buildDir: string;
  /** Абсолютный путь. */
  outFile: string;
  open: boolean;
  timeoutMs: number;
  targets: {
    nodeVersion: string;
    coverage: number;
  };
  modules: Record<ModuleName, ResolvedModuleConfig>;
}

export function defineConfig(config: FrontisConfig): FrontisConfig {
  return config;
}

const TOP_LEVEL_KEYS = [
  'configVersion',
  'projectDir',
  'buildDir',
  'outFile',
  'open',
  'timeoutMs',
  'targets',
  'modules',
];
const TARGET_KEYS = ['nodeVersion', 'coverage'];
const MODULE_KEYS = ['enabled', 'timeoutMs'];

const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 600_000;
const NODE_VERSION = /^\d+(\.\d+){0,2}$/;

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'массив';
  if (typeof value === 'function') return 'функция';
  if (typeof value === 'object') return 'объект';
  return String(value);
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function suggest(name: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of known) {
    const distance = levenshtein(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Собирает ошибки проверки, чтобы показать их все за один запуск. */
class Checker {
  readonly errors: string[] = [];

  fail(path: string, expected: string, value: unknown): void {
    this.errors.push(`${path}: ${expected}, получено ${describe(value)}`);
  }

  unknownKeys(fields: Fields, known: readonly string[], prefix: string, what: string): void {
    for (const key of Object.keys(fields)) {
      if (known.includes(key)) continue;
      const hint = suggest(key, known);
      this.errors.push(
        `${prefix}${key}: ${what}.` +
          (hint === undefined ? '' : ` Возможно, имелось в виду ${hint}.`) +
          ` Допустимые: ${known.join(', ')}.`,
      );
    }
  }

  string(fields: Fields, key: string, path: string, fallback: string): string {
    const value = fields[key];
    if (value === undefined) return fallback;
    if (typeof value === 'string' && value !== '') return value;
    this.fail(path, 'ожидалась непустая строка', value);
    return fallback;
  }

  boolean(fields: Fields, key: string, path: string, fallback: boolean): boolean {
    const value = fields[key];
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    this.fail(path, 'ожидалось true или false', value);
    return fallback;
  }

  timeout(fields: Fields, key: string, path: string, fallback: number): number {
    const value = fields[key];
    if (value === undefined) return fallback;
    if (typeof value === 'number' && Number.isInteger(value) && value >= TIMEOUT_MIN && value <= TIMEOUT_MAX) {
      return value;
    }
    this.fail(path, `ожидалось целое число от ${TIMEOUT_MIN} до ${TIMEOUT_MAX}`, value);
    return fallback;
  }

  section(fields: Fields, key: string): Fields {
    const value = fields[key];
    if (value === undefined) return {};
    if (isFields(value)) return value;
    this.fail(key, 'ожидался объект', value);
    return {};
  }
}

function checkVersion(value: unknown, checker: Checker): void {
  if (value === undefined || value === 1) return;
  if (typeof value === 'number' && Number.isInteger(value) && value > 1) {
    checker.errors.push(
      `configVersion: версия ${value} не поддерживается этой версией frontis. ` +
        'Обновите frontis: npm install -D frontis@latest',
    );
    return;
  }
  checker.fail('configVersion', 'ожидалось 1', value);
}

function checkTargets(fields: Fields, checker: Checker): ResolvedConfig['targets'] {
  checker.unknownKeys(fields, TARGET_KEYS, 'targets.', 'неизвестное поле');

  let nodeVersion = '22';
  const version = fields['nodeVersion'];
  if (typeof version === 'string' && NODE_VERSION.test(version)) {
    nodeVersion = version;
  } else if (version !== undefined) {
    checker.fail('targets.nodeVersion', 'ожидалась строка вида "22" или "22.4.1"', version);
  }

  let coverage = 90;
  const percent = fields['coverage'];
  if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100) {
    coverage = percent;
  } else if (percent !== undefined) {
    checker.fail('targets.coverage', 'ожидалось число от 0 до 100', percent);
  }

  return { nodeVersion, coverage };
}

function checkModules(fields: Fields, timeoutMs: number, checker: Checker): ResolvedConfig['modules'] {
  checker.unknownKeys(fields, MODULE_NAMES, 'modules.', 'неизвестный модуль');

  const resolveModule = (name: ModuleName): ResolvedModuleConfig => {
    const path = `modules.${name}`;
    const value = fields[name];
    if (value === undefined) return { enabled: true, timeoutMs };
    if (!isFields(value)) {
      checker.fail(path, 'ожидался объект', value);
      return { enabled: true, timeoutMs };
    }
    checker.unknownKeys(value, MODULE_KEYS, `${path}.`, 'неизвестное поле');
    return {
      enabled: checker.boolean(value, 'enabled', `${path}.enabled`, true),
      timeoutMs: checker.timeout(value, 'timeoutMs', `${path}.timeoutMs`, timeoutMs),
    };
  };

  // Перечисление вместо цикла по MODULE_NAMES: так TypeScript сам проверяет,
  // что заполнены все модули, без приведения типа
  return {
    'project-info': resolveModule('project-info'),
    outdated: resolveModule('outdated'),
    audit: resolveModule('audit'),
    knip: resolveModule('knip'),
    lint: resolveModule('lint'),
    coverage: resolveModule('coverage'),
    'node-version': resolveModule('node-version'),
    'build-size': resolveModule('build-size'),
  };
}

/**
 * Проверяет загруженный конфиг и подставляет значения по умолчанию.
 * Относительные пути считаются от папки файла конфигурации
 * (без configPath — от текущей папки).
 */
export function resolveConfig(raw: unknown, configPath?: string): ResolvedConfig {
  const source = configPath === undefined ? 'Конфигурация' : basename(configPath);
  const configDir = configPath === undefined ? process.cwd() : dirname(configPath);

  if (!isFields(raw)) {
    throw new ConfigError(
      `${source}: ожидался объект конфигурации, получено ${describe(raw)}.\n` +
        'Экспортируйте объект: export default defineConfig({ ... })',
    );
  }

  const checker = new Checker();
  checker.unknownKeys(raw, TOP_LEVEL_KEYS, '', 'неизвестное поле');
  checkVersion(raw['configVersion'], checker);

  const timeoutMs = checker.timeout(raw, 'timeoutMs', 'timeoutMs', 120_000);
  const config: ResolvedConfig = {
    configVersion: 1,
    projectDir: resolve(configDir, checker.string(raw, 'projectDir', 'projectDir', '.')),
    buildDir: resolve(configDir, checker.string(raw, 'buildDir', 'buildDir', 'dist')),
    outFile: resolve(configDir, checker.string(raw, 'outFile', 'outFile', 'frontis-report.html')),
    open: checker.boolean(raw, 'open', 'open', true),
    timeoutMs,
    targets: checkTargets(checker.section(raw, 'targets'), checker),
    modules: checkModules(checker.section(raw, 'modules'), timeoutMs, checker),
  };

  if (checker.errors.length > 0) {
    throw new ConfigError(
      `${source}: найдены ошибки (${checker.errors.length}):\n` +
        checker.errors.map((error) => `  - ${error}`).join('\n') +
        '\nИсправьте их и запустите команду снова.',
    );
  }
  return config;
}
