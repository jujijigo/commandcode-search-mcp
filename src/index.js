#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { readConfig } from './config.js';
import { log } from './log.js';
import { createServer } from './server.js';

const config = readConfig();

if (!config.apiKey) {
  log('缺少环境变量 COMMANDCODE_API_KEY，请在 MCP 客户端的 env 段配置后重试。');
  process.exit(1);
}

log(`启动 ${config.baseUrl}`);

try {
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
} catch (error) {
  log(`启动失败：${error.stack || error.message}`);
  process.exit(1);
}
