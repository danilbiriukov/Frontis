import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';
import { resolveConfig } from '../dist/core/config.js';
import { createResult } from '../dist/core/result.js';

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
}

const report = reportSchema.parse(readJson('./fixtures/result/report.json'));
const expected = readJson('./fixtures/result/result.json');
const official = reportSchema.parse(readJson('../docs/code-pushup-compatibility/sample-report.json'));
const moduleOptions = { 'node-version': { enabled: false }, 'build-size': { enabled: false } };
const prettierMissing = {
  plugin: 'prettier',
  code: 'no-prettier-config',
  reason: 'В проекте нет настроек Prettier.',
  action: 'Добавьте .prettierrc или поле prettier в package.json.',
};

function context({ modules = moduleOptions, noData = [prettierMissing] } = {}) {
  const { modules: resolved, thresholds } = resolveConfig({ modules });
  return {
    toolVersion: '0.1.0',
    project: { name: 'shop-web', version: '4.12.0', branch: null },
    modules: resolved,
    thresholds,
    noData,
  };
}

function indicator(result, id) {
  const found = result.indicators.find((entry) => entry.id === id);
  assert(found, `Нет показателя ${id}`);
  return found;
}

function check(result, id) {
  const found = result.indicators.flatMap(({ checks }) => checks).find((entry) => entry.id === id);
  assert(found, `Нет проверки ${id}`);
  return found;
}

test('частичный Report с категориями и commit: null даёт зафиксированный result.json', () => {
  const result = createResult(report, context());
  assert.deepEqual(result, expected);
  assert.equal(result.project.commit, null);
  assert.deepEqual(result.score, { value: 60, known: 3, total: 5, zone: 'yellow' });
  assert.equal(indicator(result, 'codeQuality').status, 'fix');
  assert.equal(indicator(result, 'codeQuality').incomplete, true);
  assert.equal(check(result, 'prettier').code, 'no-prettier-config');
  assert.equal(indicator(result, 'coverage').status, 'plan');
  assert.equal(indicator(result, 'coverage').incomplete, true);
  assert.equal(check(result, 'tests').code, 'tests-report-unavailable');
  assert.deepEqual(result.recommendations.map(({ indicator }) => indicator), ['codeQuality', 'coverage']);
});

test('положительные находки ESLint остаются при диагностике пропуска', () => {
  const diagnostic = {
    plugin: 'lint',
    code: 'coverage-unconfirmed',
    reason: 'Не удалось подтвердить охват ESLint.',
    action: 'Проверьте список файлов ESLint.',
    logFile: 'logs/lint.log',
  };
  const result = createResult(report, context({ noData: [diagnostic, prettierMissing] }));
  const lint = check(result, 'lint');
  assert.equal(lint.status, 'no-data');
  assert.equal(lint.code, diagnostic.code);
  assert.equal(lint.reason, diagnostic.reason);
  assert.equal(lint.action, diagnostic.action);
  assert.equal(lint.logFile, diagnostic.logFile);
  assert.deepEqual(lint.details.issues[0].source, {
    file: 'src/demo.js', position: { startLine: 2, startColumn: 9 },
  });
  assert.deepEqual(indicator(result, 'codeQuality').findings, [{ importance: 'high', kind: 'lint.errors', now: '1', target: '0' }]);
  assert.equal(indicator(result, 'codeQuality').status, 'fix');
  assert.equal(indicator(result, 'codeQuality').incomplete, true);
});

test('неожиданный тип покрытия строк не используется для оценки', () => {
  const malformed = structuredClone(report);
  malformed.plugins.find(({ slug }) => slug === 'coverage').audits[0].value = '78.4';
  assert.equal(reportSchema.safeParse(malformed).success, false);
  const result = createResult(malformed, context());
  assert.equal(indicator(result, 'coverage').status, 'no-data');
  assert.equal(check(result, 'coverage').code, 'invalid-audit-value');
  assert.deepEqual(check(result, 'coverage').facts, { branches: 50 });
  assert.equal(result.score.value, null);
});

test('аудиты #39 преобразуются в уровни, версии пакетов, файлы и проценты', () => {
  const result = createResult(official, context());
  assert.deepEqual(check(result, 'outdated').facts, {
    production: 1, development: 2, major: 2, minor: 1, patch: 0,
  });
  assert.equal(indicator(result, 'outdated').status, 'fix');
  const lodash = check(result, 'outdated').details.issues.find((issue) => issue.package === 'lodash');
  assert.equal(lodash.group, 'prod');
  assert.equal(lodash.level, 'minor');
  assert.equal(lodash.currentVersion, '4.17.15');
  assert.equal(lodash.targetVersion, '4.18.1');
  assert.equal(check(result, 'audit').facts.high, 1);
  assert.equal(check(result, 'audit').facts.critical, 1);
  assert.equal(check(result, 'audit').details.issues.find((issue) => issue.group === 'dev').level, 'critical');
  assert.deepEqual(check(result, 'lint').facts, { errors: 1, warnings: 1 });
  assert.deepEqual(check(result, 'coverage').facts, {
    lines: 66.66666666666666, branches: 50, functions: 100,
  });
});

test('ESLint и npm outdated с неподтверждёнными нулями дают «Нет данных»', () => {
  const zeros = structuredClone(official);
  for (const { slug, audits } of zeros.plugins) {
    for (const audit of audits) {
      if (slug === 'eslint' || audit.slug.startsWith('npm-outdated')) {
        audit.value = 0;
        delete audit.details;
      }
    }
  }
  const result = createResult(zeros, context());
  assert.equal(indicator(result, 'outdated').status, 'no-data');
  assert.equal(check(result, 'outdated').code, 'registry-unconfirmed');
  assert.deepEqual(check(result, 'outdated').facts, {});
  assert.equal(indicator(result, 'codeQuality').status, 'no-data');
  assert.equal(check(result, 'lint').code, 'eslint-coverage-unconfirmed');
  assert.deepEqual(check(result, 'lint').facts, {});
});

test('Prettier, версия Node.js и размер сборки передают факты, находки и детали', () => {
  function plugin(slug, audits) {
    return {
      slug,
      title: slug,
      icon: 'file',
      date: report.date,
      duration: 1,
      audits: audits.map((audit) => ({ score: 1, title: audit.slug, ...audit })),
    };
  }
  const reportWithPlugins = reportSchema.parse({
    ...report,
    plugins: [
      ...report.plugins,
      plugin('frontis-prettier', [
        { slug: 'checked-files', value: 4 },
        { slug: 'unformatted-files', value: 1 },
        { slug: 'parse-errors', value: 1 },
      ]),
      plugin('frontis-node-version', [
        { slug: 'project-version', value: 1, displayValue: '22.0.0-rc.0' },
        { slug: 'latest-lts', value: 1, displayValue: '22.0.1' },
        { slug: 'version-lag', value: 1 },
      ]),
      plugin('frontis-build-size', [
        { slug: 'size-bytes', value: 6291456, details: { table: { rows: [{ file: 'dist/main.js', bytes: 6291456 }] } } },
        { slug: 'file-count', value: 1 },
        { slug: 'limit-bytes', value: 5242880 },
      ]),
    ],
  });
  const result = createResult(reportWithPlugins, context({ modules: { lint: { enabled: false } }, noData: [] }));
  assert.equal(check(result, 'lint').status, 'disabled');
  assert.deepEqual(check(result, 'prettier').facts, { checkedFiles: 4, unformatted: 1, parseErrors: 1 });
  assert.equal(indicator(result, 'codeQuality').status, 'fix');
  assert.equal(indicator(result, 'codeQuality').incomplete, true);
  assert.deepEqual(check(result, 'node-version').facts, { version: '22.0.0-rc.0', latestLts: '22.0.1', lag: 'patch' });
  assert.equal(indicator(result, 'nodeVersion').status, 'ok');
  assert.deepEqual(check(result, 'build-size').details.largestFiles, [{ file: 'dist/main.js', bytes: 6291456 }]);
  assert.equal(indicator(result, 'buildSize').status, 'fix');
  assert.equal(result.score.total, 7);
});
