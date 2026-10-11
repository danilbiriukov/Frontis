import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../dist/core/config.js';
import { IMPORTANCE_LABELS, STATUS_LABELS } from '../dist/core/labels.js';
import { buildRecommendations } from '../dist/core/recommendations.js';
import {
  auditFindings,
  buildSizeFindings,
  coverageFindings,
  lintFindings,
  nodeFindings,
  outdatedFindings,
  testFindings,
  unusedCodeFindings,
} from '../dist/core/rules.js';
import { projectScore } from '../dist/core/score.js';
import { resolveStatus } from '../dist/core/status.js';

const finding = (importance, module = 'audit') => ({
  module,
  metric: `${module}.test`,
  importance,
  current: '1',
  target: '0',
  description: 'Сделайте что-нибудь.',
});

const importances = (findings) => findings.map((item) => item.importance);
const byMetric = (findings) => Object.fromEntries(findings.map((item) => [item.metric, item.importance]));

const coverage = { warn: 65, target: 90 };
const MB = 1024 * 1024;

// resolveStatus

test('resolveStatus: высокая среди низких — fix', () => {
  assert.equal(resolveStatus([finding('low'), finding('high'), finding('low')]), 'fix');
});

test('resolveStatus: средняя без высоких — plan', () => {
  assert.equal(resolveStatus([finding('low'), finding('mid')]), 'plan');
});

test('resolveStatus: только низкие — ok', () => {
  assert.equal(resolveStatus([finding('low'), finding('low')]), 'ok');
});

test('resolveStatus: пустой список — ok', () => {
  assert.equal(resolveStatus([]), 'ok');
});

// Покрытие

test('покрытие 63,4 при порогах 65 и 90 — высокая', () => {
  const [item, ...rest] = coverageFindings(63.4, coverage);
  assert.equal(rest.length, 0);
  assert.equal(item.importance, 'high');
  assert.equal(item.metric, 'coverage.lines');
  assert.equal(item.current, '63,4%');
  assert.equal(item.target, '90%');
});

test('покрытие 84,1 — средняя', () => {
  assert.deepEqual(importances(coverageFindings(84.1, coverage)), ['mid']);
});

test('покрытие 92,4 — находки нет', () => {
  assert.deepEqual(coverageFindings(92.4, coverage), []);
});

test('покрытие на границах: ровно warn — средняя, ровно target — нет находки', () => {
  assert.deepEqual(importances(coverageFindings(65, coverage)), ['mid']);
  assert.deepEqual(coverageFindings(90, coverage), []);
});

test('покрытие чуть ниже цели не округляется до цели', () => {
  assert.equal(coverageFindings(89.96, coverage)[0].current, '89,9%');
});

// Уязвимости и устаревшие зависимости

test('уязвимости: critical и high — высокая, moderate — средняя, low — низкая', () => {
  const findings = auditFindings({ critical: 1, high: 2, moderate: 3, low: 4 });
  assert.deepEqual(byMetric(findings), {
    'audit.critical': 'high',
    'audit.high': 'high',
    'audit.moderate': 'mid',
    'audit.low': 'low',
  });
  assert.deepEqual(
    findings.map((item) => [item.current, item.target]),
    [
      ['1', '0'],
      ['2', '0'],
      ['3', '0'],
      ['4', '0'],
    ],
  );
});

test('устаревшие зависимости: мажорная, минорная, патчевая — высокая, средняя, низкая', () => {
  assert.deepEqual(byMetric(outdatedFindings({ major: 1, minor: 1, patch: 1 })), {
    'outdated.major': 'high',
    'outdated.minor': 'mid',
    'outdated.patch': 'low',
  });
});

// Тесты, линтер, неиспользуемый код

test('один упавший тест — высокая, один пропущенный — низкая', () => {
  assert.deepEqual(byMetric(testFindings({ failed: 1, skipped: 0 })), { 'tests.failed': 'high' });
  assert.deepEqual(byMetric(testFindings({ failed: 0, skipped: 1 })), { 'tests.skipped': 'low' });
  assert.deepEqual(testFindings({ failed: 0, skipped: 0 }), []);
});

test('линтер: ошибка — высокая, предупреждение и формат — средняя', () => {
  assert.deepEqual(byMetric(lintFindings({ errors: 1, warnings: 2, unformatted: 3 })), {
    'lint.errors': 'high',
    'lint.warnings': 'mid',
    'lint.format': 'mid',
  });
});

test('неиспользуемый код: одна находка — высокая, ноль — ни одной', () => {
  const findings = unusedCodeFindings({ files: 1, dependencies: 0, exports: 0, types: 0 });
  assert.deepEqual(byMetric(findings), { 'unusedCode.files': 'high' });
  assert.equal(findings[0].module, 'knip');
  assert.deepEqual(unusedCodeFindings({ files: 0, dependencies: 0, exports: 0, types: 0 }), []);
});

// Размер сборки

test('сборка 9,6 МБ при пределе 5 — высокая, 2,4 МБ — ни одной', () => {
  const [item] = buildSizeFindings(9.6 * MB, { maxMb: 5 });
  assert.equal(item.importance, 'high');
  assert.equal(item.current, '9,6 МБ');
  assert.equal(item.target, '5 МБ');
  assert.deepEqual(buildSizeFindings(2.4 * MB, { maxMb: 5 }), []);
});

test('сборка чуть больше предела не округляется до предела', () => {
  assert.equal(buildSizeFindings(5.01 * MB, { maxMb: 5 })[0].current, '5,1 МБ');
  assert.deepEqual(buildSizeFindings(5 * MB, { maxMb: 5 }), []);
});

// Node.js

test('Node.js против LTS 24.21.3: 20.11.1 — высокая, 24.18.0 — средняя, 24.21.0 — низкая', () => {
  assert.deepEqual(byMetric(nodeFindings('20.11.1', '24.21.3')), { 'node.major': 'high' });
  assert.deepEqual(byMetric(nodeFindings('24.18.0', '24.21.3')), { 'node.minor': 'mid' });
  assert.deepEqual(byMetric(nodeFindings('24.21.0', '24.21.3')), { 'node.patch': 'low' });
  const [item] = nodeFindings('v20.11.1', 'v24.21.3');
  assert.equal(item.module, 'node-version');
  assert.equal(item.current, '20.11.1');
  assert.equal(item.target, '24.21.3');
});

test('Node.js: равная или более новая версия, неполная версия той же ветки — находки нет', () => {
  assert.deepEqual(nodeFindings('24.21.3', '24.21.3'), []);
  assert.deepEqual(nodeFindings('25.0.0', '24.21.3'), []);
  assert.deepEqual(nodeFindings('24', '24.21.3'), []);
  assert.deepEqual(byMetric(nodeFindings('22', '24.21.3')), { 'node.major': 'high' });
});

test('Node.js: неразборчивая версия — ошибка', () => {
  assert.throws(() => nodeFindings('>=20', '24.21.3'), RangeError);
});

// Оценка проекта

test('projectScore: две красные, три жёлтые, одна зелёная и одна без данных — 53, red', () => {
  assert.deepEqual(projectScore(['fix', 'fix', 'plan', 'plan', 'plan', 'ok', 'no-data']), {
    value: 53,
    known: 6,
    total: 7,
    zone: 'red',
  });
});

test('projectScore: шесть зелёных и одна жёлтая — 94, green', () => {
  const score = projectScore(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'plan']);
  assert.equal(score.value, 94);
  assert.equal(score.zone, 'green');
});

test('projectScore: два модуля с данными — value и zone null', () => {
  assert.deepEqual(projectScore(['ok', 'fix', 'no-data', 'no-data']), {
    value: null,
    known: 2,
    total: 4,
    zone: null,
  });
});

test('projectScore: граница жёлтой зоны', () => {
  assert.deepEqual(projectScore(['plan', 'plan', 'plan']).zone, 'yellow');
});

// Рекомендации

test('buildRecommendations: по важности, внутри — по порядку модулей, без нулевых находок', () => {
  const findings = [
    ...testFindings({ failed: 0, skipped: 2 }),
    ...lintFindings({ errors: 0, warnings: 3, unformatted: 0 }),
    ...coverageFindings(50, coverage),
    ...outdatedFindings({ major: 0, minor: 1, patch: 0 }),
    ...auditFindings({ critical: 1, high: 0, moderate: 0, low: 0 }),
  ];
  const recommendations = buildRecommendations(findings);
  assert.deepEqual(
    recommendations.map((item) => item.metric),
    ['audit.critical', 'coverage.lines', 'outdated.minor', 'lint.warnings', 'tests.skipped'],
  );
  assert.ok(recommendations.every((item) => item.current !== '0'));
});

test('buildRecommendations: устойчивый порядок и вход не меняется', () => {
  const first = finding('high', 'lint');
  const second = { ...finding('high', 'lint'), metric: 'lint.other' };
  const input = [first, finding('low'), second];
  assert.deepEqual(buildRecommendations(input), [first, second, input[1]]);
  assert.deepEqual(buildRecommendations(input), buildRecommendations(input));
  assert.equal(input[1].importance, 'low');
});

// Подписи

test('подписи есть у каждого статуса и важности', () => {
  assert.deepEqual(Object.keys(STATUS_LABELS), ['ok', 'plan', 'fix', 'no-data']);
  assert.deepEqual(Object.keys(IMPORTANCE_LABELS), ['high', 'mid', 'low']);
});

// Конфигурация: пороги и команда тестов

const configPath = join(resolve(import.meta.dirname, 'fixtures', 'empty'), 'frontis.config.ts');
const check = (raw) => resolveConfig(raw, configPath);

test('resolveConfig отвергает warn не меньше target', () => {
  for (const pair of [
    { warn: 90, target: 90 },
    { warn: 95, target: 90 },
  ]) {
    assert.throws(() => check({ thresholds: { coverage: pair } }), {
      name: 'ConfigError',
      message: /thresholds\.coverage: warn должен быть меньше target/,
    });
  }
  assert.throws(() => check({ thresholds: { coverage: { warn: 95 } } }), { name: 'ConfigError' });
});

test('resolveConfig отвергает maxMb равный нулю и отрицательный', () => {
  for (const maxMb of [0, -1]) {
    assert.throws(() => check({ thresholds: { buildSize: { maxMb } } }), {
      name: 'ConfigError',
      message: new RegExp(`thresholds\\.buildSize\\.maxMb: ожидалось число больше нуля, получено ${maxMb}`),
    });
  }
  assert.equal(check({ thresholds: { buildSize: { maxMb: 0.5 } } }).thresholds.buildSize.maxMb, 0.5);
});

test('resolveConfig отвергает пустую строку в testCommand', () => {
  assert.throws(() => check({ testCommand: '' }), {
    name: 'ConfigError',
    message: /testCommand: ожидалась непустая строка, получено ""/,
  });
});
