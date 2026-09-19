# commandcode-mcp-server

把 Command Code 的网页搜索服务封装为 [MCP](https://modelcontextprotocol.io) 服务。

stdio 类型，提供 `web_search` 工具，任何支持 MCP 的客户端（Claude Code、
Claude Desktop 等）都可以接入。已发布到 npm，无需预先安装——`npx` 会在首次
运行时自动拉取。

## 使用

### 配置

#### Claude Code

```bash
claude mcp add commandcode-mcp-server --scope user \
  -e COMMANDCODE_API_KEY=user_xxxxxxxx \
  -- npx -y commandcode-mcp-server@latest
```

#### 手写 JSON

写在 `~/.claude.json` 的顶层 `mcpServers` 里（项目的 `.mcp.json` 同样适用）：

```json
{
  "mcpServers": {
    "commandcode-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "commandcode-mcp-server@latest"],
      "env": {
        "COMMANDCODE_API_KEY": "user_xxxxxxxx"
      }
    }
  }
}
```

用 `@latest` 还是钉死版本，取决于你要不要自动跟进新版本：`@latest` 每次启动
都会向 registry 查询并拉取最新版，配置不用动；写成 `@1.0.2` 则永久停在那个
版本，需要手动改。

#### Windows

如果 `npx` 不在 `PATH` 里，或是遇到 shell 解析问题，可以显式套一层 `cmd /c`：

```json
{
  "type": "stdio",
  "command": "cmd",
  "args": ["/c", "npx", "-y", "commandcode-mcp-server@latest"],
  "env": { "COMMANDCODE_API_KEY": "user_xxxxxxxx" }
}
```

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `COMMANDCODE_API_KEY` | 是 | — | Command Code 的 API Key，`user_` 开头。缺失时进程会直接退出 |
| `COMMANDCODE_BASE_URL` | 否 | `https://api.commandcode.ai` | 上游地址，便于指向自建或测试环境 |

### 工具

#### `web_search`

检索互联网，返回标题、链接与摘要。

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 搜索词，至少 2 个字符 |
| `numResults` | integer | 否 | 返回条数，默认 5，上限 10（上游硬限制） |
| `allowed_domains` | string[] | 否 | 只在这些域名内搜索 |
| `blocked_domains` | string[] | 否 | 排除这些域名 |

`allowed_domains` 与 `blocked_domains` 互斥，同时传会直接报错。

## 开发

### 常用命令

```bash
npm install
npm test        # 12 个用例，覆盖参数校验与 MCP 协议层
npm start       # 直接从源码启动（需已设置 COMMANDCODE_API_KEY）
```

调试时可以看 stderr 上的日志，它会记录每次上游请求的路径、状态码与响应字节数：

```
[commandcode-mcp-server] 启动 https://api.commandcode.ai
[commandcode-mcp-server] POST /alpha/web-search -> 200（1359 字节）
```

stdout 是 stdio 传输的 JSON-RPC 通道，日志一律走 stderr，不要往 stdout 写东西。

### 接入本地源码

要调试尚未发布的改动，把配置里的包名换成仓库路径即可：

```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "file:D:/workspace/commandcode-mcp-server"],
  "env": { "COMMANDCODE_API_KEY": "user_xxxxxxxx" }
}
```

### 验证已发布的包

`npm test` 测的是仓库里的源码，`npm run verify:published` 测的是**装到磁盘上的
发布产物**，用来抓「本地正常、发布后坏掉」的问题——例如 `bin` 路径写成
`./src/index.js` 时被 npm 静默丢弃、`files` 字段漏掉某个目录、改了代码忘了重新
发布。

```bash
npm run verify:published            # 用 package.json 里的版本号
npm run verify:published 1.0.0      # 指定版本
npm run verify:published latest     # 按 dist-tag 解析
```

脚本会在临时目录里从 registry 全新安装，然后检查：

- `bin` 字段确实存在，且指向的文件真的打进了 tarball
- 安装结果是真实目录而非符号链接，lock 里的 `resolved` 指向 registry 且带 integrity
- 发布出去的 `src/*.js` 与仓库源码**逐字节一致**（防止忘了重新发布）
- MCP 握手成功，`tools/list` 与仓库源码里的 schema 一致
- 设置了 `COMMANDCODE_API_KEY` 时，再跑一次真实的 `web_search` 调用

任何一项不符都会以非 0 退出，可以直接串进 CI。没设 API Key 时跳过真实调用，
不算失败。

### 发布

推送 `v*` tag 即触发 [.github/workflows/publish.yml](.github/workflows/publish.yml)：
校验 tag 与 `package.json` 版本一致 → `npm ci` → `npm test` → `npm publish`。

```bash
npm version patch        # 升版本并打 tag
git push --follow-tags
```

发布成功后，[.github/workflows/verify-published.yml](.github/workflows/verify-published.yml)
通过 `workflow_run` 自动接手验证产物。**Publish 的绿/红只表示「是否发布成功」**，
产物是否可用看 Verify published 的结果。

两者拆开是有原因的：验证要读 registry 元数据，而刚发布完的那个 runner 常拿到
陈旧缓存（1.0.2 那次两分钟都没刷新，导致发布明明成功却报红）。换成全新 runner
且晚于发布启动，能绕开这个问题。

认证走 npm **Trusted Publishing**（OIDC），不需要任何长期 token，并自动附上
provenance 签名。这需要在 npmjs.com 的包设置里一次性配置：

| 字段 | 值 |
| --- | --- |
| Organization/user | `kywrl` |
| Repository | `commandcode-mcp-server` |
| Workflow filename | `publish.yml` |

这个配置不匹配时不会提前报错，只会在 `npm publish` 时以 `ENEEDAUTH` 失败。
工作流固定用 Node 24，因为 Trusted Publishing 要求 Node ≥ 22.14 且 npm ≥ 11.5.1。

### 代码结构

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 入口：校验配置、接上 stdio 传输层 |
| `src/server.js` | 组装 MCP Server，注册 `tools/list` 与 `tools/call` |
| `src/schemas.js` | 工具的 JSON Schema 定义 |
| `src/tools.js` | 工具实现：参数校验、结果拼装 |
| `src/client.js` | 上游 HTTP 客户端与错误归一 |
| `src/config.js` | 环境变量读取、上游限制常量、版本号（取自 package.json） |
| `src/log.js` | stderr 日志 |
| `scripts/verify-published.mjs` | 验证 registry 上的发布产物（不随包发布） |

## 许可

MIT
