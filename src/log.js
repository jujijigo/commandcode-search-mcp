import { SERVER_NAME } from './config.js';

/**
 * 日志一律走 stderr：stdout 是 stdio 传输的 JSON-RPC 通道，
 * 往那里写任何非 JSON 内容都会破坏协议。
 */
export function log(message) {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}
