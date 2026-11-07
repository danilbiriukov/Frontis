import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createBuildSizeCollector } from '../dist/index.js';

const MB = 1024 * 1024;

async function project(t, files) {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-build-size-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(projectDir, file)), { recursive: true });
    await writeFile(join(projectDir, file), Buffer.alloc(bytes));
  }
  return projectDir;
}

const collect = (projectDir, maxMb = 5, buildDir = 'dist') =>
  createBuildSizeCollector({ buildDir: join(projectDir, buildDir), maxMb })({ projectDir });

test('суммарный размер, число файлов и пять крупнейших файлов', async (t) => {
  const projectDir = await project(t, {
    'dist/index.html': 100,
    'dist/assets/app.js': 5000,
    'dist/assets/vendor.js': 9000,
    'dist/assets/app.css': 700,
    'dist/assets/b.png': 2000,
    'dist/assets/a.png': 2000,
    'dist/favicon.ico': 50,
    'src/main.js': 999_999,
  });
  const result = await collect(projectDir);
  assert.equal(result.status, 'ok');
  assert.equal(result.data.buildDir, 'dist');
  assert.equal(result.data.totalBytes, 18_850);
  assert.equal(result.data.files, 7);
  assert.deepEqual(result.data.largest, [
    { file: 'dist/assets/vendor.js', bytes: 9000 },
    { file: 'dist/assets/app.js', bytes: 5000 },
    { file: 'dist/assets/a.png', bytes: 2000 },
    { file: 'dist/assets/b.png', bytes: 2000 },
    { file: 'dist/assets/app.css', bytes: 700 },
  ]);
  assert.equal(result.data.exceeded, false);
  assert.deepEqual(result.findings, []);
});

test('порог maxMb переводится в байты как 1024 × 1024', async (t) => {
  const projectDir = await project(t, { 'dist/a.bin': MB / 2 });
  const atLimit = await collect(projectDir, 0.5);
  assert.equal(atLimit.data.maxBytes, MB / 2);
  assert.equal(atLimit.data.exceeded, false);

  await writeFile(join(projectDir, 'dist/b.bin'), Buffer.alloc(1));
  const over = await collect(projectDir, 0.5);
  assert.equal(over.data.totalBytes, MB / 2 + 1);
  assert.equal(over.data.exceeded, true);
  assert.deepEqual(over.findings.map(({ code, severity }) => [code, severity]), [['build-size-exceeded', 'error']]);
});

test('отсутствующая папка сборки даёт «Нет данных»', async (t) => {
  const projectDir = await project(t, { 'src/a.js': 1 });
  const result = await collect(projectDir);
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-build-dir');
  assert.match(result.reason, /dist/);
});

test('файл вместо папки и пустая папка дают «Нет данных»', async (t) => {
  const projectDir = await project(t, { dist: 10 });
  assert.equal((await collect(projectDir)).code, 'no-build-dir');

  await mkdir(join(projectDir, 'build'));
  assert.equal((await collect(projectDir, 5, 'build')).code, 'empty-build-dir');
});
