import { log } from './log.js';

/**
 * 调用 Command Code 的 alpha 接口。
 *
 * 只负责发请求与把上游的各种错误形状归一成 Error，
 * 参数校验留给各工具自己做（它的报错信息更贴近用户能改的地方）。
 */
export function createClient({ baseUrl, apiKey }) {
  async function callApi(route, body, timeoutMs) {
    let response;
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new Error(`请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已中止`);
      }
      if (error?.cause?.code === 'ENOTFOUND' || error?.cause?.code === 'ECONNREFUSED') {
        throw new Error(`无法连接 ${baseUrl}（${error.cause.code}）`);
      }
      throw error;
    }

    const raw = await response.text();
    log(`POST ${route} -> ${response.status}（${raw.length} 字节）`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`HTTP ${response.status}，响应不是合法 JSON：${raw.slice(0, 300)}`);
    }

    if (!response.ok || data?.success === false) {
      const detail = data?.message || data?.error?.message || data?.cause || `HTTP ${response.status}`;
      // 上游的 BAD_REQUEST 会带上自己文档的链接，一并透出便于定位参数问题
      const docs = data?.error?.docs;
      throw new Error(docs ? `${detail}（${docs}）` : detail);
    }
    return data;
  }

  return {
    search: (body) => callApi('/alpha/web-search', body),
    fetch: (body, timeoutMs) => callApi('/alpha/web-fetch', body, timeoutMs),
  };
}
