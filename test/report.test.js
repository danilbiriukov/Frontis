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
  assert.deepEqual([...html.matchAll(/<dt>(Проект|Запуск|Коммит)<\/dt>/g)].map(([, label]) => label), [
    'Проект', 'Запуск', 'Коммит',
  ]);
  assert.doesNotMatch(html, /<dt>Ветка<\/dt>/);
  assert.match(html, /Версия 0\.1\.0/);
  assert.match(html, /Code PushUp 0\.126\.4/);

  // Оценка проекта и счетчики
  assert.match(html, /score-card zone-yellow/);
  assert.match(html, /<span class="score-value number">60<\/span>/);
  assert.match(html, /aria-label="Оценка проекта"[^>]+aria-valuenow="60"/);
  assert.match(html, /Требуются плановые работы/);
  assert.match(html, /Охват: 3 из 5 показателей/);

  // 4 счетчика
  const counters = [...html.matchAll(/<div class="counter-label">([^<]+)<\/div>.*\n\s*<div class="counter-count number">(\d+)<\/div>/g)];
  assert.deepEqual(counters.map(([, label, count]) => [label, Number(count)]), [
    ['Исправить', 1], ['Запланировать', 1], ['Действий не требуется', 1], ['Нет данных', 2],
  ]);

  // Рекомендации
  assert.match(html, /Исправьте ошибки линтера\./);
  assert.match(html, /Доведите покрытие строк до цели тестами на непокрытые участки\./);
  assert.match(html, /badge-importance-high/);
  assert.match(html, /badge-importance-mid/);

  // Таблица причин "Нет данных"
  assert.match(html, /Показатели без данных/);
  assert.match(html, /В отчёте Code PushUp не хватает аудитов для проверки\./);
  assert.match(html, /В проекте нет настроек Prettier\./);

  // Карточки показателей
  assert.match(html, /Неиспользуемый код/);
  assert.match(html, /Качество кода/);
  assert.match(html, /Покрытие тестами/);
  assert.match(html, /Неполные данные/);

  // Детали находок ESLint
  assert.match(html, /&#39;unused&#39; is assigned a value but never used\./);
  assert.match(html, /src\/demo\.js:2/);

  // Автономность: системные шрифты, нет внешних запросов
  const docsLink = '<a href="https://github.com/danilbiriukov/Frontis#readme">';
  assert.ok(html.includes(docsLink));
  assert.doesNotMatch(html.replace(docsLink, ''), /https?:\/\/|@import|url\(|<(?:img|link|script|iframe)\b/i);

  // Размер до 1 МБ
  const sizeBytes = Buffer.byteLength(html, 'utf8');
  assert.ok(sizeBytes < 1_000_000, `Размер HTML ${sizeBytes} превышает 1 МБ`);
});

test('шкала LCOV следует статусу покрытия, а время показывается только для начатых проверок', () => {
  const result = structuredClone(fixtureResult);
  const coverage = result.indicators.find(({ id }) => id === 'coverage');
  coverage.status = 'fix';
  coverage.checks.reverse();
  const lcov = coverage.checks.find(({ id }) => id === 'coverage');
  lcov.status = 'ok';
  lcov.facts.lines = 94;
  const html = generateHtmlReport({
    result, durations: new Map([['coverage', 700], ['tests', 300]]),
  });
  const coverageCard = html.match(/id="indicator-coverage">([\s\S]+?)<\/article>/)[1];
  assert.match(coverageCard, /class="meter status-ok"/);
  assert.match(coverageCard, /aria-label="Покрытие строк"[^>]+aria-valuenow="94"/);
  assert.match(coverageCard, /meter-warn" style="left:65%"/);
  assert.match(coverageCard, /meter-target" style="left:90%"/);
  assert.match(coverageCard, /Порог 65%/);
  assert.match(coverageCard, /Цель 90%/);
  assert.match(coverageCard, /Jest \/ Vitest, LCOV<\/code><span>1 с/);
  assert.match(html, /<code>npm audit<\/code><\/footer>/);
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
  assert.match(html, /score-card zone-none/);
  assert.match(html, /class="score-value number">—<\/span>/);
  assert.match(html, /Недостаточно данных для оценки\. Доступно 0 из 2 показателей/);
  assert.doesNotMatch(html, /aria-label="Оценка проекта"/);
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
