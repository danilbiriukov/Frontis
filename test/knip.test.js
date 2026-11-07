import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { collectKnip, parseKnipReport } from '../dist/index.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/knip/${name}`, import.meta.url));

test('knip: находки разных типов с путями и строками', async () => {
  const result = await collectKnip({ projectDir: fixture('findings') });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.counts, { files: 1, dependencies: 1, exports: 1, types: 1 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.data.categories).sort()),
    { dependencies: 1, exports: 1, files: 1, types: 1 },
  );
  assert.match(result.data.knipVersion, /^\d+\.\d+\.\d+/);

  const byCode = Object.fromEntries(result.findings.map((finding) => [finding.code, finding]));
  assert.deepEqual(byCode['unused-file'].source, { file: 'src/orphan.js' });
  assert.equal(byCode['unused-dependency'].source.file, 'package.json');
  assert.match(byCode['unused-dependency'].message, /left-pad/);
  assert.deepEqual(byCode['unused-export'].source, { file: 'src/lib.ts', position: { startLine: 3, startColumn: 14 } });
  assert.equal(byCode['unused-type'].source.position.startLine, 5);
  for (const finding of result.findings) assert.equal(finding.severity, 'warning');
});

test('knip: проверка без находок успешна', async () => {
  const result = await collectKnip({ projectDir: fixture('clean') });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.counts, { files: 0, dependencies: 0, exports: 0, types: 0 });
  assert.deepEqual(result.findings, []);
});

test('knip: ошибка конфигурации отличается от успешной проверки', async () => {
  const result = await collectKnip({ projectDir: fixture('broken') });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'knip-failed');
  assert.match(result.reason, /knip\.json/);
});

test('knip: без установленного knip возвращается «Нет данных»', async (t) => {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-knip-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  await writeFile(join(projectDir, 'package.json'), '{"name":"no-knip"}');
  const result = await collectKnip({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'knip-not-installed');
});

test('knip: разбор формата knip 5 и групп символов', () => {
  const parsed = parseKnipReport({
    files: ['src/old.js'],
    issues: [{
      file: 'src\\a.ts',
      exports: [{ name: 'a', line: 2, col: 1 }],
      duplicates: [[{ name: 'b', line: 4, col: 1 }, { name: 'c', line: 4, col: 10 }]],
      classMembers: [{ name: 'm', line: 7 }],
    }],
  });
  assert.deepEqual(parsed.counts, { files: 1, dependencies: 0, exports: 1, types: 0 });
  assert.deepEqual(parsed.categories, { files: 1, exports: 1, duplicates: 1, classMembers: 1 });
  assert.deepEqual(parsed.findings.map(({ code, source }) => [code, source]), [
    ['unused-file', { file: 'src/old.js' }],
    ['unused-export', { file: 'src/a.ts', position: { startLine: 2, startColumn: 1 } }],
    ['duplicate-export', { file: 'src/a.ts', position: { startLine: 4, startColumn: 1 } }],
    ['knip-class-members', { file: 'src/a.ts', position: { startLine: 7 } }],
  ]);
  assert.match(parsed.findings[2].message, /b, c/);
});

test('knip: непригодный ответ не принимается за отсутствие находок', () => {
  for (const output of [null, [], {}, { issues: {} }, { issues: [{ exports: [] }] }, { issues: [{ file: 'a', exports: [{}] }] }]) {
    assert.equal(parseKnipReport(output), undefined);
  }
});
