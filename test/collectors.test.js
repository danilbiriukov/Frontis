import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collect } from '@code-pushup/core';
import { pluginConfigSchema, reportSchema } from '@code-pushup/models';
import { CollectorRunError, createCollectorRunner } from '../dist/index.js';

const context = { projectDir: process.cwd(), signal: new AbortController().signal };
const audit = { slug: 'sample-findings', title: 'Контрольные находки' };
const finding = {
  code: 'sample-finding',
  message: 'Контрольная находка',
  severity: 'warning',
  source: { file: 'package.json', position: { startLine: 1, startColumn: 1 } },
};

function makePlugin(collector) {
  return pluginConfigSchema.parse({
    slug: 'frontis-sample',
    title: 'Контрольный плагин Frontis',
    icon: 'file',
    audits: [audit],
    runner: createCollectorRunner(context, collector, (result) => [{
      slug: audit.slug,
      score: result.data.count === 0 ? 1 : 0,
      value: result.data.count,
      details: {
        issues: result.findings.map(({ message, severity, source }) => ({ message, severity, source })),
      },
    }]),
  });
}

function collectFindings(findings) {
  return async (input) => {
    assert.strictEqual(input, context);
    return { status: 'ok', data: { count: findings.length }, findings };
  };
}

test('сборщик добавляет стандартный аудит Code PushUp с местом находки', async () => {
  const pluginConfig = makePlugin(collectFindings([finding]));
  const report = reportSchema.parse(await collect({ cache: {}, plugins: [pluginConfig] }));
  const [plugin] = report.plugins;
  assert.equal(plugin.slug, 'frontis-sample');
  assert.deepEqual(plugin.audits, [{
    ...audit,
    score: 0,
    value: 1,
    details: {
      issues: [{ message: finding.message, severity: finding.severity, source: finding.source }],
    },
  }]);
});

test('успешный сбор без находок сохраняется как аудит с нулём', async () => {
  const pluginConfig = makePlugin(collectFindings([]));
  const report = reportSchema.parse(await collect({ cache: {}, plugins: [pluginConfig] }));
  const [result] = report.plugins[0].audits;
  assert.equal(result.value, 0);
  assert.equal(result.score, 1);
  assert.deepEqual(result.details.issues, []);
});

for (const status of ['no-data', 'error']) {
  test(`сборщик передаёт причину ${status} вместо аудита`, async () => {
    const cause = new Error('Сообщение инструмента');
    const result = {
      status,
      code: 'fixture-unavailable',
      reason: 'Нет результата проверки',
      action: 'Проверьте настройки инструмента.',
      cause,
    };
    const pluginConfig = makePlugin(() => result);
    await assert.rejects(collect({ cache: {}, plugins: [pluginConfig] }), (error) => {
      assert(error instanceof CollectorRunError);
      assert.strictEqual(error.result, result);
      assert.equal(error.message, result.reason);
      assert.strictEqual(error.cause, cause);
      return true;
    });
  });
}
