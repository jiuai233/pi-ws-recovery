import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findCodexModule, type CodexModule } from "./codex-module.ts";
import { canProbe, describe, recordFailure, transportFailure, type FallbackState } from "./recovery.ts";

const STATUS_KEY = "pi-ws-recovery";
const CODEX_API = "openai-codex-responses";
const ARGUMENTS = ["status", "retry"];

function isMagpieHttp(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "magpie" &&
    ["openai-responses", "openai-completions"].includes(ctx.model.api);
}

export default function wsRecovery(pi: ExtensionAPI): void {
  const states = new Map<string, FallbackState>();
  let codex: CodexModule | undefined;
  let recoverable = true;

  function sessionId(ctx: ExtensionContext): string {
    return ctx.sessionManager.getSessionId();
  }
  // 扩展加载前已回退的会话只在 provider 统计里有记录，从那里接管，下一次请求即重试
  async function adopt(id: string): Promise<FallbackState | undefined> {
    codex ??= await findCodexModule(id);
    const stats = codex?.getOpenAICodexWebSocketDebugStats(id) as { websocketFallbackActive?: boolean; lastWebSocketError?: string } | undefined;
    if (!stats?.websocketFallbackActive) return;
    const state: FallbackState = {
      reason: "transport", failures: 1, retryAt: 0, lastError: stats.lastWebSocketError ?? "WebSocket 请求失败", probing: false,
    };
    states.set(id, state);
    return state;
  }
  function showStatus(ctx: ExtensionContext): void {
    if (isMagpieHttp(ctx)) {
      const icon = ctx.ui.theme.fg("success", "⇄");
      const label = ctx.ui.theme.fg("accent", "SSE · Magpie");
      ctx.ui.setStatus(STATUS_KEY, `${icon} ${label}`);
      return;
    }
    if (ctx.model?.api !== CODEX_API || pi.getSettings().transport === "sse") {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const state = states.get(sessionId(ctx));
    const icon = ctx.ui.theme.fg(state ? "warning" : "success", "⇄");
    const label = ctx.ui.theme.fg("accent", !state ? "WS" : state.probing ? "WS 重连中" : "WS→SSE");
    ctx.ui.setStatus(STATUS_KEY, `${icon} ${label}`);
  }

  pi.registerCommand("ws", {
    description: "查看 OpenAI Codex WebSocket 回退状态，或让下一次请求立即重试 WebSocket",
    getArgumentCompletions: (prefix) => {
      const choices = ARGUMENTS.filter((value) => value.startsWith(prefix));
      return choices.length ? choices.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();
      if (!["", ...ARGUMENTS].includes(argument)) {
        ctx.ui.notify("用法：/ws [status|retry]", "error");
        return;
      }
      if (isMagpieHttp(ctx)) {
        showStatus(ctx);
        ctx.ui.notify("Pi → Magpie：HTTP/SSE\nMagpie → 上游：连接与重试由 Magpie 管理，当前插件无法读取上游传输状态。", "info");
        return;
      }
      const state = states.get(sessionId(ctx)) ?? await adopt(sessionId(ctx));
      if (argument === "retry") {
        if (!state) {
          ctx.ui.notify("WebSocket 未回退，无需重试", "info");
          return;
        }
        Object.assign(state, { retryAt: 0, failedBytes: undefined, probing: false });
        recoverable = true;
        showStatus(ctx);
        ctx.ui.notify("下一次请求将重试 WebSocket", "info");
        return;
      }
      ctx.ui.notify(describe(state, Date.now(), recoverable), "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.model?.api === CODEX_API && !states.has(sessionId(ctx))) await adopt(sessionId(ctx));
    showStatus(ctx);
  });
  pi.on("model_select", (_event, ctx) => { showStatus(ctx); });
  // before_provider_request 早于 Codex provider 读取回退标记，此处清除即让本次请求走 WebSocket
  pi.on("before_provider_request", async (event, ctx) => {
    if (ctx.model?.api !== CODEX_API) return;
    const id = sessionId(ctx);
    const state = states.get(id) ?? await adopt(id);
    if (!state || !recoverable || !canProbe(state, Date.now(), () => Buffer.byteLength(JSON.stringify(event.payload)))) return;
    codex ??= await findCodexModule(id);
    if (!codex) {
      recoverable = false;
      return;
    }
    codex.resetOpenAICodexWebSocketDebugStats(id);
    state.probing = true;
    showStatus(ctx);
  });
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant" || message.api !== CODEX_API) return;
    const id = sessionId(ctx);
    const state = states.get(id);
    const failure = transportFailure(message);
    if (failure) states.set(id, recordFailure(state, failure, Date.now()));
    else if (state?.probing && message.stopReason !== "aborted") states.delete(id);
    showStatus(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => { ctx.ui.setStatus(STATUS_KEY, undefined); });
}
