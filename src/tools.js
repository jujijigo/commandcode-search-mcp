import { NUM_RESULTS } from './config.js';

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
