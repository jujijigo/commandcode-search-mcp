#!/usr/bin/env node
/**
 * 验证「已发布到 npm 的包」真的可用。
 *
 * 与 test/ 的区别：那些用例测的是仓库里的源码，这个脚本测的是**装到磁盘上的
 * 发布产物**，能抓到源码正常但发布坏掉的问题——例如 bin 路径带 ./ 前缀时被
 * npm 静默丢弃、files 字段漏掉了某个目录、忘了在改动后重新发布。
 *
 * 用法：
 *   node scripts/verify-published.mjs              # 用 package.json 的版本号
 *   node scripts/verify-published.mjs 1.0.0        # 指定版本
 *   node scripts/verify-published.mjs latest       # 按 dist-tag 解析
 *
 * 需要 COMMANDCODE_API_KEY 才会跑真实搜索调用；没设就跳过，不算失败。
 * 任何一项检查失败都会以非 0 退出。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/+$/, '');

const failures = [];
const notes = [];

function ok(label, detail = '') {
  console.log(`  ✔ ${label}${detail ? `  ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.log(`  ✖ ${label}${detail ? `  ${detail}` : ''}`);
  failures.push(label);
}

function skip(label, detail = '') {
  console.log(`  ○ ${label}${detail ? `  ${detail}` : ''}`);
  notes.push(label);
}

/**
 * 统一收尾：打印汇总并设置退出码。
 * 用 exitCode 而非 process.exit()——后者会在 fetch/子进程句柄仍活动时触发
 * libuv 断言（Windows 上表现为退出码 127 并附带一堆 C++ 报错）。
 */
function finish() {
  console.log();
  if (failures.length) {
    console.log(`✖ ${failures.length} 项检查失败：${failures.join('；')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✔ 全部检查通过${notes.length ? `（${notes.length} 项跳过）` : ''}`);
}

/**
 * 不经过 shell 调 npm，避免 Windows 上的引号与 cmd /c 问题。
 *
 * npm-cli.js 的位置随安装方式而变：官方安装包与 mise/nvm 放在 node 同级或
 * 上级的 node_modules 里，发行版的包管理器则放在别处。逐一探测，都找不到
 * 才退回 PATH 上的 npm。
 */
function findNpmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(process.execPath, '..', '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function runNpm(args, cwd) {
  const npmCli = findNpmCli();
  const [command, commandArgs] = npmCli
    ? [process.execPath, [npmCli, ...args]]
    : [process.platform === 'win32' ? 'npm.cmd' : 'npm', args];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: !npmCli && process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(out);
      else rejectPromise(new Error(`npm ${args.join(' ')} 退出码 ${code}\n${err || out}`));
    });
  });
}

/**
 * 读 registry 元数据。
 *
 * 必须破 CDN 缓存：registry 返回 `cache-control: public, max-age=300`，
 * 根文档被 Cloudflare 缓存长达 5 分钟，刚发布的版本在里面看不到
 * （实测 1.0.4 发布后 2 分钟、1.0.2 发布后同）。带 no-cache 头无效——
 * 实测仍返回 cf-cache-status: HIT；加一个唯一的查询参数才会 MISS 并回源。
 */
async function fetchJson(url) {
  const bust = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(bust, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`GET ${url} -> HTTP ${response.status}`);
  }
  return response.json();
}

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

/** 解析要验证的版本：显式参数可为版本号或 dist-tag */
async function resolveVersion(name, localVersion, requested) {
  const meta = await fetchJson(`${REGISTRY}/${name}`);
  const tags = meta['dist-tags'] || {};

  let version;
  if (!requested) {
    version = localVersion;
  } else if (meta.versions?.[requested]) {
    version = requested;
  } else if (tags[requested]) {
    version = tags[requested];
  } else {
    throw new Error(`registry 上找不到版本或 tag：${requested}`);
  }

  const manifest = meta.versions?.[version];
  if (!manifest) {
    throw new Error(`${name}@${version} 不在 registry 上（已发布：${Object.keys(meta.versions || {}).join(', ')}）`);
  }
  return { version, manifest, tags };
}

async function main() {
  const requested = process.argv[2];
  const local = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const name = local.name;

  console.log(`\n验证 ${name} 的发布产物（registry: ${REGISTRY}）\n`);

  // ── 1. registry 元数据 ────────────────────────────────────────────────
  console.log('registry 元数据');
  let version;
  let manifest;
  let tags;
  try {
    ({ version, manifest, tags } = await resolveVersion(name, local.version, requested));
  } catch (error) {
    fail('无法从 registry 解析版本', error.message);
    finish();
    return;
  }
  ok('包已发布', `${name}@${version}`);
  console.log(`     dist-tags: ${Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);

  if (version !== local.version) {
    fail('发布版本与 package.json 不一致', `package.json=${local.version}，registry=${version}`);
  } else {
    ok('版本与 package.json 一致', version);
  }

  // bin 字段被 npm 静默丢弃是真实踩过的坑，单独断言
  const binName = Object.keys(manifest.bin || {})[0];
  if (!binName) {
    fail('manifest 里没有 bin 字段', 'npx 将找不到入口');
  } else {
    ok('bin 入口存在', `${binName} -> ${manifest.bin[binName]}`);
  }

  // ── 2. 全新安装 ───────────────────────────────────────────────────────
  console.log('\n从 registry 安装');
  const dir = await mkdtemp(join(tmpdir(), 'cc-verify-'));
  try {
    await runNpm(['install', `${name}@${version}`, '--no-audit', '--no-fund', '--loglevel=error'], dir);
    ok('安装成功', dir);

    const installedDir = join(dir, 'node_modules', name);

    // 这是关键：早先的验证被本地符号链接污染过，看起来通过实则加载本地源码
    if ((await stat(installedDir)).isSymbolicLink()) {
      fail('安装结果是符号链接', `realpath=${await realpath(installedDir)}`);
    } else {
      ok('安装的是真实目录而非链接');
    }

    const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8'));
    const entry = lock.packages[`node_modules/${name}`] || {};
    if (entry.resolved?.startsWith(REGISTRY)) {
      ok('lock 来源指向 registry', entry.resolved);
    } else {
      fail('lock 来源不是 registry', entry.resolved || '(缺失)');
    }
    if (entry.integrity) {
      ok('带有 integrity 校验', entry.integrity.slice(0, 32) + '...');
    } else {
      fail('lock 里没有 integrity');
    }

    // ── 3. 发布产物与仓库源码是否一致 ──────────────────────────────────
    console.log('\n发布产物 vs 仓库源码');
    const localSrc = join(ROOT, 'src');
    const publishedSrc = join(installedDir, 'src');
    const localFiles = (await readdir(localSrc)).sort();
    const publishedFiles = (await readdir(publishedSrc)).sort();

    const onlyLocal = localFiles.filter((f) => !publishedFiles.includes(f));
    const onlyPublished = publishedFiles.filter((f) => !localFiles.includes(f));
    if (onlyLocal.length) fail('仓库有源码未发布', onlyLocal.join(', '));
    if (onlyPublished.length) fail('registry 有本地没有的文件', onlyPublished.join(', '));
    if (!onlyLocal.length && !onlyPublished.length) ok('文件清单一致', `${localFiles.length} 个文件`);

    const drifted = [];
    for (const file of localFiles.filter((f) => publishedFiles.includes(f))) {
      if (await sha256(join(localSrc, file)) !== await sha256(join(publishedSrc, file))) {
        drifted.push(file);
      }
    }
    if (drifted.length) {
      fail('源码内容不一致（改动后可能忘了重新发布）', drifted.join(', '));
    } else {
      ok('源码内容逐字节一致');
    }

    // ── 4. bin 目标文件真的存在 ───────────────────────────────────────
    console.log('\nbin 可执行性');
    const installedManifest = JSON.parse(await readFile(join(installedDir, 'package.json'), 'utf8'));
    const binTarget = installedManifest.bin?.[binName];
    if (!binTarget) {
      fail('安装后的 manifest 没有 bin 字段');
    } else if (!existsSync(join(installedDir, binTarget))) {
      fail('bin 指向的文件不存在', binTarget);
    } else {
      ok('bin 目标文件存在', binTarget);
    }

    // ── 5. MCP 握手 ───────────────────────────────────────────────────
    console.log('\nMCP 协议');
    let client;
    const entryPath = join(installedDir, binTarget || 'src/index.js');
    try {
      client = new Client({ name: 'verify-published', version: '1.0.0' });
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [entryPath],
        env: { ...process.env, COMMANDCODE_API_KEY: process.env.COMMANDCODE_API_KEY || 'user_verify_placeholder' },
      }));

      const info = client.getServerVersion();
      if (info?.name === local.name) ok('serverInfo 正确', `${info.name} ${info.version}`);
      else fail('serverInfo 名字不符', JSON.stringify(info));

      const { tools } = await client.listTools();
      const got = tools.map((t) => t.name).sort();

      // 期望值取自仓库源码，从而验证「发布出去的 schema 确实是这份代码」
      const { TOOLS } = await import(pathToFileURL(join(ROOT, 'src', 'schemas.js')).href);
      const want = TOOLS.map((t) => t.name).sort();
      if (JSON.stringify(got) === JSON.stringify(want)) {
        ok('工具清单与仓库源码一致', got.join(', '));
      } else {
        fail('工具清单不一致', `registry=[${got.join(', ')}] 仓库=[${want.join(', ')}]`);
      }
    } catch (error) {
      fail('MCP 握手失败', error.message);
    }

    // ── 6. 真实调用（可选） ────────────────────────────────────────────
    console.log('\n真实调用');
    const apiKey = process.env.COMMANDCODE_API_KEY;
    if (!apiKey) {
      skip('未设置 COMMANDCODE_API_KEY，跳过真实搜索');
    } else if (!client) {
      skip('握手失败，跳过真实搜索');
    } else {
      try {
        const result = await client.callTool({
          name: 'web_search',
          arguments: { query: 'npm registry', numResults: 1 },
        });
        if (result.isError) {
          fail('web_search 返回错误', result.content?.[0]?.text?.slice(0, 120));
        } else {
          ok('web_search 调用成功', `${result.content[0].text.split('\n')[0].slice(0, 60)}`);
        }
      } catch (error) {
        fail('web_search 调用异常', error.message);
      }
    }

    await client?.close().catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // ── 汇总 ─────────────────────────────────────────────────────────────
  finish();
}

// 顶层兜底：任何未预期的异常都给出简洁信息而不是堆栈，并保持退出码为 1
try {
  await main();
} catch (error) {
  console.error(`\n✖ 验证无法完成：${error.message}`);
  process.exitCode = 1;
}
