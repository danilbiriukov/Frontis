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
  /** Команда запуска тестов, если в проекте нет готового отчёта о покрытии. */
  testCommand?: string;
  thresholds?: {
    coverage?: {
      /** Покрытие строк ниже этого значения — высокая важность. По умолчанию 65. */
      warn?: number;
      /** Покрытие строк от этого значения — находки нет. По умолчанию 90. */
      target?: number;
    };
    buildSize?: {
      /** Предел размера сборки, МБ, больше нуля. По умолчанию 5. */
      maxMb?: number;
    };
  };
  /** Переопределение настроек модулей. */
  modules?: { [name in ModuleName]?: ModuleConfig };
}

export interface ResolvedModuleConfig {
  enabled: boolean;
  timeoutMs: number;
}

export interface Thresholds {
  coverage: { warn: number; target: number };
  buildSize: { maxMb: number };
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
  testCommand: string | undefined;
  thresholds: Thresholds;
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
  'testCommand',
  'thresholds',
  'modules',
];
const THRESHOLD_KEYS = ['coverage', 'buildSize'];
const COVERAGE_KEYS = ['warn', 'target'];
const BUILD_SIZE_KEYS = ['maxMb'];
const MODULE_KEYS = ['enabled', 'timeoutMs'];

const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 600_000;

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

  string<T extends string | undefined>(fields: Fields, key: string, path: string, fallback: T): string | T {
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

  percent(fields: Fields, key: string, path: string, fallback: number): number {
    const value = fields[key];
    if (value === undefined) return fallback;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) return value;
    this.fail(path, 'ожидалось число от 0 до 100', value);
    return fallback;
  }

  section(fields: Fields, key: string, path: string = key): Fields {
    const value = fields[key];
    if (value === undefined) return {};
    if (isFields(value)) return value;
    this.fail(path, 'ожидался объект', value);
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

function checkThresholds(fields: Fields, checker: Checker): Thresholds {
  checker.unknownKeys(fields, THRESHOLD_KEYS, 'thresholds.', 'неизвестное поле');

  const coverage = checker.section(fields, 'coverage', 'thresholds.coverage');
  checker.unknownKeys(coverage, COVERAGE_KEYS, 'thresholds.coverage.', 'неизвестное поле');
  const errorsBefore = checker.errors.length;
  const warn = checker.percent(coverage, 'warn', 'thresholds.coverage.warn', 65);
  const target = checker.percent(coverage, 'target', 'thresholds.coverage.target', 90);
  // Сравниваем только корректные числа, иначе к ошибке типа добавится вторая, ложная
  if (checker.errors.length === errorsBefore && warn >= target) {
    checker.errors.push(
      `thresholds.coverage: warn должен быть меньше target, получено warn ${warn} и target ${target}`,
    );
  }

  const buildSize = checker.section(fields, 'buildSize', 'thresholds.buildSize');
  checker.unknownKeys(buildSize, BUILD_SIZE_KEYS, 'thresholds.buildSize.', 'неизвестное поле');
  let maxMb = 5;
  const size = buildSize['maxMb'];
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    maxMb = size;
  } else if (size !== undefined) {
    checker.fail('thresholds.buildSize.maxMb', 'ожидалось число больше нуля', size);
  }

  return { coverage: { warn, target }, buildSize: { maxMb } };
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
    testCommand: checker.string(raw, 'testCommand', 'testCommand', undefined),
    thresholds: checkThresholds(checker.section(raw, 'thresholds'), checker),
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
