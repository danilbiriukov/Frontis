import { createRequire } from 'node:module';
import { basename, isAbsolute, join } from 'node:path';
import eslintPlugin from '@code-pushup/eslint-plugin';
import { ruleIdToSlug } from '@code-pushup/eslint-plugin/src/lib/meta/hash.js';
import { lintResultsToAudits } from '@code-pushup/eslint-plugin/src/lib/runner/transform.js';
import { MAX_ISSUE_MESSAGE_LENGTH, MAX_TITLE_LENGTH, type AuditOutput, type Issue, type PluginConfig } from '@code-pushup/models';
import type { ESLint, Linter } from 'eslint';
import { CollectorRunError } from '../collectors/code-pushup.js';
import type { PluginProblem } from '../core/plugin-guard.js';
import { ESLINT_CHECKED_FILES, ESLINT_OTHER_MESSAGES, ESLINT_PARSE_ERRORS } from './eslint-evidence.js';

interface Options {
  eslintrc: string;
  patterns?: string | string[];
}

const verifyFiles = 'Проверьте конфигурацию ESLint и шаблоны файлов.';
const coverageUnconfirmed: PluginProblem = {
  code: 'eslint-coverage-unconfirmed',
  reason: 'ESLint вернул данные, по которым нельзя подтвердить список проверенных файлов.',
  action: verifyFiles,
};

function toIssue(file: string, message: Linter.LintMessage): Issue {
  const { line, column } = message;
  return {
    message: message.message.slice(0, MAX_ISSUE_MESSAGE_LENGTH),
    severity: message.severity === 2 ? 'error' : 'warning',
    source: line > 0
      ? { file, position: { startLine: line, ...(column > 0 ? { startColumn: column } : {}) } }
      : { file },
  };
}

function diagnostics(slug: string, issues: Issue[]): AuditOutput {
  return { slug, value: issues.length, score: Number(issues.length === 0), details: { issues } };
}

async function readRules(
  eslint: Pick<ESLint, 'calculateConfigForFile'>,
  results: ESLint.LintResult[],
) {
  const ruleOptionsPerFile: Record<string, Record<string, unknown[]>> = Object.create(null);
  const ruleNames = new Map<string, string>();
  const ruleCounts = new Map<string, number>();
  const parseErrors: Issue[] = [];
  const otherMessages: Issue[] = [];
  for (const { filePath, messages } of results) {
    const ruleIds = new Set<string>();
    for (const message of messages) {
      if (message.ruleId === null) {
        const target = message.fatal ? parseErrors : otherMessages;
        target.push(toIssue(filePath, message));
      } else {
        ruleIds.add(message.ruleId);
        ruleCounts.set(message.ruleId, (ruleCounts.get(message.ruleId) ?? 0) + 1);
      }
    }
    if (ruleIds.size === 0) {
      continue;
    }
    const config = await eslint.calculateConfigForFile(filePath) as Linter.Config | undefined;
    if (config === undefined) {
      return undefined;
    }
    const entries = [...ruleIds].map((rule) => {
      const entry = config.rules?.[rule];
      const options = Array.isArray(entry) ? entry.slice(1) : [];
      ruleNames.set(ruleIdToSlug(rule, options), rule);
      return [rule, options] as const;
    });
    ruleOptionsPerFile[filePath] = Object.fromEntries(entries);
  }
  return { ruleOptionsPerFile, ruleNames, ruleCounts, parseErrors, otherMessages };
}

async function officialMetadata(options: Options, flat: boolean, files: string[]): Promise<PluginConfig> {
  // Фабрика Code PushUp выбирает формат через окружение текущего дочернего процесса.
  const previous = process.env.ESLINT_USE_FLAT_CONFIG;
  process.env.ESLINT_USE_FLAT_CONFIG = String(flat);
  try {
    return await eslintPlugin({ ...options, patterns: flat ? options.patterns : files });
  } finally {
    if (previous === undefined) {
      delete process.env.ESLINT_USE_FLAT_CONFIG;
    } else {
      process.env.ESLINT_USE_FLAT_CONFIG = previous;
    }
  }
}

export async function prepare(options: Options): Promise<PluginConfig | PluginProblem> {
  const cwd = process.cwd();
  const projectRequire = createRequire(join(cwd, 'package.json'));
  const patterns = options.patterns ?? '.';
  const flat = basename(options.eslintrc).startsWith('eslint.config.');
  let entry: string;
  try {
    entry = projectRequire.resolve('eslint');
  } catch {
    return {
      code: 'eslint-not-installed',
      reason: 'ESLint не установлен в проверяемом проекте.',
      action: 'Установите зависимости проекта или добавьте ESLint.',
    };
  }

  try {
    const api = projectRequire(entry) as typeof import('eslint');
    const version = api.ESLint?.version ?? '';
    const [major, minor] = version.split('.').map(Number);
    if ((major !== 9 && (major !== 8 || minor < 46)) || (flat && api.loadESLint === undefined)) {
      return {
        code: 'eslint-unsupported',
        reason: `Версия ESLint ${version || 'не определена'} не поддерживает выбранный формат конфигурации.`,
        action: 'Установите ESLint 9 в проверяемом проекте.',
      };
    }
    const Engine = api.loadESLint === undefined
      ? api.ESLint
      : flat ? await api.loadESLint({ useFlatConfig: true }) : await api.loadESLint({ useFlatConfig: false });
    const eslint = new Engine({
      cwd,
      overrideConfigFile: options.eslintrc,
      errorOnUnmatchedPattern: false,
      ...(flat ? { warnIgnored: false } : {}),
    });
    const raw = await eslint.lintFiles(patterns);
    if (!Array.isArray(raw) || raw.some((result) =>
      typeof result?.filePath !== 'string' || !isAbsolute(result.filePath) || !Array.isArray(result.messages)
    )) {
      return coverageUnconfirmed;
    }
    const results = flat ? raw : (await Promise.all(raw.map(async (result) =>
      await eslint.isPathIgnored(result.filePath) ? undefined : result
    ))).filter((result) => result !== undefined);
    const files = [...new Set(results.map(({ filePath }) => filePath))];
    if (files.length === 0) {
      return { code: 'no-files', reason: 'ESLint не проверил ни одного файла.', action: verifyFiles };
    }
    const rules = await readRules(eslint, results);
    if (rules === undefined) {
      return coverageUnconfirmed;
    }

    const plugin = await officialMetadata(options, flat, files);
    const auditBySlug = new Map(plugin.audits.map((audit) => [audit.slug, audit]));
    const ruleResults = results.map((result) => ({
      ...result,
      messages: result.messages.filter(({ ruleId }) => ruleId !== null),
    }));
    // Преобразователь зафиксированной версии сохраняет официальные идентификаторы с учётом параметров.
    const converted = lintResultsToAudits({ results: ruleResults, ruleOptionsPerFile: rules.ruleOptionsPerFile });
    for (const { slug } of converted) {
      if (!auditBySlug.has(slug)) {
        auditBySlug.set(slug, { slug, title: (rules.ruleNames.get(slug) ?? slug).slice(0, MAX_TITLE_LENGTH) });
      }
    }
    const top = [...rules.ruleCounts]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule, 'en'))
      .slice(0, 10);
    const checks: AuditOutput[] = [
      {
        slug: ESLINT_CHECKED_FILES,
        value: files.length,
        score: 1,
        details: { table: {
          title: 'Наиболее частые правила ESLint',
          columns: [{ key: 'rule', label: 'Правило' }, { key: 'count', label: 'Нарушения', align: 'right' }],
          rows: top,
        } },
      },
      diagnostics(ESLINT_PARSE_ERRORS, rules.parseErrors),
    ];
    const evidence = [
      { slug: ESLINT_CHECKED_FILES, title: 'Проверенные файлы ESLint' },
      { slug: ESLINT_PARSE_ERRORS, title: 'Ошибки разбора файлов ESLint' },
    ];
    if (rules.otherMessages.length > 0) {
      checks.push(diagnostics(ESLINT_OTHER_MESSAGES, rules.otherMessages));
      evidence.push({ slug: ESLINT_OTHER_MESSAGES, title: 'Служебные сообщения ESLint' });
    }
    if (evidence.some(({ slug }) => auditBySlug.has(slug))) {
      return {
        code: 'invalid-result',
        reason: 'Идентификатор правила ESLint совпал со служебным аудитом Frontis.',
        action: 'Переименуйте правило или его пространство имён.',
      };
    }
    const bySlug = new Map(converted.map((audit) => [audit.slug, audit]));
    return {
      ...plugin,
      audits: [...auditBySlug.values(), ...evidence],
      runner: async () => [
        ...[...auditBySlug.keys()].map((slug) => bySlug.get(slug) ?? { slug, score: 1, value: 0, displayValue: 'passed', details: { issues: [] } }),
        ...checks,
      ],
    };
  } catch (cause) {
    throw new CollectorRunError({
      status: 'error',
      code: 'eslint-failed',
      reason: 'Не удалось выполнить проверку ESLint.',
      action: 'Проверьте настройки ESLint и технический журнал.',
      cause,
    });
  }
}
