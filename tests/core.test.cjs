'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  demoSnapshot,
  preserveLastKnownGood,
  validateSnapshot,
  writeSnapshot,
} = require('../src/collect.cjs');
const { safeError } = require('../src/lib/common.cjs');
const { ROOT, validateConfig } = require('../src/lib/config.cjs');
const { parseGlmWindows } = require('../src/collectors/glm.cjs');
const { parseMiniMaxWindows } = require('../src/collectors/minimax.cjs');
const { fallbackQuote, parseQuote } = require('../scripts/gen-quote.cjs');

test('demo snapshot passes the public schema', () => {
  const snapshot = demoSnapshot();
  assert.doesNotThrow(() => validateSnapshot(snapshot));
  assert.equal(snapshot.weather.place, '示例城市');
  assert.equal(snapshot.sources.glm1.windows.length, 2);
  assert.equal(snapshot.sources.minimax.label, 'MiniMax');
});

test('last known good data is preserved only for enabled failing providers', () => {
  const previous = demoSnapshot();
  const next = demoSnapshot();
  next.sources.glm1 = {
    ok: false,
    label: 'GLM-1',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '临时失败',
  };
  next.sources.kimi = {
    ok: false,
    label: 'Kimi',
    windows: [],
    fetchedAt: next.updatedAt,
    error: '未启用',
    disabled: true,
  };
  preserveLastKnownGood(next, previous);
  assert.equal(next.sources.glm1.ok, true);
  assert.equal(next.sources.glm1.stale, true);
  assert.equal(next.sources.glm1.error, '临时失败');
  assert.equal(next.sources.kimi.ok, false);
  assert.equal(next.sources.kimi.disabled, true);
});

test('safeError removes obvious credential material', () => {
  const secret = 'A'.repeat(90);
  const output = safeError(`authorization: bearer ${secret}`);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.match(output, /已隐藏/);
});

test('config rejects inline secrets but accepts environment variable names', () => {
  assert.doesNotThrow(() => validateConfig({
    providers: { glm1: { apiKeyEnv: 'GLM1_API_KEY' } },
  }));
  assert.throws(() => validateConfig({
    providers: { demo: { token: 'this-should-never-be-here' } },
  }), /不允许保存密钥值/);
});

test('snapshot writer emits JSON and old-browser JavaScript', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kindle-quota-test-'));
  try {
    writeSnapshot(demoSnapshot(), dir, false);
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    const javascript = fs.readFileSync(path.join(dir, 'data.js'), 'utf8');
    assert.equal(json.sources.glm2.ok, true);
    assert.match(javascript, /^window\.DASH_DATA = /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('browser runtime is valid JavaScript', () => {
  const result = spawnSync(process.execPath, ['--check', path.join(ROOT, 'web', 'dashboard-runtime.js')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('glm windows are classified by unit with reset-time fallback', () => {
  const windows = parseGlmWindows({
    limits: [
      { type: 'TOKENS_LIMIT', unit: 6, number: 7, percentage: 61.5, nextResetTime: Date.now() + 86400000 },
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 12.3, nextResetTime: Date.now() + 3600000 },
      { type: 'OTHER_LIMIT', percentage: 99 },
    ],
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].name, '5小时');
  assert.equal(windows[0].usedPct, 12.3);
  assert.equal(windows[1].name, '周');
  assert.equal(windows[1].usedPct, 61.5);

  const fallback = parseGlmWindows({
    limits: [
      { type: 'TOKENS_LIMIT', percentage: 40, nextResetTime: Date.now() + 86400000 },
      { type: 'TOKENS_LIMIT', percentage: 10, nextResetTime: Date.now() + 3600000 },
    ],
  });
  assert.equal(fallback[0].name, '5小时');
  assert.equal(fallback[0].usedPct, 10);
  assert.equal(fallback[1].name, '周');
});

test('minimax remaining percent is inverted and weekly gated by status', () => {
  const windows = parseMiniMaxWindows({
    model_remains: [
      { model_name: 'video', current_interval_remaining_percent: 1 },
      {
        model_name: 'general',
        current_interval_remaining_percent: 70,
        end_time: Date.now() + 3600000,
        current_weekly_status: 1,
        current_weekly_remaining_percent: 25,
        weekly_end_time: Date.now() + 86400000,
      },
    ],
  });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].name, '5小时');
  assert.equal(windows[0].usedPct, 30);
  assert.equal(windows[1].name, '周');
  assert.equal(windows[1].usedPct, 75);

  const noWeekly = parseMiniMaxWindows({
    model_remains: [{
      model_name: 'general',
      current_interval_remaining_percent: 100,
      current_weekly_status: 3,
      current_weekly_remaining_percent: 50,
    }],
  });
  assert.equal(noWeekly.length, 1);
  assert.equal(noWeekly[0].usedPct, 0);
});

test('quote generator parses model output and always has a fallback', () => {
  const parsed = parseQuote('```json\n{"text":"长风破浪会有时","source":"李白《行路难》"}\n```');
  assert.equal(parsed.text, '长风破浪会有时');
  assert.equal(parsed.source, '李白《行路难》');
  assert.throws(() => parseQuote('没有JSON的回答'), /JSON/);
  assert.throws(() => parseQuote(`{"text":"${'长'.repeat(61)}"}`), /过长/);
  const fallback = fallbackQuote();
  assert.ok(fallback.text.length > 0);
  assert.ok(fallback.source.length > 0);
});
