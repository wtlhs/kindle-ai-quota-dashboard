'use strict';

const {
  clampPct,
  failedWindows,
  fetchJson,
  isoBeijing,
} = require('../lib/common.cjs');

// MiniMax Coding Plan 额度接口（参考 cc-switch coding_plan.rs 的实现）：
// GET {baseUrl}/v1/api/openplatform/coding_plan/remains（Bearer 鉴权）
// model_remains[] 里只取 model_name == "general" 的条目（跳过 video 等非编程模型）：
//   current_interval_remaining_percent → 5 小时窗口剩余百分比（需反转为已用）
//   current_weekly_status == 1 时才有周窗口（其他值表示该套餐无周限额）

function parseMiniMaxWindows(payload) {
  const remains = Array.isArray(payload && payload.model_remains) ? payload.model_remains : [];
  const item = remains.find((entry) => entry && entry.model_name === 'general');
  if (!item) return [];
  const windows = [];
  const intervalRemain = Number(item.current_interval_remaining_percent);
  if (Number.isFinite(intervalRemain)) {
    const endMs = Number(item.end_time);
    windows.push({
      name: '5小时',
      usedPct: clampPct(100 - intervalRemain),
      resetAt: Number.isFinite(endMs) && endMs > 0 ? isoBeijing(endMs) : null,
    });
  }
  if (Number(item.current_weekly_status) === 1) {
    const weeklyRemain = Number(item.current_weekly_remaining_percent);
    if (Number.isFinite(weeklyRemain)) {
      const weeklyEndMs = Number(item.weekly_end_time);
      windows.push({
        name: '周',
        usedPct: clampPct(100 - weeklyRemain),
        resetAt: Number.isFinite(weeklyEndMs) && weeklyEndMs > 0 ? isoBeijing(weeklyEndMs) : null,
      });
    }
  }
  return windows;
}

async function collectMiniMax(config = {}) {
  const label = String(config.label || 'MiniMax');
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows(label, '未启用', fetchedAt), disabled: true };
  }
  const envName = String(config.apiKeyEnv || 'MINIMAX_API_KEY');
  const key = String(process.env[envName] || '').trim();
  if (!key) return failedWindows(label, `没有设置环境变量 ${envName}`, fetchedAt);
  try {
    const baseUrl = String(config.baseUrl || 'https://api.minimaxi.com').replace(/\/+$/, '');
    const payload = await fetchJson(`${baseUrl}/v1/api/openplatform/coding_plan/remains`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });
    const baseResp = payload && payload.base_resp;
    if (baseResp && Number(baseResp.status_code) !== 0) {
      throw new Error(`MiniMax 接口返回错误（code ${baseResp.status_code}）：${baseResp.status_msg || '未知错误'}`);
    }
    const windows = parseMiniMaxWindows(payload);
    if (!windows.length) throw new Error('MiniMax 响应中没有 general 模型的额度窗口');
    return { ok: true, label, windows, fetchedAt, error: null };
  } catch (error) {
    return failedWindows(label, error, fetchedAt);
  }
}

module.exports = { collectMiniMax, parseMiniMaxWindows };
