import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { createClient } from './client.js';
import { readConfig, SERVER_NAME, SERVER_VERSION } from './config.js';
import { log } from './log.js';
import { TOOLS } from './schemas.js';
import { errorResult, runWebFetch, runWebSearch } from './tools.js';

const HANDLERS = {
  web_search: runWebSearch,
  web_fetch: runWebFetch,
};

/**
 * 组装一个尚未连接传输层的 MCP Server。
 * 拆出来是为了测试能直接注入 client 与 config，不必真的起进程。
 */
export function createServer(config = readConfig()) {
  const client = createClient(config);

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    const handler = HANDLERS[name];

    if (!handler) {
      return errorResult(`未知工具：${name}`);
    }

    try {
      return await handler(client, args);
    } catch (error) {
      // runWebSearch / runWebFetch 自己会兜住上游错误，
      // 走到这里说明是本层的意外异常，记全栈但只把消息给模型。
      log(`工具 ${name} 执行异常：${error.stack || error.message}`);
      return errorResult(`工具 ${name} 执行异常：${error.message}`);
    }
  });

  return server;
}
