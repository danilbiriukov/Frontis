import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectProjectInfo } from '../dist/index.js';

process.env.GIT_CEILING_DIRECTORIES = tmpdir();

async function project(t, files = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-project-info-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries({ 'package.json': '{"name":"demo","version":"1.2.3"}', ...files })) {
    if (content !== undefined) await writeFile(join(projectDir, file), content);
  }
  return projectDir;
}

function git(projectDir, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=Frontis', '-c', 'user.email=frontis@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: projectDir, encoding: 'utf8' },
  ).trim();
}

for (const [lockFile, name] of [['package-lock.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']]) {
  test(`менеджер пакетов ${name} определяется по ${lockFile}`, async (t) => {
    const projectDir = await project(t, { [lockFile]: '' });
    const result = await collectProjectInfo({ projectDir });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data.packageManager, { name, source: 'lock-file', version: null });
    assert.deepEqual(result.data.lockFiles, [lockFile]);
    assert.deepEqual(result.findings, []);
  });
}

test('поле packageManager важнее lock-файлов', async (t) => {
  const projectDir = await project(t, {
    'package.json': JSON.stringify({ name: 'demo', packageManager: 'yarn@4.5.0+sha512.abc' }),
    'package-lock.json': '',
  });
  const { data } = await collectProjectInfo({ projectDir });
  assert.deepEqual(data.packageManager, { name: 'yarn', source: 'package-json', version: '4.5.0' });
});

test('при нескольких lock-файлах выбирается pnpm, затем yarn, затем npm', async (t) => {
  const projectDir = await project(t, { 'package-lock.json': '', 'yarn.lock': '', 'pnpm-lock.yaml': '' });
  const { data } = await collectProjectInfo({ projectDir });
  assert.equal(data.packageManager.name, 'pnpm');
  assert.deepEqual(data.lockFiles, ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json']);

  await rm(join(projectDir, 'pnpm-lock.yaml'));
  assert.equal((await collectProjectInfo({ projectDir })).data.packageManager.name, 'yarn');
});

test('без lock-файла и поля packageManager менеджер не определён', async (t) => {
  const projectDir = await project(t, { 'package.json': '{"packageManager":"bun@1.1.0"}' });
  const { data } = await collectProjectInfo({ projectDir });
  assert.equal(data.packageManager, null);
  assert.deepEqual(data.lockFiles, []);
  assert.equal(data.name, null);
  assert.equal(data.version, null);
});

test('в каталоге без Git остальные поля доступны', async (t) => {
  const projectDir = await project(t, { 'package-lock.json': '' });
  const result = await collectProjectInfo({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.git, null);
  assert.equal(result.data.name, 'demo');
  assert.equal(result.data.version, '1.2.3');
  assert.equal(result.data.packageManager.name, 'npm');
  assert.equal(result.data.runtime.node, process.versions.node);
});

test('из Git читаются ветка и последний коммит', async (t) => {
  const projectDir = await project(t);
  git(projectDir, 'init', '--template=', '--initial-branch=feature/demo');
  const { data: empty } = await collectProjectInfo({ projectDir });
  assert.deepEqual(empty.git, { branch: 'feature/demo', commit: null });

  git(projectDir, 'add', 'package.json');
  git(projectDir, 'commit', '-m', 'Первый коммит');
  const hash = git(projectDir, 'rev-parse', 'HEAD');
  const { data } = await collectProjectInfo({ projectDir });
  assert.equal(data.git.branch, 'feature/demo');
  assert.equal(data.git.commit.hash, hash);
  assert.equal(data.git.commit.message, 'Первый коммит');
  assert.ok(!Number.isNaN(Date.parse(data.git.commit.date)));

  git(projectDir, 'checkout', '--detach', '--quiet');
  const { data: detached } = await collectProjectInfo({ projectDir });
  assert.equal(detached.git.branch, null);
  assert.equal(detached.git.commit.hash, hash);
});

test('без package.json возвращается «Нет данных»', async (t) => {
  const projectDir = await project(t, { 'package.json': undefined });
  const result = await collectProjectInfo({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-package-json');
  assert.ok(result.action);
});

for (const [content, title] of [['{"name":', 'некорректный JSON'], ['[]', 'массив']]) {
  test(`package.json с содержимым «${title}» даёт ошибку`, async (t) => {
    const projectDir = await project(t, { 'package.json': content });
    const result = await collectProjectInfo({ projectDir });
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'invalid-package-json');
  });
}
