import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { runGuardedPlugins } from '../dist/core/plugin-guard.js';

const adapter = new URL('./fixtures/plugin-guard.mjs', import.meta.url).href;

function task(slug, { mode, checkedFiles, enabled = true, timeoutMs = 10_000 } = {}) {
  return { slug, enabled, timeoutMs, module: adapter, options: { slug, mode, checkedFiles } };
}

async function createProject(t) {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-plugin-guard-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  execFileSync('git', ['init', '--template='], { cwd: projectDir, stdio: 'ignore' });
  return projectDir;
}

test('запуск плагинов продолжается после ошибок и сохраняет причины пропусков', async (t) => {
  const projectDir = await createProject(t);
  const outputDir = join(projectDir, '.frontis');
  const noDataFile = join(outputDir, 'no-data.json');
  const result = await runGuardedPlugins(projectDir, [
    { ...task('disabled', { enabled: false }), module: 'missing-disabled-package' },
    task('unavailable', { mode: 'unavailable' }),
    task('crash', { mode: 'crash' }),
    task('collector-error', { mode: 'collector-error' }),
    task('timeout', { mode: 'hang', timeoutMs: 5000 }),
    task('invalid', { mode: 'invalid' }),
    task('zero-files', { checkedFiles: 0 }),
    task('skipped', { mode: 'skipped' }),
    task('success', { mode: 'logged-success', checkedFiles: 1 }),
  ]);

  assert.deepEqual(result.noData.map(({ plugin, code }) => [plugin, code]), [
    ['disabled', 'disabled'],
    ['unavailable', 'tool-unavailable'],
    ['crash', 'plugin-error'],
    ['collector-error', 'collector-failed'],
    ['timeout', 'timeout'],
    ['invalid', 'invalid-result'],
    ['zero-files', 'no-files'],
    ['skipped', 'no-audits'],
  ]);
  assert(result.noData.every(({ reason, action }) => reason.length > 0 && action.length > 0));
  assert.equal(result.noData[0].logFile, undefined);
  assert.deepEqual(result.reports.map(({ slug, audits }) => [slug, audits[0].value]), [['success', 0]]);
  assert.deepEqual(JSON.parse(await readFile(noDataFile, 'utf8')), result.noData);

  const log = await readFile(join(outputDir, result.noData[2].logFile), 'utf8');
  assert.match(log, /Техническая ошибка контрольного плагина/);
  assert.match(log, /Исходная ошибка сборщика/);
  assert.match(log, /Запущен дочерний процесс: \d+/);
  assert.match(log, /Технический вывод успешной проверки/);

  const next = await runGuardedPlugins(projectDir, [task('success', { checkedFiles: 1 })]);
  assert.deepEqual(next.noData, []);
  assert.deepEqual(JSON.parse(await readFile(noDataFile, 'utf8')), []);
  assert.deepEqual((await readdir(outputDir)).sort(), ['logs', 'no-data.json']);

  await setTimeout(5800);
  await assert.rejects(stat(join(projectDir, 'late.txt')), { code: 'ENOENT' });
});

test('файловый запуск ограничен временной подпапкой плагина', async (t) => {
  const projectDir = await createProject(t);
  const protectedDir = join(projectDir, 'protected', 'nested');
  const protectedFile = join(protectedDir, 'keep.txt');
  await mkdir(protectedDir, { recursive: true });
  await writeFile(protectedFile, 'Файл проекта');

  const { reports, noData } = await runGuardedPlugins(projectDir, [
    task('outside', { mode: 'outside-output' }),
    task('root', { mode: 'root-output' }),
    task('linked', { mode: 'linked-output' }),
    task('safe', { mode: 'file-runner' }),
  ]);

  assert.deepEqual(noData.map(({ plugin, code }) => [plugin, code]), [
    ['outside', 'unsafe-output-path'],
    ['root', 'unsafe-output-path'],
    ['linked', 'unsafe-output-path'],
  ]);
  assert.deepEqual(reports.map(({ slug }) => slug), ['safe']);
  assert.equal(await readFile(protectedFile, 'utf8'), 'Файл проекта');
});

test('служебное IPC-сообщение не заменяет итог, некорректный итог остаётся ошибкой одного плагина', async (t) => {
  const projectDir = await createProject(t);
  const { reports, noData } = await runGuardedPlugins(projectDir, [
    task('progress', { mode: 'progress' }),
    task('invalid-message', { mode: 'invalid-message' }),
    task('no-result', { mode: 'no-result' }),
    task('after-message'),
  ]);

  assert.deepEqual(reports.map(({ slug }) => slug), ['progress', 'after-message']);
  assert.deepEqual(noData.map(({ plugin, code }) => [plugin, code]), [
    ['invalid-message', 'invalid-result'],
    ['no-result', 'invalid-result'],
  ]);
  assert.deepEqual(JSON.parse(await readFile(join(projectDir, '.frontis', 'no-data.json'), 'utf8')), noData);
  const log = await readFile(join(projectDir, '.frontis', noData[0].logFile), 'utf8');
  assert.match(log, /Процесс плагина завершился без итогового сообщения/);
});

test('в отчёт входят только полные аудиты, прошедшие проверку после адаптера', async (t) => {
  const projectDir = await createProject(t);
  const { reports, noData } = await runGuardedPlugins(projectDir, [
    task('missing-audit', { mode: 'missing-audit' }),
    task('invalidated', { mode: 'invalidated' }),
    task('complete'),
  ]);

  assert.deepEqual(reports.map(({ slug }) => slug), ['complete']);
  assert.deepEqual(noData.map(({ plugin, code }) => [plugin, code]), [
    ['missing-audit', 'invalid-result'],
    ['invalidated', 'invalid-result'],
  ]);
  const log = await readFile(join(projectDir, '.frontis', noData[0].logFile), 'utf8');
  assert.match(log, /Объявлены: findings, second\. Возвращены: findings\./);
});
