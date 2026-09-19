import { NUM_RESULTS } from './config.js';

/**
 * 工具的 JSON Schema 定义。
 *
 * description 写给模型看，需要说清「什么时候用」与「参数的坑」；
 * 约束（minimum/maximum）与 tools.js 里的 clamp 保持一致，
 * 前者让模型少犯错，后者兜住客户端不校验的情况。
 */
export const TOOLS = [
  {
    name: 'web_search',
    description: [
      '使用 Command Code 的搜索服务检索互联网，返回标题、链接和摘要。',
      '适用于查询当前信息、新闻、文档或任何需要联网才能回答的问题。',
      '可以用 allowed_domains 或 blocked_domains 限制来源（两者不能同时使用）。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询词，至少 2 个字符。' },
        numResults: {
          type: 'integer',
          minimum: NUM_RESULTS.min,
          maximum: NUM_RESULTS.max,
          description: `返回结果数量，默认 ${NUM_RESULTS.fallback}。`,
        },
        allowed_domains: {
          type: 'array',
          items: { type: 'string' },
          description: '只在这些域名内搜索。不要与 blocked_domains 同时使用。',
        },
        blocked_domains: {
          type: 'array',
          items: { type: 'string' },
          description: '排除这些域名。不要与 allowed_domains 同时使用。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];
