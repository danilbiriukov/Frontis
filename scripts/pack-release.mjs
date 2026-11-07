import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.env.npm_lifecycle_event === 'prepublishOnly') {
  console.error('Соберите архив командой npm run pack:release и опубликуйте его через npm publish <архив>.');
  process.exit(1);
}

const root = process.cwd();
const staging = mkdtempSync(join(tmpdir(), 'frontis-release-'));

function npm(...args) {
  execFileSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: staging, stdio: 'inherit' });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

try {
  const manifest = readJson(join(root, 'package.json'));
  for (const file of ['package.json', 'package-lock.json', ...manifest.files]) {
    cpSync(join(root, file), join(staging, file), { recursive: true });
  }

  npm('ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund');

  // npm проверяет исходные диапазоны вложенных пакетов при установке архива.
  // Переносим версии из overrides в манифесты Code PushUp внутри архива.
  const { packages } = readJson(join(staging, 'package-lock.json'));
  for (const location of Object.keys(packages)) {
    const name = location.split('node_modules/').at(-1);
    const overrides = manifest.overrides[name];
    if (overrides) {
      const path = join(staging, location, 'package.json');
      const dependency = readJson(path);
      Object.assign(dependency.dependencies, overrides);
      writeJson(path, dependency);
    }
  }

  // Оставляем esbuild отдельной зависимостью. npm сам установит бинарник для нужной платформы.
  manifest.dependencies.esbuild = packages['node_modules/esbuild'].version;
  rmSync(join(staging, 'node_modules', 'esbuild'), { recursive: true });

  manifest.bundleDependencies = Object.keys(manifest.dependencies).filter((name) => name.startsWith('@code-pushup/'));
  delete manifest.overrides;
  delete manifest.scripts.prepublishOnly;
  delete manifest.scripts['pack:release'];
  writeJson(join(staging, 'package.json'), manifest);

  npm('pack', '--ignore-scripts', '--loglevel=error', '--pack-destination', root);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
