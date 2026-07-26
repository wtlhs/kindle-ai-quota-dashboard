'use strict';

// 每日一语生成器：调用 GLM Coding Plan 的 OpenAI 兼容接口生成一句短句，
// 写入 config.quoteFile（默认 config/quote.json），供 collect 采集进快照。
// 没有 API Key 或调用失败时，回退到内置句库按日轮换，保证 Kindle 上始终有句子。
//
// 用法：
//   node scripts/gen-quote.cjs                 # 随机风格
//   node scripts/gen-quote.cjs --style 古诗词   # 指定风格（古诗词/外国文学/励志）
// 环境变量：
//   QUOTE_API_KEY   优先使用；未设置时回退 GLM1_API_KEY
//   QUOTE_MODEL     默认 glm-5.2

const fs = require('node:fs');
const path = require('node:path');
const { fetchJson, safeError, writeAtomic } = require('../src/lib/common.cjs');
const { ROOT } = require('../src/lib/config.cjs');

const STYLES = ['古诗词', '外国文学', '励志'];

const FALLBACK_QUOTES = [
  { text: '莫听穿林打叶声，何妨吟啸且徐行。', source: '苏轼《定风波》' },
  { text: '生活不能等待别人来安排，要自己去争取和奋斗。', source: '路遥《平凡的世界》' },
  { text: '山重水复疑无路，柳暗花明又一村。', source: '陆游《游山西村》' },
  { text: '重要的东西，用眼睛是看不见的。', source: '圣·埃克苏佩里《小王子》' },
  { text: '长风破浪会有时，直挂云帆济沧海。', source: '李白《行路难》' },
  { text: '世界上只有一种真正的英雄主义，就是认清生活真相后依然热爱生活。', source: '罗曼·罗兰' },
  { text: '不积跬步，无以至千里；不积小流，无以成江海。', source: '荀子《劝学》' },
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

function quoteFilePath() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    if (config && config.quoteFile) {
      const target = String(config.quoteFile);
      return path.isAbsolute(target) ? target : path.resolve(ROOT, target);
    }
  } catch {
    // 没有 config.json 时用默认路径
  }
  return path.join(ROOT, 'config', 'quote.json');
}

function fallbackQuote() {
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getFullYear(), 0, 0)) / 86400000);
  return FALLBACK_QUOTES[dayOfYear % FALLBACK_QUOTES.length];
}

function parseQuote(content) {
  const raw = String(content || '').replace(/```json|```/g, '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('模型输出中没有 JSON');
  const value = JSON.parse(match[0]);
  const text = String(value.text || '').trim();
  const source = String(value.source || '').trim();
  if (!text) throw new Error('模型输出缺少 text');
  if (text.length > 60) throw new Error('句子过长');
  return { text, source: source.slice(0, 40) };
}

async function generateQuote(key, style) {
  const model = String(process.env.QUOTE_MODEL || 'glm-5.2');
  const payload = await fetchJson('https://open.bigmodel.cn/api/coding/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 1.0,
      messages: [{
        role: 'user',
        content: `从中国古诗词或世界文学经典中选一句适合今天心境的话，风格：${style}。` +
          '要求简短（不超过40个字）、有意境。' +
          '只输出 JSON，格式：{"text":"原文","source":"作者《出处》"}，不要解释，不要多余文字。' +
          `今天的随机种子：${Date.now() % 10000}`,
      }],
    }),
  });
  const content = payload
    && payload.choices
    && payload.choices[0]
    && payload.choices[0].message
    && payload.choices[0].message.content;
  return parseQuote(content);
}

async function main() {
  const style = argValue('--style') || STYLES[Math.floor(Math.random() * STYLES.length)];
  const key = String(process.env.QUOTE_API_KEY || process.env.GLM1_API_KEY || '').trim();
  const target = quoteFilePath();
  let quote;
  let origin = 'glm';
  if (!key) {
    quote = fallbackQuote();
    origin = 'fallback（未设置 QUOTE_API_KEY / GLM1_API_KEY）';
  } else {
    try {
      quote = await generateQuote(key, style);
    } catch (error) {
      quote = fallbackQuote();
      origin = `fallback（生成失败：${safeError(error)}）`;
    }
  }
  writeAtomic(target, `${JSON.stringify(quote, null, 2)}\n`);
  process.stdout.write(`quote updated ${target} [${origin}] ${quote.text}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { fallbackQuote, parseQuote };
