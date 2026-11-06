import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect } from '@code-pushup/core';
import coveragePlugin from '@code-pushup/coverage-plugin';
import eslintPlugin from '@code-pushup/eslint-plugin';
import jsPackagesPlugin from '@code-pushup/js-packages-plugin';
import { reportSchema } from '@code-pushup/models';

const npmCli = process.env.npm_execpath;
assert(npmCli, 'Запустите проверку через npm run probe');

const toolsManifest = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'));
const projectDir = await realpath(await mkdtemp(join(tmpdir(), 'frontis-code-pushup-')));
process.chdir(projectDir);
// Git не должен подхватить репозиторий из родительского каталога.
process.env.GIT_CEILING_DIRECTORIES = dirname(projectDir);
const gitStatus = spawnSync('git', ['rev-parse', '--is-inside-work-tree']);
assert.ifError(gitStatus.error);
assert.equal(gitStatus.status, 128, 'Для первого запуска нужен каталог вне Git');
console.log(`Контрольный проект: ${projectDir}`);

await mkdir('src');
await mkdir('coverage');
await writeFile('package.json', JSON.stringify({
  name: 'frontis-compatibility-fixture',
  version: '1.0.0',
  private: true,
  type: 'module',
  dependencies: { lodash: '4.17.15' },
  devDependencies: { eslint: toolsManifest.devDependencies.eslint, minimist: '0.0.8' },
}, null, 2));
await writeFile('eslint.config.js', `export default [{
  files: ['src/**/*.js'],
  rules: { 'no-console': 'warn', 'no-unused-vars': 'error' },
}];
`);
await writeFile('src/demo.js', `export function greet(enabled) {
  const unused = 1;
  if (enabled) {
    console.log('Hello');
  }
}
`);
await writeFile('coverage/lcov.info', `TN:
SF:src/demo.js
FN:1,greet
FNDA:1,greet
FNF:1
FNH:1
BRDA:3,0,0,0
BRDA:3,0,1,1
BRF:2
BRH:1
DA:2,1
DA:3,1
DA:4,0
LF:3
LH:2
end_of_record
`);
execFileSync(process.execPath, [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
});

const options = {
  cache: {},
  persist: { outputDir: '.frontis' },
  plugins: [
    await jsPackagesPlugin({
      packageManager: 'npm',
      auditLevelMapping: {
        critical: 'error', high: 'error', moderate: 'warning', low: 'info', info: 'info',
      },
    }),
    await eslintPlugin({ eslintrc: 'eslint.config.js', patterns: ['src/**/*.js'] }),
    await coveragePlugin({ reports: ['coverage/lcov.info'] }),
  ],
};

await mkdir('.frontis');
await assert.rejects(
  collect(options),
  (error) => error.task?.commands?.includes('--show-toplevel'),
);
console.log('Без Git сбор остановился на git rev-parse --show-toplevel');

// Движку нужен корень рабочей копии. Истории проекта при этом нет.
process.env.GIT_DIR = join(projectDir, '.frontis', 'probe-git');
process.env.GIT_WORK_TREE = projectDir;
execFileSync('git', ['init', '--template='], { stdio: 'inherit' });
const withoutGit = reportSchema.parse(await collect(options));
assert.equal(withoutGit.commit, null);
await writeFile('.frontis/report-without-git.json', `${JSON.stringify(withoutGit, null, 2)}\n`);

delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;
assert.equal(spawnSync('git', ['rev-parse', '--is-inside-work-tree']).status, 128);
execFileSync('git', ['init', '--template=', '--initial-branch=main'], { stdio: 'inherit' });
execFileSync('git', [
  '-c', 'user.name=Frontis Fixture', '-c', 'user.email=fixture@example.invalid',
  '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Контрольный коммит',
], { stdio: 'inherit' });
const withGit = reportSchema.parse(await collect(options));
assert.equal(withGit.commit?.hash, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
await writeFile('.frontis/report-with-git.json', `${JSON.stringify(withGit, null, 2)}\n`);
console.log(`Отчёты прошли проверку reportSchema и сохранены в ${join(projectDir, '.frontis')}`);
