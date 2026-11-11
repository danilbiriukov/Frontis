import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { reportSchema } from '@code-pushup/models';
import { createReport } from '../dist/core/report.js';
import { withCurrentRun, writeResultArtifacts } from '../dist/core/run-artifacts.js';

const runAt = '2026-11-07T07:00:00.000Z';
const commit = { hash: '1'.repeat(40), date: runAt, message: 'Первый коммит', author: 'Frontis Fixture' };
const audit = { slug: 'retained', title: 'Корректный аудит', value: 0, score: 1 };
const plugin = { slug: 'fixture', title: 'Проверка', icon: 'file', date: runAt, duration: 10, audits: [audit] };
const input = { runAt, durationMs: 20, commit };

async function outputDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-artifacts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('Report сохраняет пригодные аудиты и ссылки при частичном результате', () => {
  const report = createReport({
    ...input,
    plugins: [
      {
        ...plugin,
        audits: [audit, { ...audit, slug: 'invalid', value: false }, { ...audit, slug: 'skipped', isSkipped: true }],
        groups: [
          { slug: 'survives', title: 'Сохранённая группа', refs: [{ slug: 'retained', weight: 1 }, { slug: 'invalid', weight: 1 }] },
          { slug: 'dropped', title: 'Пустая группа', refs: [{ slug: 'skipped', weight: 1 }] },
        ],
      },
      { ...plugin, slug: 'without-data', audits: [] },
    ],
    categories: [
      {
        slug: 'quality', title: 'Качество', refs: [
          { type: 'group', plugin: 'fixture', slug: 'survives', weight: 1 },
          { type: 'group', plugin: 'fixture', slug: 'dropped', weight: 1 },
          { type: 'audit', plugin: 'fixture', slug: 'invalid', weight: 1 },
          { type: 'audit', plugin: 'without-data', slug: 'retained', weight: 1 },
        ],
      },
    ],
  });
  const parsed = reportSchema.parse(JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.commit.hash, commit.hash);
  assert.equal(parsed.commit.author, commit.author);
  assert.deepEqual(parsed.plugins.map(({ slug, audits }) => [slug, audits.map((item) => item.slug)]), [
    ['fixture', ['retained']],
  ]);
  assert.deepEqual(parsed.plugins[0].groups.map(({ slug, refs }) => [slug, refs.map((ref) => ref.slug)]), [
    ['survives', ['retained']],
  ]);
  assert.deepEqual(parsed.categories[0].refs.map(({ slug }) => slug), ['survives']);
});

test('Report отсутствует, если все аудиты пропущены или невалидны', () => {
  const report = createReport({
    ...input,
    plugins: [{ ...plugin, audits: [{ ...audit, isSkipped: true }, { ...audit, slug: 'invalid', score: -1 }] }],
  });
  assert.equal(report, undefined);
});

test('каталог артефактов принимает только один текущий запуск', async (t) => {
  const dir = await outputDir(t);
  const report = createReport({ ...input, plugins: [plugin] });
  await withCurrentRun(dir, async () => {
    await assert.rejects(withCurrentRun(dir, () => assert.fail('Второй запуск начался')), /уже идёт проверка/);
    await writeResultArtifacts(dir, report, { runAt });
  });
  assert.equal(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).date, runAt);
  assert.equal(JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')).runAt, runAt);
  await assert.rejects(stat(join(dir, `run-${process.pid}.lock`)), { code: 'ENOENT' });
});

test('проверка запускается после завершения владельца старой блокировки', async (t) => {
  const dir = await outputDir(t);
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.equal(child.status, 0);
  await writeFile(join(dir, 'run.lock'), `${child.pid}\n`);
  await writeFile(join(dir, `run-${child.pid}.lock`), '');
  assert.equal(await withCurrentRun(dir, async () => 0), 0);
});

test('проверка сохраняет файлы за пределами каталога артефактов, если .frontis является ссылкой', async (t) => {
  const dir = await outputDir(t);
  const target = join(dir, 'data');
  await mkdir(target);
  const original = join(target, 'report.json');
  await writeFile(original, '{"original":true}');
  const link = join(dir, '.frontis');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(withCurrentRun(link, () => assert.fail('Запуск начался')), /обычный каталог/);
  assert.equal(await readFile(original, 'utf8'), '{"original":true}');
});

test('сбой записи Report убирает частично опубликованный result.json', async (t) => {
  const dir = await outputDir(t);
  const report = createReport({ ...input, plugins: [plugin] });
  await assert.rejects(withCurrentRun(dir, async () => {
    await mkdir(join(dir, 'report.json'));
    await writeResultArtifacts(dir, report, { runAt });
  }));
  await assert.rejects(stat(join(dir, 'result.json')), { code: 'ENOENT' });
  await assert.rejects(stat(join(dir, `run-${process.pid}.lock`)), { code: 'ENOENT' });
});
