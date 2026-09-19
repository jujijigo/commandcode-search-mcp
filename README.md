# 把 Command Code 的网页搜索与抓取服务暴露为 MCP 工具

`commandcode-mcp-server` 是一个 stdio 类型的 [MCP](https://modelcontextprotocol.io)
服务，封装 Command Code 的 `/alpha/web-search` 与 `/alpha/web-fetch` 两个接口，
提供 `web_search` 与 `web_fetch` 两个工具。任何支持 MCP 的客户端（Claude Code、
Claude Desktop 等）都可以接入。

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

### `web_fetch`

抓取一个已知 URL 的正文，能处理 JavaScript 渲染、反爬与重定向。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 完整的公开 URL，`http` 会被自动升级为 `https` |
| `format` | string | 否 | `markdown`（默认）、`text` 或 `html` |
| `startIndex` | integer | 否 | 从正文第几个字符开始返回，默认 0，用于长文续读 |
| `timeout` | integer | 否 | 本次抓取超时秒数，默认 60，上限 120 |

上游 `/alpha/web-fetch` 既不截断也不分页（实测抓 `World_War_II` 会返回 17 万
字符整页），因此本服务在客户端侧做窗口化：正文超过 100000 字符时只返回首个
窗口，并在末尾给出 `startIndex=N` 的续读提示。内容没被截断时不会有任何提示
文字混进正文。

## 开发

```bash
npm install
npm test        # 21 个用例，覆盖参数校验、分页与 MCP 协议层
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
| `src/tools.js` | 工具实现：参数校验、结果拼装、fetch 分页 |
| `src/client.js` | 上游 HTTP 客户端与错误归一 |
| `src/config.js` | 环境变量读取与上游限制常量 |
| `src/log.js` | stderr 日志 |

## 许可

MIT
