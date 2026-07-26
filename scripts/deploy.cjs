'use strict';

// 把 dist/ 推送到自己的服务器（替代 GitHub Pages 数据中转）。
// 服务器端用 deploy/server/docker-compose.yml 起 nginx 静态托管。
//
// 用法：
//   DEPLOY_TARGET=root@1.2.3.4:/opt/kindle-dashboard/site npm run deploy
// 环境变量：
//   DEPLOY_TARGET    rsync 目标（必填，user@host:/path 形式）
//   DEPLOY_SSH_PORT  SSH 端口（可选，默认 22）

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('../src/lib/config.cjs');

function main() {
  const target = String(process.env.DEPLOY_TARGET || '').trim();
  if (!target) {
    throw new Error('没有设置环境变量 DEPLOY_TARGET（例如 root@1.2.3.4:/opt/kindle-dashboard/site）');
  }
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(path.join(distDir, 'data.js'))) {
    throw new Error(`缺少 ${distDir}/data.js。先运行 npm run collect && npm run build`);
  }
  const sshPort = String(process.env.DEPLOY_SSH_PORT || '22');
  const result = spawnSync('rsync', [
    '-az',
    '--delete',
    '-e', `ssh -p ${sshPort} -o ConnectTimeout=10`,
    `${distDir}/`,
    target,
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`rsync 退出码 ${result.status}`);
  process.stdout.write(`published dist/ -> ${target}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
}
