import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  escapeHtml,
  generateHtmlReport,
  openReportFile,
  safeJson,
  writeReportFile,
} from '../dist/report/index.js';

const fixtureResultRaw = await readFile(new URL('./fixtures/result/result.json', import.meta.url), 'utf8');
const fixtureResult = JSON.parse(fixtureResultRaw);

test('escapeHtml корректно экранирует спецсимволы HTML', () => {
  assert.equal(escapeHtml('<script>alert("xss" & \'test\')</script>'), '&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(123), '123');
});

test('safeJson экранирует теги script для предотвращения XSS', () => {
  const json = safeJson({ text: '</script><script>alert(1)</script>' });
  assert.equal(json.includes('</script>'), false);
  assert.match(json, /\\u003c\/script\\u003e/);
});

test('generateHtmlReport собирает полный автономный HTML из result.json', () => {
  const html = generateHtmlReport({ result: fixtureResult });

  assert.match(html, /^<!DOCTYPE html>/i);
  assert.match(html, /<html lang="ru">/);
  assert.match(html, /<title>Frontis: shop-web<\/title>/);

  // Шапка проекта
  assert.match(html, /shop-web/);
  assert.match(html, /v4\.12\.0/);
  assert.match(html, /Коммит недоступен/);
  assert.doesNotMatch(html, /Ветка:/); // branch: null -> не отображается
  assert.match(html, /Frontis v0\.1\.0/);

  // Оценка проекта и счетчики
  assert.match(html, /score-card zone-yellow/);
  assert.match(html, /<div class="score-value">60<\/div>/);
  assert.match(html, /Требуются плановые работы/);
  assert.match(html, /Охват: 3 из 5 показателей/);

  // 4 счетчика
  assert.match(html, /<div class="counter-count">1<\/div>\s*<div class="counter-label">Действий не требуется<\/div>/);
  assert.match(html, /<div class="counter-count">1<\/div>\s*<div class="counter-label">Запланировать<\/div>/);
  assert.match(html, /<div class="counter-count">1<\/div>\s*<div class="counter-label">Исправить<\/div>/);
  assert.match(html, /<div class="counter-count">2<\/div>\s*<div class="counter-label">Нет данных<\/div>/);

  // Рекомендации
  assert.match(html, /Исправьте ошибки линтера\./);
  assert.match(html, /Доведите покрытие строк до цели тестами на непокрытые участки\./);
  assert.match(html, /badge-importance-high/);
  assert.match(html, /badge-importance-mid/);

  // Таблица причин "Нет данных"
  assert.match(html, /Причины отсутствия данных/);
  assert.match(html, /В отчёте Code PushUp не хватает аудитов для проверки\./);
  assert.match(html, /В проекте нет настроек Prettier\./);

  // Карточки показателей
  assert.match(html, /Неиспользуемый код/);
  assert.match(html, /Качество кода/);
  assert.match(html, /Тесты и покрытие/);
  assert.match(html, /Неполные данные/);

  // Детали находок ESLint
  assert.match(html, /&#39;unused&#39; is assigned a value but never used\./);
  assert.match(html, /src\/demo\.js:2/);

  // Автономность: системные шрифты, нет внешних запросов
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /@import/);

  // Размер до 1 МБ
  const sizeBytes = Buffer.byteLength(html, 'utf8');
  assert.ok(sizeBytes < 1_000_000, `Размер HTML ${sizeBytes} превышает 1 МБ`);
});

test('generateHtmlReport экранирует XSS-нагрузки в сообщениях и путях', () => {
  const xssResult = {
    ...fixtureResult,
    project: {
      name: '<img src=x onerror=alert(1)>',
      version: '1.0.0" onmouseover="alert(2)',
      branch: '<script>alert(3)</script>',
      commit: 'abc<script>alert(4)</script>',
    },
    recommendations: [
      {
        importance: 'high',
        indicator: 'codeQuality',
        now: '<tag>',
        target: '</tag>',
        text: 'Сообщение с <script>alert("xss")</script> опасностью',
      },
    ],
  };

  const html = generateHtmlReport({ result: xssResult });
  assert.equal(html.includes('<script>alert('), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
});

test('generateHtmlReport ограничивает число находок десятью записями', () => {
  const manyIssues = Array.from({ length: 20_000 }, (_, i) => ({
    message: `Issue #${i + 1} ${'long detail '.repeat(20)}`,
    severity: 'error',
    source: { file: `file-${i + 1}.js`, position: { startLine: i + 1 } },
    audit: 'test-audit',
  }));

  const resultWithManyIssues = {
    ...fixtureResult,
    indicators: [
      {
        id: 'codeQuality',
        status: 'fix',
        audits: ['test-audit'],
        findings: [],
        checks: [
          {
            id: 'lint',
            status: 'fix',
            audits: ['test-audit'],
            facts: {},
            details: { issues: manyIssues },
          },
        ],
      },
    ],
  };

  const html = generateHtmlReport({ result: resultWithManyIssues });
  assert.match(html, /Issue #10/);
  assert.doesNotMatch(html, /Issue #11/);
  assert.match(html, /Показано 10 из 20000 находок/);
  assert.match(html, /Полный список.*report\.json/);
  assert.ok(Buffer.byteLength(html, 'utf8') < 1_000_000);
});

test('HTML показывает причину и действие для частично выполненной проверки', () => {
  const result = structuredClone(fixtureResult);
  const outdated = result.indicators.find(({ id }) => id === 'outdated');
  outdated.status = 'plan';
  outdated.incomplete = true;
  Object.assign(outdated.checks[0], {
    status: 'plan',
    incomplete: true,
    reason: 'Часть версий недоступна <реестр>.',
    action: 'Проверьте настройки npm.',
  });

  const html = generateHtmlReport({ result });
  assert.match(html, /Часть версий недоступна &lt;реестр&gt;\./);
  assert.match(html, /Проверьте настройки npm\./);
});

test('generateHtmlReport без result формирует диагностический отчет', () => {
  const noData = [
    {
      plugin: 'lint',
      code: 'no-eslint-config',
      reason: 'В проекте нет настроек ESLint.',
      action: 'Добавьте конфигурационный файл ESLint.',
      logFile: 'logs/lint.log',
    },
    {
      plugin: 'knip',
      code: 'knip-not-installed',
      reason: 'Пакет knip не установлен в node_modules.',
      action: 'Установите knip как dev-зависимость.',
    },
  ];

  const html = generateHtmlReport({
    noData,
    project: { name: 'diagnostic-test', version: '0.0.1' },
  });

  assert.match(html, /Диагностический отчёт/);
  assert.match(html, /diagnostic-test/);
  assert.match(html, /no-eslint-config/);
  assert.match(html, /В проекте нет настроек ESLint\./);
  assert.match(html, /Добавьте конфигурационный файл ESLint\./);
  assert.match(html, /logs\/lint\.log/);
  assert.match(html, /knip-not-installed/);
  assert.doesNotMatch(html, /Оценка проекта<\/div>\s*<div class="score-value">\d+/);
});

test('writeReportFile записывает HTML и создаёт промежуточные папки', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'frontis-report-test-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 3 }));

  const target = join(dir, 'nested', 'deep', 'report.html');
  const content = '<!DOCTYPE html><html><body>Report</body></html>';

  const writtenPath = await writeReportFile(content, target);
  assert.equal(writtenPath, target);

  const fileStat = await stat(target);
  assert.ok(fileStat.isFile());

  const readBack = await readFile(target, 'utf8');
  assert.equal(readBack, content);

  // Повторная запись обновляет файл
  const updatedContent = '<!DOCTYPE html><html><body>Updated</body></html>';
  await writeReportFile(updatedContent, target);
  assert.equal(await readFile(target, 'utf8'), updatedContent);
});

test('openReportFile корректно обрабатывает путь к файлу', async () => {
  const target = join(tmpdir(), 'test-report.html');
  await writeFile(target, '<html></html>', 'utf8');
  try {
    process.env.FRONTIS_TEST_SKIP_OPEN = '1';
    await assert.doesNotReject(openReportFile(target));
  } finally {
    delete process.env.FRONTIS_TEST_SKIP_OPEN;
    await rm(target, { force: true, maxRetries: 3 });
  }
});
