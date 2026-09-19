import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { createServer } from '../src/server.js';
import { SERVER_NAME } from '../src/config.js';

/** 用内存传输层把真的 MCP Client 接到真的 Server 上，走完整的握手与调用链路 */
async function connect(config = { baseUrl: 'https://api.example.test', apiKey: 'user_test' }) {
  const server = createServer(config);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

describe('MCP server 协议层', () => {
  it('initialize 后上报服务名与 tools 能力', async () => {
    const { client, server } = await connect();
    assert.equal(client.getServerVersion().name, SERVER_NAME);
    assert.ok(client.getServerCapabilities().tools !== undefined);
    await server.close();
  });

  it('tools/list 暴露 web_search 与 web_fetch', async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    assert.deepEqual(tools.map((t) => t.name).sort(), ['web_fetch', 'web_search']);
    const search = tools.find((t) => t.name === 'web_search');
    assert.deepEqual(search.inputSchema.required, ['query']);
    assert.equal(search.inputSchema.additionalProperties, false);
    await server.close();
  });

  it('调用未知工具返回未知工具错误', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({ name: 'nope', arguments: {} });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /未知工具：nope/);
    await server.close();
  });

  it('缺 API Key 的参数校验在工具层报错，不触网', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({ name: 'web_search', arguments: { query: 'x' } });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /至少 2 个字符/);
    await server.close();
  });
});
