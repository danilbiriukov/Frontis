import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { runGuardedPlugins } from '../dist/core/plugin-guard.js';

const adapter = new URL('./fixtures/plugin-guard.mjs', import.meta.url).href;

function task(slug, { mode, checkedFiles, enabled = true, timeoutMs = 10_000 } = {}) {
  return { slug, enabled, timeoutMs, module: adapter, options: { slug, mode, checkedFiles } };
}

test('охранник продолжает запуск после ошибок и сохраняет причины без данных', async (t) => {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-plugin-guard-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  execFileSync('git', ['init', '--template='], { cwd: projectDir, stdio: 'ignore' });
  const outputDir = join(projectDir, '.frontis');
  const noDataFile = join(outputDir, 'no-data.json');
  const result = await runGuardedPlugins(projectDir, [
    { ...task('disabled', { enabled: false }), module: 'missing-disabled-package' },
    task('unavailable', { mode: 'unavailable' }),
    task('crash', { mode: 'crash' }),
    task('collector-error', { mode: 'collector-error' }),
    task('timeout', { mode: 'hang', timeoutMs: 1600 }),
    task('invalid', { mode: 'invalid' }),
    task('zero-files', { checkedFiles: 0 }),
    task('success', { checkedFiles: 1 }),
  ]);

  assert.deepEqual(result.noData.map(({ plugin, code }) => [plugin, code]), [
    ['disabled', 'disabled'],
    ['unavailable', 'tool-unavailable'],
    ['crash', 'plugin-error'],
    ['collector-error', 'collector-failed'],
    ['timeout', 'timeout'],
    ['invalid', 'invalid-result'],
    ['zero-files', 'no-files'],
  ]);
  assert(result.noData.every(({ reason, action }) => reason.length > 0 && action.length > 0));
  assert.equal(result.noData[0].logFile, undefined);
  assert.deepEqual(result.reports.map(({ slug, audits }) => [slug, audits[0].value]), [['success', 0]]);
  assert.deepEqual(JSON.parse(await readFile(noDataFile, 'utf8')), result.noData);

  const log = await readFile(join(outputDir, result.noData[2].logFile), 'utf8');
  assert.match(log, /Техническая ошибка контрольного плагина/);
  assert.match(log, /Исходная ошибка сборщика/);
  assert.match(log, /Запущен дочерний процесс: \d+/);

  const next = await runGuardedPlugins(projectDir, [task('success', { checkedFiles: 1 })]);
  assert.deepEqual(next.noData, []);
  assert.deepEqual(JSON.parse(await readFile(noDataFile, 'utf8')), []);
  assert.deepEqual((await readdir(outputDir)).sort(), ['logs', 'no-data.json']);

  await setTimeout(2300);
  await assert.rejects(stat(join(projectDir, 'late.txt')), { code: 'ENOENT' });
});
