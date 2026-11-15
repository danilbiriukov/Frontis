import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const archive = process.argv[2];
const npmCli = process.env.npm_execpath;
assert(archive && npmCli, 'Запустите npm run smoke:release -- <архив>');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const project = mkdtempSync(join(tmpdir(), 'frontis-smoke-'));

function npm(args, stdio = 'inherit') {
  return execFileSync(process.execPath, [npmCli, ...args], { cwd: project, encoding: 'utf8', stdio });
}

try {
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'frontis-smoke', private: true }));
  npm(['install', '--no-audit', '--no-fund', resolve(archive)]);
  const bin = process.platform === 'win32' ? 'frontis.cmd' : 'frontis';
  accessSync(join(project, 'node_modules', '.bin', bin));
  const cli = ['exec', '--offline', '--yes=false', '--', 'frontis'];
  const installedVersion = npm([...cli, '--version'], ['ignore', 'pipe', 'inherit']).trim();
  assert.equal(installedVersion, version, 'Версия установленного Frontis');

  writeFileSync(join(project, 'frontis.config.mjs'), `import { defineConfig, MODULE_NAMES } from 'frontis';

export default defineConfig({
  modules: Object.fromEntries(MODULE_NAMES.map((name) => [name, { enabled: name === 'build-size' }])),
});
`);
  const bundle = 'export {};';
  mkdirSync(join(project, 'dist'));
  writeFileSync(join(project, 'dist', 'index.js'), bundle);
  npm([...cli, 'run']);

  const output = join(project, '.frontis');
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  const result = JSON.parse(readFileSync(join(output, 'result.json'), 'utf8'));
  const html = readFileSync(join(output, 'report.html'), 'utf8');
  const build = report.plugins.find(({ slug }) => slug === 'frontis-build-size');
  const size = build?.audits.find(({ slug }) => slug === 'size-bytes');
  assert.equal(size?.value, Buffer.byteLength(bundle), 'Размер файла сборки в report.json');
  assert.equal(result.indicators.find(({ id }) => id === 'buildSize')?.status, 'ok', 'Статус сборки в result.json');
  assert(html.includes(`Frontis v${version}`), 'Версия Frontis в HTML-отчёте');
} finally {
  rmSync(project, { recursive: true, force: true });
}
