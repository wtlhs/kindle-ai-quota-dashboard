'use strict';

const {
  clampPct,
  expandHome,
  failedWindows,
  fetchJson,
  isoBeijing,
  readJson,
} = require('../lib/common.cjs');

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && object[key] != null) return object[key];
  }
  return null;
}

function windowName(item, detail, index) {
  const explicit = firstValue(item, ['name', 'title', 'scope']) || firstValue(detail, ['name', 'title']);
  if (explicit) return String(explicit);
  const window = item && item.window || {};
  const duration = Number(firstValue(window, ['duration']) || firstValue(item, ['duration']) || firstValue(detail, ['duration']));
  const unit = String(firstValue(window, ['timeUnit']) || firstValue(item, ['timeUnit']) || '');
  if (Number.isFinite(duration)) {
    if (unit.includes('MINUTE') && duration % 60 === 0) return `${duration / 60}小时`;
    if (unit.includes('HOUR')) return `${duration}小时`;
    if (unit.includes('DAY')) return duration === 7 ? '周' : `${duration}天`;
  }
  return `窗口${index + 1}`;
}

function resetAt(item, detail) {
  const raw = firstValue(detail, ['reset_at', 'resetAt', 'reset_time', 'resetTime'])
    || firstValue(item, ['reset_at', 'resetAt', 'reset_time', 'resetTime']);
  if (raw) return isoBeijing(raw);
  const seconds = Number(firstValue(detail, ['reset_in', 'resetIn', 'ttl']) || firstValue(item, ['reset_in', 'resetIn', 'ttl']));
  return Number.isFinite(seconds) && seconds > 0 ? isoBeijing(Date.now() + seconds * 1000) : null;
}

// 两种凭据方式：优先 apiKeyEnv 环境变量（Coding Plan API Key，与 cc-switch 一致），
// 未配置时回退到读取本地 Kimi Code 登录凭据（需显式开启开关）。
function resolveToken(config) {
  if (config.apiKeyEnv) {
    const envName = String(config.apiKeyEnv);
    const key = String(process.env[envName] || '').trim();
    if (!key) throw new Error(`没有设置环境变量 ${envName}`);
    return key;
  }
  if (config.experimental !== true || config.allowLocalCredentialRead !== true) {
    throw new Error('必须配置 apiKeyEnv，或显式开启 experimental 和 allowLocalCredentialRead');
  }
  const credentialsPath = expandHome(config.credentialsFile || '~/.kimi-code/credentials/kimi-code.json');
  const credentials = readJson(credentialsPath);
  const token = String(credentials && credentials.access_token || '').trim();
  if (!token) throw new Error('Kimi Code 登录凭据中没有 access_token');
  return token;
}

async function collectKimi(config = {}) {
  const fetchedAt = isoBeijing();
  if (!config.enabled) {
    return { ...failedWindows('Kimi', '未启用', fetchedAt), disabled: true };
  }
  try {
    const token = resolveToken(config);
    const baseUrl = String(config.baseUrl || 'https://api.kimi.com/coding/v1').replace(/\/+$/, '');
    const payload = await fetchJson(`${baseUrl}/usages`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const windows = [];
    const limits = Array.isArray(payload && payload.limits) ? payload.limits : [];
    limits.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const detail = item.detail && typeof item.detail === 'object' ? item.detail : item;
      const limit = Number(detail.limit);
      let used = Number(detail.used);
      if (!Number.isFinite(used) && Number.isFinite(Number(detail.remaining)) && Number.isFinite(limit)) {
        used = limit - Number(detail.remaining);
      }
      if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
      windows.push({
        name: windowName(item, detail, index),
        usedPct: clampPct(used / limit * 100),
        resetAt: resetAt(item, detail),
      });
    });
    if (payload && payload.usage) {
      const usage = payload.usage;
      const limit = Number(usage.limit);
      const used = Number(usage.used);
      if (Number.isFinite(limit) && limit > 0 && Number.isFinite(used)) {
        windows.push({
          name: '周',
          usedPct: clampPct(used / limit * 100),
          resetAt: resetAt(usage, usage),
        });
      }
    }
    if (!windows.length) throw new Error('Kimi usages 响应中没有可识别的额度窗口');
    return { ok: true, label: 'Kimi', windows, fetchedAt, error: null };
  } catch (error) {
    return failedWindows('Kimi', error, fetchedAt);
  }
}

module.exports = { collectKimi, resetAt, windowName };
