import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { MODULE_NAMES, defineConfig, resolveConfig } from '../dist/core/config.js';

const configDir = resolve(import.meta.dirname, 'fixtures', 'empty');
const configPath = join(configDir, 'frontis.config.ts');
const check = (raw) => resolveConfig(raw, configPath);

const configError = (message) => ({ name: 'ConfigError', message });

test('пустой объект — все значения по умолчанию', () => {
  const modules = Object.fromEntries(MODULE_NAMES.map((name) => [name, { enabled: true, timeoutMs: 120000 }]));
  assert.deepEqual(check({}), {
    configVersion: 1,
    projectDir: configDir,
    buildDir: join(configDir, 'dist'),
    outFile: join(configDir, 'frontis-report.html'),
    open: true,
    timeoutMs: 120000,
    testCommand: undefined,
    thresholds: { coverage: { warn: 65, target: 90 }, buildSize: { maxMb: 5 } },
    modules,
  });
});

test('частичный конфиг — заданные поля из него, остальные по умолчанию', () => {
  const config = check({ configVersion: 1, open: false, timeoutMs: 5000, thresholds: { coverage: { target: 75 } } });
  assert.equal(config.open, false);
  assert.equal(config.timeoutMs, 5000);
  assert.deepEqual(config.thresholds, { coverage: { warn: 65, target: 75 }, buildSize: { maxMb: 5 } });
  assert.equal(config.buildDir, join(configDir, 'dist'));
  assert.equal(config.modules.knip.timeoutMs, 5000);
});

test('defineConfig возвращает конфиг без изменений', () => {
  const raw = { open: false };
  assert.equal(defineConfig(raw), raw);
});

test('неизвестное поле верхнего уровня — ошибка с именем поля и списком допустимых', () => {
  assert.throws(() => check({ reporter: 'html' }), configError(/reporter: неизвестное поле.*Допустимые: configVersion, projectDir/));
});

test('опечатка buildDirr — подсказка buildDir', () => {
  assert.throws(() => check({ buildDirr: 'out' }), configError(/buildDirr.*Возможно, имелось в виду buildDir\./));
});

test('непохожее имя поля — без подсказки', () => {
  assert.throws(() => check({ somethingElse: 1 }), (error) => {
    assert.doesNotMatch(error.message, /Возможно/);
    return true;
  });
});

test('неверный тип у open', () => {
  assert.throws(() => check({ open: 'yes' }), configError(/open: ожидалось true или false, получено "yes"/));
});

test('неверный тип у timeoutMs', () => {
  assert.throws(() => check({ timeoutMs: '5000' }), configError(/timeoutMs: ожидалось целое число от 1000 до 600000, получено "5000"/));
});

test('неверный тип у thresholds.coverage.target', () => {
  assert.throws(
    () => check({ thresholds: { coverage: { target: '90%' } } }),
    configError(/thresholds\.coverage\.target: ожидалось число от 0 до 100, получено "90%"/),
  );
});

for (const timeoutMs of [999, 600001, 0, -1, 1500.5]) {
  test(`timeoutMs ${timeoutMs} вне допустимого — ошибка`, () => {
    assert.throws(() => check({ timeoutMs }), configError(new RegExp(`timeoutMs: .*получено ${timeoutMs}`)));
  });
}

for (const timeoutMs of [1000, 600000]) {
  test(`timeoutMs ${timeoutMs} на границе — проходит`, () => {
    assert.equal(check({ timeoutMs }).timeoutMs, timeoutMs);
  });
}

for (const target of [100, 42.5]) {
  test(`thresholds.coverage.target ${target} — проходит`, () => {
    assert.equal(check({ thresholds: { coverage: { warn: 0, target } } }).thresholds.coverage.target, target);
  });
}

for (const target of [101, -1]) {
  test(`thresholds.coverage.target ${target} — ошибка`, () => {
    assert.throws(
      () => check({ thresholds: { coverage: { target } } }),
      configError(/thresholds\.coverage\.target: ожидалось число от 0 до 100/),
    );
  });
}

test('неверный тип у thresholds.coverage.warn — без ложной ошибки про порядок порогов', () => {
  assert.throws(
    () => check({ thresholds: { coverage: { warn: 'много' } } }),
    (error) => {
      assert.match(error.message, /найдены ошибки \(1\)/);
      assert.match(error.message, /thresholds\.coverage\.warn: ожидалось число от 0 до 100, получено "много"/);
      return true;
    },
  );
});

test('неизвестное поле в thresholds — ошибка', () => {
  assert.throws(() => check({ thresholds: { size: {} } }), configError(/thresholds\.size: неизвестное поле/));
});

test('targets больше не поддерживается — неизвестное поле', () => {
  assert.throws(() => check({ targets: { coverage: 90 } }), configError(/targets: неизвестное поле/));
});

test('testCommand задаётся строкой', () => {
  assert.equal(check({ testCommand: 'npm test' }).testCommand, 'npm test');
});

test('неизвестное имя модуля — ошибка со списком допустимых', () => {
  assert.throws(
    () => check({ modules: { eslint: { enabled: false } } }),
    (error) => {
      assert.equal(error.name, 'ConfigError');
      assert.ok(error.message.includes(`modules.eslint: неизвестный модуль. Возможно, имелось в виду lint. Допустимые: ${MODULE_NAMES.join(', ')}.`));
      return true;
    },
  );
});

test('модуль со своим timeoutMs перекрывает общий, без него наследует', () => {
  const config = check({ timeoutMs: 30000, modules: { audit: { timeoutMs: 5000 }, knip: { enabled: false } } });
  assert.deepEqual(config.modules.audit, { enabled: true, timeoutMs: 5000 });
  assert.deepEqual(config.modules.knip, { enabled: false, timeoutMs: 30000 });
  assert.deepEqual(config.modules.lint, { enabled: true, timeoutMs: 30000 });
});

test('неверные значения внутри модуля — ошибка с полным путём', () => {
  assert.throws(
    () => check({ modules: { lint: { enabled: 'no', timeoutMs: 10 } } }),
    configError(/modules\.lint\.enabled: .*\n.*modules\.lint\.timeoutMs: /),
  );
});

test('несколько ошибок — все в одном сообщении', () => {
  assert.throws(
    () => check({ buildDirr: 'out', open: 1, timeoutMs: 1, thresholds: { coverage: { target: 200 } }, modules: { foo: {} } }),
    (error) => {
      assert.equal(error.name, 'ConfigError');
      assert.match(error.message, /найдены ошибки \(5\)/);
      for (const field of ['buildDirr', 'open', 'timeoutMs', 'thresholds.coverage.target', 'modules.foo']) {
        assert.ok(error.message.includes(`- ${field}: `), field);
      }
      return true;
    },
  );
});

for (const [raw, shown] of [
  [42, '42'],
  ['config', '"config"'],
  [[], 'массив'],
  [null, 'null'],
  [() => ({}), 'функция'],
]) {
  test(`конфиг не объект (${shown}) — ошибка`, () => {
    assert.throws(() => check(raw), configError(new RegExp(`ожидался объект конфигурации, получено ${shown}`)));
  });
}

test('configVersion: 2 — ошибка про обновление frontis', () => {
  assert.throws(() => check({ configVersion: 2 }), configError(/configVersion: версия 2 не поддерживается.*Обновите frontis/));
});

test('configVersion неверного типа — ошибка', () => {
  assert.throws(() => check({ configVersion: '1' }), configError(/configVersion: ожидалось 1, получено "1"/));
});

test('относительные пути становятся абсолютными от папки конфига', () => {
  const config = check({ projectDir: 'app', buildDir: '../build', outFile: 'reports/out.html' });
  assert.equal(config.projectDir, join(configDir, 'app'));
  assert.equal(config.buildDir, resolve(configDir, '..', 'build'));
  assert.equal(config.outFile, join(configDir, 'reports', 'out.html'));
});

test('абсолютный путь остаётся как есть', () => {
  const absolute = resolve(configDir, '..', 'elsewhere');
  assert.equal(check({ projectDir: absolute }).projectDir, absolute);
});
