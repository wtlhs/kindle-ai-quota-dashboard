'use strict';

const {
  clampPct,
  failedWindows,
  fetchJson,
  isoBeijing,
} = require('../lib/common.cjs');

// 智谱 Coding Plan 额度接口（参考 cc-switch coding_plan.rs 的实现）：
// GET {baseUrl}/api/monitor/usage/quota/limit
// 注意：Authorization 直接放 API Key，不加 Bearer 前缀。
// data.limits[] 中 type=TOKENS_LIMIT 的条目即额度窗口：
//   unit: 3 → 5 小时滚动窗口；unit: 6 → 每周窗口（percentage 即已用百分比）。
// 老套餐可能只返回 1 条，unit 缺失时按重置时间升序兜底归类。

function windowNameByUnit(unit) {
  if (unit === 3) return '5小时';
  if (unit === 6) return '周';
  return null;
}

function parseGlmWindows(data) {
  const limits = Array.isArray(data && data.limits) ? data.limits : [];
  const classified = [];
  const unclassified = [];
  for (const item of limits) {
    if (!item || typeof item !== 'object') continue;
    const type = String(item.type || '');
    if (type.toUpperCase() !== 'TOKENS_LIMIT') continue;
    const percentage = Number(item.percentage);
    if (!Number.isFinite(percentage)) continue;
    const resetMs = Number(item.nextResetTime);
    const entry = {
      name: windowNameByUnit(Number(item.unit)),
      usedPct: clampPct(percentage),
      resetAt: Number.isFinite(resetMs) && resetMs > 0 ? isoBeijing(resetMs) : null,
      resetMs: Number.isFinite(resetMs) ? resetMs : Number.MAX_SAFE_INTEGER,
    };
    if (entry.name) classified.push(entry);
    else unclassified.push(entry);
  }
  // unit 缺失/不识别时：重置更早的当 5 小时窗口，其余当周窗口
  unclassified.sort((a, b) => a.resetMs - b.resetMs);
  const fallbackNames = ['5小时', '周'];
  for (const entry of unclassified) {
    const name = fallbackNames.find((candidate) => !classified.some((w) => w.name === candidate));
    if (!name) break;
    entry.name = name;
    classified.push(entry);
  }
  classified.sort((a, b) => (a.name === '5小时' ? -1 : 1) - (b.name === '5小时' ? -1 : 1));
  return classified.map(({ name, usedPct, resetAt }) => ({ name, usedPct, resetAt }));
}

async function collectGlm(config = {}, fallbackLabel = 'GLM') {
  const label = String(config.label || fallbackLabel);
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows(label, '未启用', fetchedAt), disabled: true };
  }
  const envName = String(config.apiKeyEnv || 'GLM_API_KEY');
  const key = String(process.env[envName] || '').trim();
  if (!key) return failedWindows(label, `没有设置环境变量 ${envName}`, fetchedAt);
  try {
    const baseUrl = String(config.baseUrl || 'https://open.bigmodel.cn').replace(/\/+$/, '');
    const payload = await fetchJson(`${baseUrl}/api/monitor/usage/quota/limit`, {
      headers: {
        Authorization: key,
        'Content-Type': 'application/json',
        'Accept-Language': 'zh-CN,zh',
      },
    });
    if (payload && payload.success === false) {
      throw new Error(`智谱接口返回错误：${payload.msg || '未知错误'}`);
    }
    const data = payload && payload.data;
    if (!data) throw new Error('智谱额度响应缺少 data 字段');
    const windows = parseGlmWindows(data);
    if (!windows.length) throw new Error('智谱额度响应中没有 TOKENS_LIMIT 窗口');
    return { ok: true, label, windows, fetchedAt, error: null };
  } catch (error) {
    return failedWindows(label, error, fetchedAt);
  }
}

module.exports = { collectGlm, parseGlmWindows };
