import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../dist/core/config.js';
import { createResult, createResultImportMap } from '../dist/core/result.js';
import { createImportMapCollector, findImports, selectMostOutdated } from '../dist/index.js';
import { generateHtmlReport } from '../dist/report/index.js';

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

test('карта пропускает отслеживаемый путь через ссылку за пределы проекта', async (t) => {
  const projectDir = await project(t, { 'src/entry.js': "import 'lodash';\n", 'own.js': "import '@scope/ui';\n" });
  const outside = await project(t, { 'entry.js': "import 'lodash/outside';\n" });
  execFileSync('git', ['init', '--template='], { cwd: projectDir, stdio: 'ignore' });
  execFileSync('git', ['add', 'src/entry.js'], { cwd: projectDir, stdio: 'ignore' });
  await rename(join(projectDir, 'src'), join(projectDir, '.old'));
  await symlink(outside, join(projectDir, 'src'), 'junction');
  const result = await createImportMapCollector({ packages: outdated })({ projectDir });
  assert.equal(result.status, 'ok');
  assert.equal(result.data.scannedFiles, 1);
  assert.deepEqual(result.data.packages[0].imports, []);
  assert.deepEqual(result.data.packages[1].imports, [{ file: 'own.js', line: 1, specifier: '@scope/ui' }]);
});

test('отчёт строит карту из полных подтверждённых данных и ограничивает вывод HTML', async (t) => {
  const issue = (name, version) => ({
    severity: 'info',
    message: `Package \`${name}\` requires a **major** update from **1.0.0** to **${version}**.`,
  });
  const production = [
    ...Array.from({ length: 10 }, (_, index) => issue(`lib-${index}`, '2.0.0')),
    issue('zz-largest', '8.0.0'),
  ];
  const projectDir = await project(t, {
    'src/index.js': Array.from({ length: 11 }, (_, index) => `import 'zz-largest/<entry-${index}>';\n`).join(''),
  });
  const report = {
    commit: null, date: '2026-11-11T00:00:00.000Z', duration: 1, version: '0.126.4',
    plugins: [{ slug: 'js-packages', audits: [
      { slug: 'npm-outdated-prod', value: production.length, details: { issues: production } },
      { slug: 'npm-outdated-dev', value: 1, details: { issues: [issue('unconfirmed', '100.0.0')] } },
      { slug: 'frontis-outdated-evidence', value: 1, details: { table: { rows: [
        { group: 'prod', comparable: production.length, state: 'verified' },
        { group: 'dev', comparable: 1, state: 'unconfirmed' },
      ] } } },
    ] }],
  };
  const { modules, thresholds } = resolveConfig({});
  const context = {
    toolVersion: '0.1.0', project: { name: 'demo', version: null, branch: null }, modules, thresholds, noData: [],
  };
  const importMap = await createResultImportMap(report, projectDir, modules.outdated);
  const result = createResult(report, { ...context, importMap });
  assert.deepEqual(result.score, createResult(report, context).score);
  assert.equal(result.importMap.status, 'ok');
  assert.deepEqual(result.importMap.packages.map(({ name }) => name), [
    'zz-largest', 'lib-0', 'lib-1', 'lib-2', 'lib-3',
  ]);
  assert.equal(result.importMap.packages[0].imports.length, 11);
  const html = generateHtmlReport({ result });
  assert.match(html, /Места использования отстающих пакетов/);
  assert.match(html, /zz-largest\/&lt;entry-0&gt;/);
  assert.doesNotMatch(html, /<entry-|entry-10/);
  const noEvidence = { ...report, plugins: [{ slug: 'js-packages', audits: report.plugins[0].audits.slice(0, 2) }] };
  assert.equal((await createResultImportMap(noEvidence, projectDir, modules.outdated)).code, 'no-outdated-data');
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
