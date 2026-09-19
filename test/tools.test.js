import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampFetchTimeout,
  clampNumResults,
  clampStartIndex,
  normalizeDomains,
  runWebFetch,
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
    fetch: async (body, timeoutMs) => {
      calls.push({ ...body, timeoutMs });
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

  it('把 startIndex 归一到非负整数', () => {
    assert.equal(clampStartIndex(-5), 0);
    assert.equal(clampStartIndex(10.9), 10);
    assert.equal(clampStartIndex('abc'), 0);
  });

  it('把 timeout 夹在 1..120 秒', () => {
    assert.equal(clampFetchTimeout(0), 1);
    assert.equal(clampFetchTimeout(500), 120);
    assert.equal(clampFetchTimeout(undefined), 60);
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

describe('web_fetch', () => {
  it('短内容原样返回，不加分页提示', async () => {
    const client = fakeClient({ content: 'short body' });
    const result = await runWebFetch(client, { url: 'https://a.test' });

    assert.equal(result.content[0].text, 'short body');
    assert.equal(client.calls[0].timeoutMs, 60_000);
    assert.equal(client.calls[0].format, 'markdown');
  });

  it('不把 startIndex / timeout 透给上游', async () => {
    const client = fakeClient({ content: 'body' });
    await runWebFetch(client, { url: 'https://a.test', startIndex: 2, timeout: 10, format: 'text' });

    assert.deepEqual(Object.keys(client.calls[0]).sort(), ['format', 'timeoutMs', 'url']);
  });

  it('超长内容截断并给出续读下标', async () => {
    const body = 'x'.repeat(100_050);
    const client = fakeClient({ content: body });
    const result = await runWebFetch(client, { url: 'https://a.test' });

    assert.equal(result.content[0].text.length, 100_000 + '\n\n[内容未结束，剩余 50 字符；续读请传 startIndex=100000]'.length);
    assert.match(result.content[0].text, /续读请传 startIndex=100000/);
  });

  it('续读时带上头部说明与剩余量', async () => {
    const body = 'x'.repeat(200_050);
    const client = fakeClient({ content: body });
    const result = await runWebFetch(client, { url: 'https://a.test', startIndex: 100_000 });

    assert.match(result.content[0].text, /正文共 200050 字符，本次从第 100000 字符开始/);
    assert.match(result.content[0].text, /剩余 50 字符/);
  });

  it('续读到最后一页时只带头部、不带续读提示', async () => {
    const body = 'x'.repeat(100_050);
    const client = fakeClient({ content: body });
    const result = await runWebFetch(client, { url: 'https://a.test', startIndex: 100_000 });

    assert.match(result.content[0].text, /本次从第 100000 字符开始/);
    assert.doesNotMatch(result.content[0].text, /内容未结束/);
  });

  it('startIndex 越界时明确报错', async () => {
    const client = fakeClient({ content: 'short' });
    const result = await runWebFetch(client, { url: 'https://a.test', startIndex: 99 });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /已越界/);
  });

  it('内容为空时报错', async () => {
    const client = fakeClient({ content: '   ' });
    const result = await runWebFetch(client, { url: 'https://a.test' });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /内容为空/);
  });

  it('缺少 url 时报错，且不发起请求', async () => {
    const client = fakeClient({ content: 'x' });
    const result = await runWebFetch(client, {});

    assert.equal(result.isError, true);
    assert.equal(client.calls.length, 0);
  });
});
