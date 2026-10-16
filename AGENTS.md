# pi-ws-recovery

Pi OpenAI Codex WebSocket 回退恢复扩展，Node 24+、Pi 1.1+，TypeScript 源码直接加载。

- `src/index.ts`：状态标识、`/ws` 命令、请求与消息钩子。
- `src/recovery.ts`：回退状态机（冷却退避、1009 请求体门槛、状态文案）。
- `src/codex-module.ts`：定位当前进程实际加载的 Codex provider 模块。
- `npm run check`：类型检查与隔离测试，不访问真实模型。

恢复依赖 Codex provider 模块导出的 `getOpenAICodexWebSocketDebugStats` / `resetOpenAICodexWebSocketDebugStats`，它们不在 Pi 扩展公开 API 内；模块按 `getPackageDir()` 下的 `dist/bundle/chunks/openai-codex-responses-*.js` 与 `pi-ai/dist/api/openai-codex-responses.js` 查找。Pi 升级后核对：
1. 两个导出仍在，且 reset 仍会清除该会话的 SSE 回退标记。
2. `before_provider_request`（provider 的 `onPayload`）仍早于 provider 读取回退标记。
3. 失败诊断仍为 `provider_transport_failure`，含 `error.code` 与 `details.requestBytes`。

路径只由 `getPackageDir()` 推导，不写平台或本机路径。界面提示用中文。
禁止提交凭据、真实提示或会话数据。
