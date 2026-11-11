import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { collect } from '@code-pushup/core';
import { reportSchema } from '@code-pushup/models';
import { resolveConfig } from '../dist/core/config.js';
import { createReport } from '../dist/core/report.js';
import { createResult } from '../dist/core/result.js';
import { writeResultArtifacts } from '../dist/core/run-artifacts.js';
import { createKnipPlugin, createPrettierPlugin } from '../dist/index.js';

const officialFixture = new URL('../docs/code-pushup-compatibility/sample-report.json', import.meta.url);
const partialFixture = new URL('./fixtures/result/report.json', import.meta.url);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function parseReport(value, source) {
  const parsed = reportSchema.safeParse(value);
  assert(parsed.success, `Нарушен контракт Code PushUp Report для ${source}: ${parsed.error?.message}`);
  return parsed.data;
}

function resultFrom(report) {
  const { modules, thresholds } = resolveConfig({});
  return createResult(report, {
    toolVersion: '0.1.0',
    project: { name: 'demo', version: null, branch: null },
    modules,
    thresholds,
    noData: [],
  });
}

test('записанный Report связывает образец Code PushUp #39 и реальные аудиты плагинов #44 с оценкой', async (t) => {
  const official = parseReport(await readJson(officialFixture), 'образца из #39');
  const cache = join(import.meta.dirname, '..', '.cache');
  await mkdir(cache, { recursive: true });
  const project = await mkdtemp(join(cache, 'frontis-contract-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await writeFile(join(project, '.prettierrc'), '{}\n');
  await writeFile(join(project, '.prettierignore'), '.prettierrc\n');
  await writeFile(join(project, 'demo.js'), 'export const demo=1\n');
  const own = await collect({
    cache: {},
    plugins: [
      createKnipPlugin(join(import.meta.dirname, 'fixtures', 'knip', 'findings')),
      createPrettierPlugin(project),
    ],
  });
  const report = createReport({
    plugins: [...official.plugins, ...own.plugins],
    commit: official.commit,
    runAt: official.date,
    durationMs: official.duration,
  });
  assert(report, 'Frontis не сформировал Report из пригодных аудитов');
  await writeResultArtifacts(project, report, resultFrom(report));
  const storedReport = parseReport(await readJson(join(project, 'report.json')), 'записанного report.json');
  const result = await readJson(join(project, 'result.json'));
  assert.equal(storedReport.commit, null);
  assert.equal(result.project.commit, null);
  assert.equal(result.report.codePushUpVersion, storedReport.version);

  const checks = new Map(result.indicators.flatMap(({ checks }) => checks.map((check) => [check.id, check])));
  assert.deepEqual(checks.get('outdated').audits, ['js-packages/npm-outdated-prod', 'js-packages/npm-outdated-dev']);
  assert.deepEqual(checks.get('audit').audits, ['js-packages/npm-audit-prod', 'js-packages/npm-audit-dev']);
  assert.deepEqual(checks.get('lint').facts, { errors: 1, warnings: 1 });
  assert.equal(checks.get('coverage').facts.branches, 50);
  assert.deepEqual(checks.get('knip').facts, { files: 1, dependencies: 1, exports: 1, types: 1, otherFindings: 0 });
  assert.deepEqual(checks.get('prettier').facts, { checkedFiles: 1, unformatted: 1, parseErrors: 0 });
  assert.equal(checks.get('prettier').details.issues[0].audit, 'frontis-prettier/unformatted-files');

  const knownAudits = new Set(storedReport.plugins.flatMap(({ slug, audits }) =>
    audits.map((audit) => `${slug}/${audit.slug}`)));
  for (const check of checks.values()) {
    for (const audit of check.audits) {
      assert(knownAudits.has(audit), `Проверка ${check.id} ссылается на отсутствующий аудит ${audit}`);
    }
  }
});

test('схема Report отклоняет отсутствие commit, пустые плагины и неверный тип значения', async () => {
  const fixture = parseReport(await readJson(partialFixture), 'фикстуры из #12');
  assert.equal(fixture.commit, null);
  const [plugin] = fixture.plugins;
  const [audit] = plugin.audits;
  const cases = [
    ['commit', { ...fixture, commit: undefined }],
    ['plugins', { ...fixture, plugins: [] }],
    ['plugins.0.audits', { ...fixture, plugins: [{ ...plugin, groups: undefined, audits: [] }], categories: undefined }],
    ['plugins.0.audits.0.value', { ...fixture, plugins: [{ ...plugin, audits: [{ ...audit, value: '0' }] }] }],
  ];
  for (const [path, value] of cases) {
    const parsed = reportSchema.safeParse(value);
    assert(!parsed.success, `Схема Report приняла непригодные данные в ${path}`);
    assert(parsed.error.issues.some((issue) => issue.path.join('.') === path), parsed.error.message);
  }
});

test('частичный Report сохраняет доступные ссылки и объясняет отсутствие аудита покрытия строк', async () => {
  const official = parseReport(await readJson(officialFixture), 'образца из #39');
  const coverage = official.plugins.find(({ slug }) => slug === 'coverage');
  assert(coverage, 'В образце из #39 нет плагина покрытия');
  const groupRef = { type: 'group', plugin: 'coverage', slug: 'coverage', weight: 1 };
  const survivingAuditRef = { type: 'audit', plugin: 'coverage', slug: 'branch-coverage', weight: 1 };
  const missingAuditRef = { type: 'audit', plugin: 'coverage', slug: 'line-coverage', weight: 1 };
  const report = createReport({
    plugins: [{ ...coverage, audits: coverage.audits.filter(({ slug }) => slug !== 'line-coverage') }],
    categories: [{ slug: 'quality', title: 'Качество', refs: [groupRef, survivingAuditRef, missingAuditRef] }],
    commit: null,
    runAt: official.date,
    durationMs: official.duration,
  });
  const partial = parseReport(report, 'частичного результата');
  assert.deepEqual(partial.categories[0].refs, [groupRef, survivingAuditRef]);
  assert.deepEqual(partial.plugins[0].groups[0].refs.map(({ slug }) => slug), ['function-coverage', 'branch-coverage']);
  const check = resultFrom(partial).indicators.find(({ id }) => id === 'coverage').checks[0];
  assert.equal(check.status, 'no-data');
  assert.equal(check.code, 'missing-audit');
  assert.deepEqual(check.audits, ['coverage/function-coverage', 'coverage/branch-coverage']);
  assert.deepEqual(check.facts, { functions: 100, branches: 50, warn: 65, target: 90 });
});
