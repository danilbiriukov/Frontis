import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createImportMapCollector, findImports, selectMostOutdated } from '../dist/index.js';

process.env.GIT_CEILING_DIRECTORIES = tmpdir();

async function project(t, files) {
  const projectDir = await mkdtemp(join(tmpdir(), 'frontis-import-map-'));
  t.after(() => rm(projectDir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(projectDir, file)), { recursive: true });
    await writeFile(join(projectDir, file), content);
  }
  return projectDir;
}

const outdated = [
  { name: 'lodash', current: '3.10.1', latest: '4.17.21' },
  { name: '@scope/ui', current: '1.0.0', latest: '1.4.0' },
];

test('импорт пакета, его подпути и пакет с похожим именем различаются', () => {
  const source = [
    "import _ from 'lodash';",
    "import fp from 'lodash/fp';",
    "import es from 'lodash-es';",
    "import { Button } from '@scope/ui/button';",
    "import other from '@scope/ui-kit';",
    "export * from 'lodash/array';",
    "const lazy = await import('lodash');",
    "const cjs = require(\"@scope/ui\");",
    "import 'lodashx';",
  ].join('\n');
  assert.deepEqual(findImports(source, ['lodash', '@scope/ui']), [
    { name: 'lodash', line: 1, specifier: 'lodash' },
    { name: 'lodash', line: 2, specifier: 'lodash/fp' },
    { name: '@scope/ui', line: 4, specifier: '@scope/ui/button' },
    { name: 'lodash', line: 6, specifier: 'lodash/array' },
    { name: 'lodash', line: 7, specifier: 'lodash' },
    { name: '@scope/ui', line: 8, specifier: '@scope/ui' },
  ]);
});

test('выбираются до пяти наиболее отстающих пакетов', () => {
  const packages = [
    { name: 'patch', current: '1.0.0', latest: '1.0.9' },
    { name: 'minor', current: '1.0.0', latest: '1.5.0' },
    { name: 'major-1', current: '1.9.9', latest: '2.0.0' },
    { name: 'major-3', current: '1.0.0', latest: '4.0.0' },
    { name: 'b-major-1', current: '^2.0.0', latest: '3.0.0' },
    { name: 'unknown', current: 'git+https://example.com/x', latest: '1.0.0' },
    { name: 'minor-small', current: '1.0.0', latest: '1.1.0' },
  ];
  assert.deepEqual(selectMostOutdated(packages).map(({ name }) => name), [
    'major-3', 'b-major-1', 'major-1', 'minor', 'minor-small',
  ]);
  assert.deepEqual(selectMostOutdated(packages, 2).map(({ name }) => name), ['major-3', 'b-major-1']);
});

test('карта импортов: относительные пути, стабильный результат', async (t) => {
  const projectDir = await project(t, {
    'src/b.ts': "import { chunk } from 'lodash/array';\n",
    'src/a.tsx': "import _ from 'lodash';\nimport { Button } from '@scope/ui';\n",
    'src/c.JS': "import es from 'lodash-es';\n",
    'src/readme.md': "import _ from 'lodash';\n",
    'node_modules/x/index.js': "require('lodash');\n",
    'dist/bundle.js': "require('lodash');\n",
  });
  const collect = createImportMapCollector({ packages: outdated });
  const first = await collect({ projectDir });
  assert.equal(first.status, 'ok');
  assert.equal(first.data.scannedFiles, 3);
  assert.deepEqual(first.data.packages, [
    {
      name: 'lodash',
      current: '3.10.1',
      latest: '4.17.21',
      imports: [
        { file: 'src/a.tsx', line: 1, specifier: 'lodash' },
        { file: 'src/b.ts', line: 1, specifier: 'lodash/array' },
      ],
    },
    {
      name: '@scope/ui',
      current: '1.0.0',
      latest: '1.4.0',
      imports: [{ file: 'src/a.tsx', line: 2, specifier: '@scope/ui' }],
    },
  ]);
  assert.deepEqual(first.findings, []);
  assert.deepEqual(await collect({ projectDir }), first);
});

test('в Git-репозитории учитывается .gitignore', async (t) => {
  const projectDir = await project(t, {
    '.gitignore': 'generated/\n',
    'src/a.js': "import _ from 'lodash';\n",
    'generated/b.js': "import _ from 'lodash';\n",
  });
  execFileSync('git', ['init', '--template='], { cwd: projectDir, stdio: 'ignore' });
  const result = await createImportMapCollector({ packages: outdated })({ projectDir });
  assert.deepEqual(result.data.packages[0].imports.map(({ file }) => file), ['src/a.js']);
});

test('без отстающих пакетов карта пустая', async (t) => {
  const projectDir = await project(t, { 'src/a.js': "import _ from 'lodash';\n" });
  const result = await createImportMapCollector({ packages: [] })({ projectDir });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data.packages, []);
});

test('без сведений об отставании возвращается «Нет данных»', async (t) => {
  const projectDir = await project(t, { 'src/a.js': '' });
  const result = await createImportMapCollector({ packages: undefined })({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-outdated-data');
});

test('без исходников возвращается «Нет данных»', async (t) => {
  const projectDir = await project(t, { 'README.md': '# demo\n' });
  const result = await createImportMapCollector({ packages: outdated })({ projectDir });
  assert.equal(result.status, 'no-data');
  assert.equal(result.code, 'no-sources');
});

test('длинная последовательность цифр без версии не задерживает сортировку', () => {
  const moduleUrl = new URL('../dist/collectors/import-map.js', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', [
    "import assert from 'node:assert/strict';",
    "import { selectMostOutdated } from " + JSON.stringify(moduleUrl) + ";",
    "const invalid = { name: 'a', current: '9'.repeat(250_000), latest: '3.0.0' };",
    "const valid = { name: 'b', current: '^2.0.0', latest: 'v3.0.0-rc.1' };",
    "assert.deepEqual(selectMostOutdated([invalid, valid], 1), [valid]);",
  ].join('\n')], { timeout: 5000 });
});
