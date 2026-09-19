import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampNumResults,
  normalizeDomains,
  runWebSearch,
} from '../src/tools.js';

/** 记录调用参数并返回预设响应的假 client */
function fakeClient(response) {
  const calls = [];
  return {
    calls,
    search: async (body) => {
      calls.push(body);
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

describe('clamp 工具函数', () => {
  it('把 numResults 夹在上游接受的 1..10', () => {
    assert.equal(clampNumResults(0), 1);
    assert.equal(clampNumResults(999), 10);
    assert.equal(clampNumResults(3.6), 4);
    assert.equal(clampNumResults('abc'), 5);
    assert.equal(clampNumResults(undefined), 5);
  });

  it('清洗域名数组', () => {
    assert.deepEqual(normalizeDomains([' example.com ', '', null]), ['example.com', 'null']);
    assert.deepEqual(normalizeDomains('example.com'), []);
  });
});

describe('web_search', () => {
  it('串起结果并带上序号', async () => {
    const client = fakeClient({
      results: [{ title: 'A', url: 'https://a.test', snippet: 'sa' }, { title: 'B', url: 'https://b.test' }],
    });
    const result = await runWebSearch(client, { query: 'hello world' });

    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /1\. A\n   https:\/\/a\.test\n   sa/);
    assert.match(result.content[0].text, /2\. B/);
    assert.equal(client.calls[0].numResults, 5);
  });

  it('拒绝过短的 query，且不发起请求', async () => {
    const client = fakeClient({ results: [] });
    const result = await runWebSearch(client, { query: 'a' });

    assert.equal(result.isError, true);
    assert.equal(client.calls.length, 0);
  });

  it('拒绝同时传 allowed 与 blocked', async () => {
    const client = fakeClient({ results: [] });
    const result = await runWebSearch(client, {
      query: 'hello',
      allowed_domains: ['a.test'],
      blocked_domains: ['b.test'],
    });

    assert.equal(result.isError, true);
    assert.equal(client.calls.length, 0);
  });

  it('命中域名过滤时带上放宽提示', async () => {
    const client = fakeClient({ results: [] });
    const result = await runWebSearch(client, { query: 'hello', allowed_domains: ['a.test'] });

    assert.match(result.content[0].text, /放宽或去掉域名过滤/);
    assert.deepEqual(client.calls[0].allowedDomains, ['a.test']);
  });

  it('把上游错误变成 isError 结果而非抛出', async () => {
    const client = fakeClient(new Error('上游炸了'));
    const result = await runWebSearch(client, { query: 'hello' });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /搜索失败：上游炸了/);
  });
});
