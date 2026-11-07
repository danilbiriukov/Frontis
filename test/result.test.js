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

function withOutdatedEvidence(prod, dev, audits = []) {
  return reportSchema.parse({
    ...report,
    plugins: [
      ...report.plugins,
      plugin('js-packages', [
        ...audits,
        {
          slug: 'frontis-outdated-evidence', value: 1,
          details: { table: { rows: [{ group: 'prod', ...prod }, { group: 'dev', ...dev }] } },
        },
      ]),
    ],
  });
}

function outdatedAudit(group, releases) {
  const target = {
    major: '2.0.0',
    premajor: '2.0.0-rc.1',
    preminor: '1.1.0-rc.1',
    prepatch: '1.0.1-rc.1',
    prerelease: '1.0.1-rc.2',
  };
  return {
    slug: `npm-outdated-${group}`,
    value: releases.length,
    details: {
      issues: releases.map((level, index) => ({
        message: `Package \`package-${index}\` requires a **${level}** update from **${level === 'prerelease' ? '1.0.1-rc.1' : '1.0.0'}** to **${target[level]}**.`,
        severity: 'info',
      })),
    },
  };
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
  assert.deepEqual(check(result, 'coverage').facts, { branches: 50, warn: 65, target: 90 });
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
    warn: 65, target: 90, gapToWarn: 0, gapToTarget: 90 - 66.66666666666666,
  });
});

test('покрытие хранит дату LCOV, настроенные пороги и разрывы в процентных пунктах', () => {
  const reportWithDate = structuredClone(report);
  const coverage = reportWithDate.plugins.find(({ slug }) => slug === 'coverage');
  coverage.audits.find(({ slug }) => slug === 'line-coverage').value = 56;
  const reportDate = '2026-10-10T14:31:00.000Z';
  coverage.audits.push({ slug: 'frontis-lcov-date', title: 'Дата LCOV', score: 1, value: 1, displayValue: reportDate });
  const options = context();
  options.thresholds.coverage = { warn: 60, target: 82 };
  const result = createResult(reportSchema.parse(reportWithDate), options);
  assert.deepEqual(check(result, 'coverage').facts, {
    lines: 56, branches: 50, reportDate, warn: 60, target: 82, gapToWarn: 4, gapToTarget: 26,
  });
  assert(check(result, 'coverage').audits.includes('coverage/frontis-lcov-date'));
  assert.equal(indicator(result, 'coverage').status, 'fix');
});

test('подтверждённые падения и пропуски остаются при неполном прогоне без покрытия', () => {
  const source = { file: 'test/cart.test.js', position: { startLine: 12 } };
  const withTests = reportSchema.parse({
    ...report,
    plugins: [
      ...report.plugins.filter(({ slug }) => slug !== 'coverage'),
      plugin('frontis-tests', [
        { slug: 'passed-tests', value: 3 },
        {
          slug: 'failed-tests', value: 1,
          details: { issues: [{ message: 'Возвращает стоимость заказа', severity: 'error', source }] },
        },
        { slug: 'skipped-tests', value: 2 },
        {
          slug: 'failed-suites', value: 1,
          details: { issues: [{ message: 'Файл тестов не выполнился', severity: 'error', source: { file: 'test/order.test.js' } }] },
        },
        { slug: 'test-run-complete', value: 0 },
      ]),
    ],
  });
  const result = createResult(withTests, context({ noData: [{
    plugin: 'coverage',
    code: 'test-command-failed',
    reason: 'Команда тестов завершилась с ошибкой.',
    action: 'Исправьте тесты и повторите прогон.',
  }] }));
  assert.equal(check(result, 'coverage').status, 'no-data');
  assert.equal(check(result, 'coverage').code, 'test-command-failed');
  assert.deepEqual(check(result, 'coverage').facts, { warn: 65, target: 90 });
  const tests = check(result, 'tests');
  assert.equal(tests.status, 'no-data');
  assert.equal(tests.code, 'tests-incomplete');
  assert.deepEqual(tests.facts, { passed: 3, failed: 1, skipped: 2, failedSuites: 1, complete: false });
  assert.deepEqual(tests.details.issues[0].source, source);
  assert.equal(tests.details.issues[0].audit, 'frontis-tests/failed-tests');
  assert.equal(tests.details.issues[1].audit, 'frontis-tests/failed-suites');
  const coverage = indicator(result, 'coverage');
  assert.equal(coverage.status, 'fix');
  assert.equal(coverage.incomplete, true);
  assert.deepEqual(coverage.findings.map(({ kind, importance }) => [kind, importance]), [
    ['tests.failed', 'high'], ['tests.skipped', 'low'], ['tests.failedSuites', 'high'],
  ]);
  assert.deepEqual(result.recommendations.filter(({ indicator }) => indicator === 'coverage').map(({ importance }) => importance), [
    'high', 'high', 'low',
  ]);
});

test('завершённый прогон тестов учитывается отдельно при отсутствии покрытия', () => {
  const withTests = reportSchema.parse({
    ...report,
    plugins: [
      ...report.plugins.filter(({ slug }) => slug !== 'coverage'),
      plugin('frontis-tests', [
        { slug: 'passed-tests', value: 3 },
        { slug: 'failed-tests', value: 0 },
        { slug: 'skipped-tests', value: 0 },
        { slug: 'failed-suites', value: 0 },
        { slug: 'test-run-complete', value: 1 },
      ]),
    ],
  });
  const result = createResult(withTests, context());
  assert.equal(check(result, 'coverage').status, 'no-data');
  assert.equal(check(result, 'tests').status, 'ok');
  assert.equal(check(result, 'tests').facts.complete, true);
  assert.equal(indicator(result, 'coverage').status, 'ok');
  assert.equal(indicator(result, 'coverage').incomplete, true);
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

test('доля устаревших пакетов считается отдельно, prerelease учитывается в важности', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'verified', comparable: 5 },
    { state: 'verified', comparable: 4 },
    [outdatedAudit('prod', ['premajor', 'prepatch']), outdatedAudit('dev', ['preminor', 'prerelease'])],
  );
  const result = createResult(withEvidence, context());
  const outdated = check(result, 'outdated');
  assert.deepEqual(outdated.facts, {
    production: 2, development: 2,
    productionComparable: 5, developmentComparable: 4,
    productionState: 'verified', developmentState: 'verified',
    productionOutdatedPercent: 40, developmentOutdatedPercent: 50,
    major: 1, minor: 1, patch: 2,
  });
  assert.equal(indicator(result, 'outdated').status, 'fix');
  assert(outdated.audits.includes('js-packages/frontis-outdated-evidence'));
  assert.equal(outdated.details.issues[0].level, 'premajor');
  assert.equal(outdated.details.issues[0].targetVersion, '2.0.0-rc.1');
});

test('чистый результат подтверждённой группы засчитывается при второй пустой группе', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'verified', comparable: 3 },
    { state: 'empty', comparable: 0 },
    [outdatedAudit('prod', [])],
  );
  const result = createResult(withEvidence, context());
  const outdated = check(result, 'outdated');
  assert.equal(outdated.status, 'ok');
  assert.equal(outdated.facts.production, 0);
  assert.equal(outdated.facts.productionOutdatedPercent, 0);
  assert.equal(outdated.facts.developmentComparable, 0);
  assert.equal(outdated.facts.development, undefined);
  assert.equal(outdated.facts.developmentOutdatedPercent, undefined);
  assert.equal(indicator(result, 'outdated').incomplete, undefined);
  assert.equal(result.score.known, 4);
});

test('пригодный результат и неподтверждённая группа дают неполный показатель с причиной', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'verified', comparable: 4 },
    { state: 'unconfirmed', comparable: 3 },
    [outdatedAudit('prod', [])],
  );
  const result = createResult(withEvidence, context());
  const outdated = check(result, 'outdated');
  assert.equal(outdated.status, 'ok');
  assert.equal(outdated.incomplete, true);
  assert.equal(outdated.code, 'registry-unconfirmed');
  assert.equal(outdated.facts.productionOutdatedPercent, 0);
  assert.equal(outdated.facts.developmentState, 'unconfirmed');
  assert.equal(outdated.facts.developmentOutdatedPercent, undefined);
  assert.equal(indicator(result, 'outdated').incomplete, true);
  assert.equal(result.score.known, 4);
});

test('находка неподтверждённой группы видна без доли и успешного результата проверки', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'unconfirmed', comparable: 4 },
    { state: 'empty', comparable: 0 },
    [outdatedAudit('prod', ['major'])],
  );
  const result = createResult(withEvidence, context());
  const outdated = check(result, 'outdated');
  assert.equal(outdated.status, 'no-data');
  assert.equal(outdated.code, 'registry-unconfirmed');
  assert.equal(outdated.facts.production, 1);
  assert.equal(outdated.facts.major, 1);
  assert.equal(outdated.facts.productionOutdatedPercent, undefined);
  assert.equal(indicator(result, 'outdated').status, 'fix');
  assert.equal(indicator(result, 'outdated').incomplete, true);
});

test('обе группы без сопоставимых зависимостей дают отдельную причину пропуска', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'empty', comparable: 0 },
    { state: 'empty', comparable: 0 },
  );
  const result = createResult(withEvidence, context());
  assert.equal(indicator(result, 'outdated').status, 'no-data');
  assert.equal(check(result, 'outdated').code, 'no-comparable-dependencies');
  assert.equal(check(result, 'outdated').facts.productionOutdatedPercent, undefined);
  assert.equal(check(result, 'outdated').facts.developmentOutdatedPercent, undefined);
  assert.equal(result.score.known, 3);
});

test('неизвестный знаменатель не превращает ноль аудита в подтверждённый результат', () => {
  const withEvidence = withOutdatedEvidence(
    { state: 'verified' },
    { state: 'empty', comparable: 0 },
    [outdatedAudit('prod', [])],
  );
  const result = createResult(withEvidence, context());
  const outdated = check(result, 'outdated');
  assert.equal(outdated.status, 'no-data');
  assert.equal(outdated.code, 'invalid-audit-value');
  assert.equal(outdated.facts.productionComparable, undefined);
  assert.equal(outdated.facts.production, undefined);
  assert.equal(outdated.facts.productionOutdatedPercent, undefined);
});

test('Prettier, версия Node.js и размер сборки передают факты, находки и детали', () => {
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
