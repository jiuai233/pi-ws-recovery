import assert from "node:assert/strict";
import test from "node:test";
import { canProbe, cooldown, describe, recordFailure, transportFailure } from "../src/recovery.ts";

const closed = (code: number, requestBytes = 1000) => ({
  diagnostics: [{
    type: "provider_transport_failure",
    error: { name: "WebSocketCloseError", message: `WebSocket closed ${code}`, code },
    details: { configuredTransport: "auto", phase: "after_message_stream_start", requestBytes },
  }],
});

test("cooldown doubles from 30 seconds and caps at 5 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(cooldown), [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
});

test("transport failures are read from assistant diagnostics", () => {
  assert.deepEqual(transportFailure(closed(1000, 4096)), { code: 1000, message: "WebSocket closed 1000", requestBytes: 4096 });
  assert.equal(transportFailure({ diagnostics: [{ type: "other" }] }), undefined);
  assert.equal(transportFailure({}), undefined);
  assert.deepEqual(transportFailure({ diagnostics: [{ type: "provider_transport_failure", error: {} }] }),
    { code: undefined, message: "WebSocket 请求失败", requestBytes: undefined });
});

test("consecutive failures of one reason back off and a new reason starts over", () => {
  let state = recordFailure(undefined, transportFailure(closed(1000))!, 0);
  assert.equal(state.retryAt, 30_000);
  state = recordFailure(state, transportFailure(closed(1006))!, 100_000);
  assert.equal(state.failures, 2);
  assert.equal(state.retryAt, 160_000);
  assert.equal(canProbe(state, 159_999, () => 0), false);
  assert.equal(canProbe(state, 160_000, () => 0), true);
  state.probing = true;
  assert.equal(canProbe(state, 200_000, () => 0), false);
  state = recordFailure(state, transportFailure(closed(1009, 1000))!, 200_000);
  assert.equal(state.reason, "message_too_big");
  assert.equal(state.failures, 1);
  assert.equal(state.failedBytes, 1000);
});

test("an oversized request is retried only after shrinking by 20 percent", () => {
  const state = recordFailure(undefined, transportFailure(closed(1009, 1000))!, 0);
  assert.equal(canProbe(state, 10_000_000, () => 801), false);
  assert.equal(canProbe(state, 0, () => 800), true);
  assert.equal(canProbe({ ...state, failedBytes: undefined }, 0, () => 10_000), true);
});

test("status text explains the next WebSocket attempt", () => {
  assert.equal(describe(undefined, 0, true), "WebSocket 正常");
  const transport = recordFailure(undefined, transportFailure(closed(1000))!, 0);
  assert.match(describe(transport, 0, true), /连续失败 1 次 · 最近错误：WebSocket closed 1000\n30 秒后重试 WebSocket/);
  assert.match(describe(transport, 30_000, true), /下一次请求重试 WebSocket/);
  assert.match(describe({ ...transport, probing: true }, 0, true), /正在重试 WebSocket/);
  assert.match(describe(transport, 0, false), /本进程保持 SSE/);
  const oversize = recordFailure(undefined, transportFailure(closed(1009, 5 * 1024 * 1024))!, 0);
  assert.match(describe(oversize, 0, true), /请求体缩小到 4\.0 MB 以下后重试 WebSocket/);
});
