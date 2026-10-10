import assert from 'node:assert/strict';
import { test } from 'node:test';

// Временный тест: проверяем, что ruleset не даёт слить красный CI в main
test('заведомо падающий тест', () => {
  assert.equal(1, 2);
});
