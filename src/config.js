/**
 * 运行期配置与上游限制。
 *
 * 全部参数都从环境变量读取，方便在 MCP 客户端的 env 段注入，
 * 这样同一份 npx 配置可以在不同机器上复用。
 */

const DEFAULT_BASE_URL = 'https://api.commandcode.ai';

/** 上游硬限制：numResults > 10 会返回 400 Too big，< 1 返回 400 Too small。 */
export const NUM_RESULTS = { min: 1, max: 10, fallback: 5 };

/**
 * web_fetch 的分页窗口。上游 /alpha/web-fetch 既不截断也不分页（实测抓
 * World_War_II 会返回 17 万字符整页），窗口与 startIndex 续读都是官方 CLI
 * 在客户端做的事，这里照做，以免整页灌进上下文。
 */
export const FETCH_WINDOW = 100_000;
export const FETCH_TIMEOUT = { min: 1, max: 120, fallback: 60 };

export const FETCH_FORMATS = ['markdown', 'text', 'html'];

export const SERVER_NAME = 'commandcode-mcp-server';
export const SERVER_VERSION = '1.0.0';

export function readConfig(env = process.env) {
  return {
    baseUrl: (env.COMMANDCODE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: env.COMMANDCODE_API_KEY || '',
  };
}
