export const INITIAL_COOLDOWN_MS = 30_000;
export const MAX_COOLDOWN_MS = 300_000;
export const OVERSIZE_RATIO = 0.8;
export const MESSAGE_TOO_BIG = 1009;

export type FallbackReason = "transport" | "message_too_big";

export interface Failure {
  code?: number;
  message: string;
  requestBytes?: number;
}

export interface FallbackState {
  reason: FallbackReason;
  failures: number;
  retryAt: number;
  failedBytes?: number;
  lastError: string;
  probing: boolean;
}

export function cooldown(failures: number): number {
  return Math.min(INITIAL_COOLDOWN_MS * 2 ** (failures - 1), MAX_COOLDOWN_MS);
}

// Pi 在 WebSocket 失败时给助手消息追加 provider_transport_failure 诊断
export function transportFailure(message: { diagnostics?: unknown }): Failure | undefined {
  const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
  const diagnostic = diagnostics.findLast((item) => item?.type === "provider_transport_failure");
  if (!diagnostic) return;
  const { code, message: text } = diagnostic.error ?? {};
  const requestBytes = diagnostic.details?.requestBytes;
  return {
    code: typeof code === "number" ? code : undefined,
    message: typeof text === "string" && text ? text : "WebSocket 请求失败",
    requestBytes: typeof requestBytes === "number" ? requestBytes : undefined,
  };
}

export function recordFailure(previous: FallbackState | undefined, failure: Failure, now: number): FallbackState {
  const reason: FallbackReason = failure.code === MESSAGE_TOO_BIG ? "message_too_big" : "transport";
  const failures = previous?.reason === reason ? previous.failures + 1 : 1;
  return {
    reason,
    failures,
    retryAt: reason === "transport" ? now + cooldown(failures) : 0,
    failedBytes: reason === "message_too_big" ? failure.requestBytes : undefined,
    lastError: failure.message,
    probing: false,
  };
}

export function oversizeLimit(state: FallbackState): number | undefined {
  return state.failedBytes === undefined ? undefined : Math.floor(state.failedBytes * OVERSIZE_RATIO);
}

export function canProbe(state: FallbackState, now: number, requestBytes: () => number): boolean {
  if (state.probing) return false;
  if (state.reason === "transport") return now >= state.retryAt;
  const limit = oversizeLimit(state);
  return limit === undefined || requestBytes() <= limit;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function describe(state: FallbackState | undefined, now: number, recoverable: boolean): string {
  if (!state) return "WebSocket 正常";
  const lines = [`已回退 SSE · 连续失败 ${state.failures} 次 · 最近错误：${state.lastError}`];
  if (!recoverable) lines.push("未找到 Pi 的 Codex WebSocket 模块，本进程保持 SSE");
  else if (state.probing) lines.push("正在重试 WebSocket");
  else if (state.reason === "message_too_big") {
    const limit = oversizeLimit(state);
    lines.push(limit === undefined ? "下一次请求重试 WebSocket" : `请求体缩小到 ${formatBytes(limit)} 以下后重试 WebSocket`);
  } else if (now >= state.retryAt) lines.push("下一次请求重试 WebSocket");
  else lines.push(`${Math.ceil((state.retryAt - now) / 1000)} 秒后重试 WebSocket`);
  return lines.join("\n");
}
