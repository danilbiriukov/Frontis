import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const progress = new URL('../dist/core/run-progress.js', import.meta.url).href;

test('цвет стадий используется только в интерактивной консоли вне CI и без NO_COLOR', () => {
  const code = `
    import { createRunProgress } from ${JSON.stringify(progress)};
    process.stdout.isTTY = true;
    createRunProgress().update('lint', 'running');
  `;
  const env = { ...process.env };
  delete env.CI;
  delete env.NO_COLOR;

  for (const [overrides, expected] of [
    [{}, '[lint] \x1b[36mзапущен\x1b[0m'],
    [{ CI: 'true' }, '[lint] запущен'],
    [{ NO_COLOR: '1' }, '[lint] запущен'],
  ]) {
    const output = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...env, ...overrides },
      encoding: 'utf8',
    });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout.trimEnd(), expected);
  }
});
