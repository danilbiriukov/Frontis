import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { resolveConfig } from '../dist/core/config.js';
import { createEngineConfig, loadEngineConfig } from '../dist/core/engine-config.js';
import { runGuardedPlugins } from '../dist/core/plugin-guard.js';

const adapter = 'control-adapter';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-engine-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('настройки движка используют корень проекта, явные пути и тайм-ауты модулей', async (t) => {
  const configDir = await tempDir(t);
  const projectDir = join(configDir, 'app');
  const buildDir = join(configDir, 'bundle');
  const eslintrc = join(projectDir, 'eslint.config.mjs');
  const lcovFile = join(projectDir, 'coverage', 'lcov.info');
  const configPath = join(configDir, 'frontis.config.mjs');
  await Promise.all([
    mkdir(join(projectDir, 'coverage'), { recursive: true }),
    mkdir(buildDir),
    writeFile(configPath, `export default {
      projectDir: 'app', buildDir: 'bundle', outFile: 'reports/summary.html', open: true,
      timeoutMs: 30000, testCommand: 'npm test',
      thresholds: { buildSize: { maxMb: 3 } },
      modules: { lint: { timeoutMs: 7000 }, prettier: { enabled: false } }
    };`),
  ]);
  await Promise.all([
    writeFile(join(projectDir, 'package.json'), '{"name":"demo","packageManager":"npm@11.12.1"}'),
    writeFile(join(projectDir, 'yarn.lock'), ''),
    writeFile(eslintrc, 'export default [];'),
    writeFile(join(projectDir, '.eslintrc.json'), '{}'),
    writeFile(lcovFile, 'TN:\n'),
    writeFile(join(projectDir, 'lcov.info'), 'TN:\n'),
  ]);

  const plan = await loadEngineConfig(configDir, {
    audit: adapter, lint: adapter, prettier: adapter, coverage: adapter, 'build-size': adapter,
  });
  assert.equal(plan.configPath, configPath);
  assert.equal(plan.config.projectDir, projectDir);
  assert.equal(plan.config.outFile, join(configDir, 'reports', 'summary.html'));
  assert.equal(plan.config.open, true);
  assert.equal(plan.outputDir, join(projectDir, '.frontis'));
  assert.equal(plan.projectInfo.data.name, 'demo');
  assert.deepEqual(plan.plugins, [
    { slug: 'audit', module: adapter, enabled: true, timeoutMs: 30000, options: { packageManager: 'npm' } },
    { slug: 'lint', module: adapter, enabled: true, timeoutMs: 7000, options: { eslintrc } },
    { slug: 'coverage', module: adapter, enabled: true, timeoutMs: 30000, options: { reports: [lcovFile], testCommand: undefined } },
    { slug: 'build-size', module: adapter, enabled: true, timeoutMs: 30000, options: { buildDir, maxMb: 3 } },
  ]);
  assert.equal(plan.noData.find(({ plugin }) => plugin === 'prettier').code, 'disabled');
});

test('отключённый модуль, отсутствующие данные и неподключённый адаптер различаются', async (t) => {
  const projectDir = await tempDir(t);
  await writeFile(join(projectDir, 'package.json'), '{"name":"demo"}');
  await mkdir(join(projectDir, 'eslint.config.js'));
  await writeFile(join(projectDir, 'dist'), '');
  const config = resolveConfig({ projectDir, modules: { knip: { enabled: false } } });
  const plan = await createEngineConfig(config, { prettier: adapter, lint: adapter });
  const reasons = Object.fromEntries(plan.noData.map(({ plugin, code }) => [plugin, code]));
  assert.equal(reasons['project-info'], 'adapter-unavailable');
  assert.equal(reasons.knip, 'disabled');
  assert.equal(reasons.audit, 'no-package-manager');
  assert.equal(reasons.lint, 'no-eslint-config');
  assert.equal(reasons.coverage, 'no-lcov');
  assert.equal(reasons['build-size'], 'no-build-dir');
  assert.deepEqual(plan.plugins.map(({ slug }) => slug), ['prettier']);
  assert(plan.noData.every(({ reason, action }) => reason && action));
});

test('команда тестов передаётся адаптеру покрытия, если готового LCOV нет', async (t) => {
  const projectDir = await tempDir(t);
  const config = resolveConfig({ projectDir, testCommand: 'npm run coverage' });
  const plan = await createEngineConfig(config, { coverage: adapter });
  assert.deepEqual(plan.plugins[0].options, {
    reports: [join(projectDir, 'coverage', 'lcov.info')],
    testCommand: 'npm run coverage',
  });
  assert(!plan.noData.some(({ plugin }) => plugin === 'coverage'));
});

test('изолированный запуск принимает настройки движка без code-pushup.config', async (t) => {
  const projectDir = await tempDir(t);
  execFileSync('git', ['init', '--template='], { cwd: projectDir, stdio: 'ignore' });
  const adapterFile = join(projectDir, 'adapter.mjs');
  const eslintrc = 'export default [];';
  await Promise.all([
    writeFile(join(projectDir, 'frontis.config.mjs'), 'export default {};'),
    writeFile(join(projectDir, 'eslint.config.mjs'), eslintrc),
    writeFile(adapterFile, `
      import { readFile } from 'node:fs/promises';
      export async function prepare({ eslintrc }) {
        const source = await readFile(eslintrc, 'utf8');
        return {
          slug: 'eslint', title: 'ESLint', icon: 'file',
          audits: [{ slug: 'configured', title: 'Путь к конфигурации' }],
          runner: async () => [{ slug: 'configured', score: 1, value: source.length }],
        };
      }
    `),
  ]);
  const plan = await loadEngineConfig(projectDir, { lint: pathToFileURL(adapterFile).href });
  const result = await runGuardedPlugins(plan.config.projectDir, plan.plugins);
  assert.deepEqual(result.noData, []);
  assert.equal(result.reports[0].slug, 'eslint');
  assert.equal(result.reports[0].audits[0].value, eslintrc.length);
});
