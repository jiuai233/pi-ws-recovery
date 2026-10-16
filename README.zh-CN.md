# pi-ws-recovery

**为 Pi 的 OpenAI Codex 模型标出 WebSocket 回退，并自动恢复 WebSocket。**

[安装](#安装) · [命令](#命令) · [English](README.md)

Pi 的 Codex provider 在 WebSocket 失败后会改走 SSE，并且在当前进程里一直保持 SSE。这个扩展：

- **状态直接可见**：Codex 模型在状态栏显示 `⇄ WS`；回退期间变为警告色 `⇄ WS→SSE`，重试 WebSocket 时显示 `⇄ WS 重连中`。传输设为 `sse` 时不显示。
- **自动恢复 WebSocket**：冷却后让下一次请求重试 WebSocket，冷却按 30、60、120、240、300 秒退避；重试成功即恢复。
- **接管已回退的会话**：加载或 `/reload` 时，读取 provider 里已处于 SSE 回退的会话，下一次请求即重试 WebSocket。
- **超大请求单独处理**：`1009 message too big` 后，请求体比失败时缩小至少 20% 才重试。

只作用于 `openai-codex-responses` 模型，不改写请求内容，不修改 Pi 的安装文件。

## 安装

依赖 Node.js 24+、Pi 1.1.0+。

```bash
pi install git:github.com/jiuai233/pi-ws-recovery
```

在 Pi 中运行 `/reload`。

## 命令

| 命令 | 功能 |
| --- | --- |
| `/ws`、`/ws status` | 查看当前会话的回退原因、连续失败次数、最近错误和下次重试时间 |
| `/ws retry` | 跳过冷却，下一次请求立即重试 WebSocket |

## 行为说明

- 流式输出中途断开时，本轮请求仍以错误结束，由 Pi 的自动重试改走 SSE 完成；扩展只负责标识和之后的恢复。
- 回退状态按会话保存在内存中，重启 Pi 后从 WebSocket 开始；安装后对已运行的 Pi 执行 `/reload` 即可生效。
- 恢复依赖 Pi Codex provider 模块的调试导出；找不到该模块时只显示标识，`/ws` 会提示本进程保持 SSE。
