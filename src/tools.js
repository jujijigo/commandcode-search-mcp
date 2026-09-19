import {
  FETCH_FORMATS,
  FETCH_TIMEOUT,
  FETCH_WINDOW,
  NUM_RESULTS,
} from './config.js';

/**
 * MCP 协议里工具参数已经由 inputSchema 校验过类型与范围，
 * 这里的 clamp 针对的是「客户端没校验」和「模型给了边界值」两种情况，
 * 保证送给上游的参数一定落在它接受的区间内。
 */

export function normalizeDomains(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function clampNumResults(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NUM_RESULTS.fallback;
  return Math.min(NUM_RESULTS.max, Math.max(NUM_RESULTS.min, Math.round(parsed)));
}

export function clampStartIndex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function clampFetchTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return FETCH_TIMEOUT.fallback;
  return Math.min(FETCH_TIMEOUT.max, Math.max(FETCH_TIMEOUT.min, Math.round(parsed)));
}

export function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

export async function runWebSearch(client, args = {}) {
  const query = String(args.query ?? '').trim();
  if (query.length < 2) {
    return errorResult('web_search 需要至少 2 个字符的 query 参数。');
  }

  const allowedDomains = normalizeDomains(args.allowed_domains);
  const blockedDomains = normalizeDomains(args.blocked_domains);
  if (allowedDomains.length > 0 && blockedDomains.length > 0) {
    return errorResult('web_search 的 allowed_domains 与 blocked_domains 只能选其一，请重试。');
  }

  const numResults = clampNumResults(args.numResults);
  const filtered = allowedDomains.length > 0 || blockedDomains.length > 0;

  try {
    const data = await client.search({
      query,
      numResults,
      ...(allowedDomains.length > 0 ? { allowedDomains } : {}),
      ...(blockedDomains.length > 0 ? { blockedDomains } : {}),
    });

    const results = Array.isArray(data.results) ? data.results : [];
    if (results.length === 0) {
      const hint = filtered
        ? '可以放宽或去掉域名过滤，或换个说法再试。'
        : '可以换一个更宽泛或不同措辞的查询词。';
      return textResult(`没有找到 "${query}" 的结果。${hint}`);
    }

    const lines = results.map((item, index) => {
      const title = item?.title || '(无标题)';
      const url = item?.url || '';
      const snippet = item?.snippet ? `\n   ${item.snippet}` : '';
      return `${index + 1}. ${title}\n   ${url}${snippet}`;
    });
    return textResult(`"${query}" 的搜索结果：\n\n${lines.join('\n\n')}`);
  } catch (error) {
    return errorResult(`搜索失败：${error.message}`);
  }
}

export async function runWebFetch(client, args = {}) {
  const url = String(args.url ?? '').trim();
  if (!url) {
    return errorResult('web_fetch 需要 url 参数。');
  }

  const format = FETCH_FORMATS.includes(args.format) ? args.format : 'markdown';
  const startIndex = clampStartIndex(args.startIndex);
  const timeoutSeconds = clampFetchTimeout(args.timeout);

  try {
    // 只传上游真正认识的字段：startIndex 与 timeout 由本层处理，
    // 服务端对这两个键（以及 offset/page/skip 等别名）一律静默忽略。
    const data = await client.fetch({ url, format }, timeoutSeconds * 1000);
    const content = typeof data.content === 'string' ? data.content : JSON.stringify(data.content ?? '');
    if (!content.trim()) {
      return errorResult(`抓取 ${url} 成功，但内容为空。`);
    }

    if (startIndex >= content.length) {
      return errorResult(
        `抓取 ${url} 成功，正文共 ${content.length} 字符，startIndex ${startIndex} 已越界，没有可返回的内容。`,
      );
    }

    const window = content.slice(startIndex, startIndex + FETCH_WINDOW);
    const nextIndex = startIndex + window.length;
    const truncated = nextIndex < content.length;

    // 未触发分页时保持原样返回，不往正文里塞任何提示
    if (startIndex === 0 && !truncated) {
      return textResult(window);
    }

    const header = startIndex === 0
      ? ''
      : `（${url} 正文共 ${content.length} 字符，本次从第 ${startIndex} 字符开始）\n\n`;
    const footer = truncated
      ? `\n\n[内容未结束，剩余 ${content.length - nextIndex} 字符；续读请传 startIndex=${nextIndex}]`
      : '';

    return textResult(header + window + footer);
  } catch (error) {
    return errorResult(`抓取失败：${error.message}`);
  }
}
