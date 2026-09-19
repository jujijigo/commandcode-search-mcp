import {
  FETCH_FORMATS,
  FETCH_TIMEOUT,
  FETCH_WINDOW,
  NUM_RESULTS,
} from './config.js';

/**
 * 工具的 JSON Schema 定义。
 *
 * description 写给模型看，需要说清「什么时候用」与「参数的坑」；
 * 约束（minimum/maximum/enum）与 tools.js 里的 clamp 保持一致，
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
  {
    name: 'web_fetch',
    description: [
      '使用 Command Code 的抓取服务读取一个已知 URL 的网页内容。',
      '能处理 JavaScript 渲染的页面、反爬与重定向。',
      `长页面按 ${FETCH_WINDOW} 字符分段返回，用 startIndex 续读后续内容。`,
      '只在已经有明确 URL 时使用——例如来自 web_search 结果或用户直接给出的链接。',
    ].join(''),
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的公开 URL。http 会被自动升级为 https。' },
        format: {
          type: 'string',
          enum: FETCH_FORMATS,
          description: '返回格式，默认 markdown。',
        },
        startIndex: {
          type: 'integer',
          minimum: 0,
          description: '从正文第几个字符开始返回，用于长页面分页，默认 0。上一次结果被截断时，按其提示的 startIndex 续读。',
        },
        timeout: {
          type: 'integer',
          minimum: FETCH_TIMEOUT.min,
          maximum: FETCH_TIMEOUT.max,
          description: `本次抓取的超时秒数，默认 ${FETCH_TIMEOUT.fallback}，最大 ${FETCH_TIMEOUT.max}。`,
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
];
