# 把 Command Code 的网页搜索服务暴露为 MCP 工具

`commandcode-mcp-server` 是一个 stdio 类型的 [MCP](https://modelcontextprotocol.io)
服务，封装 Command Code 的 `/alpha/web-search` 接口，提供 `web_search` 工具。
任何支持 MCP 的客户端（Claude Code、Claude Desktop 等）都可以接入。

## 安装

```bash
npm install -g commandcode-mcp-server
```

或直接由 `npx` 按需拉取，无需预先安装（见下面的配置示例）。

## 配置

### Claude Code

```bash
claude mcp add commandcode-mcp-server --scope user \
  -e COMMANDCODE_API_KEY=user_xxxxxxxx \
  -- npx -y commandcode-mcp-server
```

### 手写 JSON

写在 `~/.claude.json` 的顶层 `mcpServers` 里：

```json
{
  "mcpServers": {
    "commandcode-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "commandcode-mcp-server"],
      "env": {
        "COMMANDCODE_API_KEY": "user_xxxxxxxx"
      }
    }
  }
}
```

Windows 上如果 `npx` 不在 `PATH` 里，或是遇到 shell 解析问题，可以显式套一层
`cmd /c`：

```json
{
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "npx", "-y", "commandcode-mcp-server"],
  "env": { "COMMANDCODE_API_KEY": "user_xxxxxxxx" }
}
```

要在本机开发版上跑（未发布到 npm 时），把包名换成路径即可：

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "file:D:/workspace/commandcode-mcp-server"],
  "env": { "COMMANDCODE_API_KEY": "user_xxxxxxxx" }
}
```

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `COMMANDCODE_API_KEY` | 是 | — | Command Code 的 API Key，`user_` 开头。缺失时进程会直接退出 |
| `COMMANDCODE_BASE_URL` | 否 | `https://api.commandcode.ai` | 上游地址，便于指向自建或测试环境 |

## 工具

### `web_search`

检索互联网，返回标题、链接与摘要。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 搜索词，至少 2 个字符 |
| `numResults` | integer | 否 | 返回条数，默认 5，上限 10（上游硬限制） |
| `allowed_domains` | string[] | 否 | 只在这些域名内搜索 |
| `blocked_domains` | string[] | 否 | 排除这些域名 |

`allowed_domains` 与 `blocked_domains` 互斥，同时传会直接报错。

## 开发

```bash
npm install
npm test        # 11 个用例，覆盖参数校验与 MCP 协议层
npm start       # 直接从源码启动（需已设置 COMMANDCODE_API_KEY）
```

调试时可以看 stderr 上的日志，它会记录每次上游请求的路径、状态码与响应字节数：

```
[commandcode-mcp-server] 启动 https://api.commandcode.ai
[commandcode-mcp-server] POST /alpha/web-search -> 200（1359 字节）
```

stdout 是 stdio 传输的 JSON-RPC 通道，日志一律走 stderr，不要往 stdout 写东西。

### 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 入口：校验配置、接上 stdio 传输层 |
| `src/server.js` | 组装 MCP Server，注册 `tools/list` 与 `tools/call` |
| `src/schemas.js` | 两个工具的 JSON Schema 定义 |
| `src/tools.js` | 工具实现：参数校验、结果拼装 |
| `src/client.js` | 上游 HTTP 客户端与错误归一 |
| `src/config.js` | 环境变量读取与上游限制常量 |
| `src/log.js` | stderr 日志 |

## 许可

MIT
