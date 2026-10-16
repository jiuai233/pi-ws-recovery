import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import wsRecovery from "../src/index.ts";
import { fakePiInstall } from "./fixture.ts";

const codexModel = { provider: "openai-codex", id: "gpt-6.1-sol", api: "openai-codex-responses" };
const assistant = { role: "assistant", provider: codexModel.provider, model: codexModel.id, api: codexModel.api };
const failure = (code: number, requestBytes = 1000) => ({
  ...assistant,
  stopReason: "error",
  diagnostics: [{ type: "provider_transport_failure", error: { message: `WebSocket closed ${code}`, code }, details: { requestBytes } }],
});
const healthy = "<success>⇄</success> <accent>WS</accent>";
const fallback = "<warning>⇄</warning> <accent>WS→SSE</accent>";
const probing = "<warning>⇄</warning> <accent>WS 重连中</accent>";

function harness(model: object = codexModel, transport = "auto") {
  const hooks = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
  let handler: (args: string, ctx: ExtensionContext) => Promise<void>;
  let status: string | undefined;
  const messages: string[] = [];
  const ctx = {
    model,
    sessionManager: { getSessionId: () => "s1" },
    ui: {
      theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
      setStatus(_key: string, value: string | undefined) { status = value; },
      notify(message: string) { messages.push(message); },
    },
  } as unknown as ExtensionContext;
  const pi = {
    getSettings: () => ({ transport }),
    on(name: string, callback: (event: any, context: ExtensionContext) => unknown) { hooks.set(name, callback); },
    registerCommand(name: string, command: { handler: typeof handler }) {
      assert.equal(name, "ws"); handler = command.handler;
    },
  } as unknown as ExtensionAPI;
  wsRecovery(pi);
  return {
    ctx,
    status: () => status,
    lastMessage: () => messages.at(-1),
    command: (args: string) => handler(args, ctx),
    emit: (name: string, event: object, context = ctx) => hooks.get(name)!(event, context),
  };
}

function withFakePi(run: (install: ReturnType<typeof fakePiInstall>, t: test.TestContext) => Promise<void>) {
  return async (t: test.TestContext) => {
    const old = process.env.PI_PACKAGE_DIR;
    const install = fakePiInstall();
    process.env.PI_PACKAGE_DIR = install.packageDir;
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    try {
      await run(install, t);
    } finally {
      if (old === undefined) delete process.env.PI_PACKAGE_DIR; else process.env.PI_PACKAGE_DIR = old;
      rmSync(install.root, { recursive: true });
    }
  };
}

test("a WebSocket failure shows the indicator and WebSocket is retried after the cooldown", withFakePi(async ({ fake }, t) => {
  const pi = harness();
  const bundle = fake("bundle");
  await pi.emit("session_start", {});
  assert.equal(pi.status(), healthy);
  await pi.command("");
  assert.equal(pi.lastMessage(), "WebSocket 正常");

  bundle.stats.set("s1", { websocketFallbackActive: true });
  pi.emit("message_end", { message: failure(1000) });
  assert.equal(pi.status(), fallback);
  await pi.command("status");
  assert.match(pi.lastMessage()!, /30 秒后重试 WebSocket/);

  await pi.emit("before_provider_request", { payload: {} });
  assert.deepEqual(bundle.resets, []);
  pi.emit("message_end", { message: { ...assistant, stopReason: "stop" } });
  assert.equal(pi.status(), fallback);

  t.mock.timers.tick(30_000);
  await pi.emit("before_provider_request", { payload: {} });
  assert.deepEqual(bundle.resets, ["s1"]);
  assert.equal(pi.status(), probing);
  await pi.emit("before_provider_request", { payload: {} });
  assert.deepEqual(bundle.resets, ["s1"]);

  pi.emit("message_end", { message: failure(1006) });
  assert.equal(pi.status(), fallback);
  await pi.command("");
  assert.match(pi.lastMessage()!, /连续失败 2 次 · 最近错误：WebSocket closed 1006\n60 秒后重试 WebSocket/);

  t.mock.timers.tick(60_000);
  await pi.emit("before_provider_request", { payload: {} });
  pi.emit("message_end", { message: { ...assistant, stopReason: "aborted" } });
  assert.equal(pi.status(), probing);
  pi.emit("message_end", { message: { ...assistant, stopReason: "toolUse" } });
  assert.equal(pi.status(), healthy);
  assert.deepEqual(bundle.resets, ["s1", "s1"]);

  pi.emit("message_end", { message: failure(1000) });
  assert.equal(pi.status(), fallback);
  pi.emit("session_shutdown", {});
  assert.equal(pi.status(), undefined);
}));

test("a session already on SSE before the extension loaded is pulled back to WebSocket", withFakePi(async ({ fake }) => {
  const pi = harness();
  const bundle = fake("bundle");
  bundle.stats.set("s1", { websocketFallbackActive: true, lastWebSocketError: "WebSocket closed 1000" });
  await pi.emit("session_start", {});
  assert.equal(pi.status(), fallback);
  await pi.command("");
  assert.match(pi.lastMessage()!, /最近错误：WebSocket closed 1000\n下一次请求重试 WebSocket/);
  await pi.emit("before_provider_request", { payload: {} });
  assert.deepEqual(bundle.resets, ["s1"]);
  assert.equal(pi.status(), probing);
  pi.emit("message_end", { message: { ...assistant, stopReason: "stop" } });
  assert.equal(pi.status(), healthy);
}));

test("a healthy WebSocket session is left alone", withFakePi(async ({ fake }) => {
  const pi = harness();
  const bundle = fake("bundle");
  bundle.stats.set("s1", { websocketFallbackActive: false });
  await pi.emit("session_start", {});
  await pi.emit("before_provider_request", { payload: {} });
  assert.equal(pi.status(), healthy);
  assert.deepEqual(bundle.resets, []);
}));

test("an oversized request waits until the payload shrinks", withFakePi(async ({ fake }, t) => {
  const pi = harness();
  const bundle = fake("bundle");
  bundle.stats.set("s1", {});
  pi.emit("message_end", { message: failure(1009, 100) });
  await pi.command("");
  assert.match(pi.lastMessage()!, /请求体缩小到 1 KB 以下后重试 WebSocket/);
  t.mock.timers.tick(3_600_000);
  await pi.emit("before_provider_request", { payload: { input: "x".repeat(200) } });
  assert.deepEqual(bundle.resets, []);
  await pi.emit("before_provider_request", { payload: { input: "x".repeat(40) } });
  assert.deepEqual(bundle.resets, ["s1"]);
}));

test("/ws retry lets the next request try WebSocket at once", withFakePi(async ({ fake }, t) => {
  const pi = harness();
  const bundle = fake("bundle");
  await pi.command("retry");
  assert.equal(pi.lastMessage(), "WebSocket 未回退，无需重试");
  bundle.stats.set("s1", {});
  pi.emit("message_end", { message: failure(1000) });
  await pi.command("retry");
  assert.equal(pi.lastMessage(), "下一次请求将重试 WebSocket");
  await pi.emit("before_provider_request", { payload: {} });
  assert.deepEqual(bundle.resets, ["s1"]);
  await pi.command("unknown");
  assert.equal(pi.lastMessage(), "用法：/ws [status|retry]");
}));

test("without Pi's Codex module the indicator stays and no retry is attempted", withFakePi(async (_install, t) => {
  const pi = harness();
  pi.emit("message_end", { message: failure(1000) });
  t.mock.timers.tick(30_000);
  await pi.emit("before_provider_request", { payload: {} });
  assert.equal(pi.status(), fallback);
  await pi.command("");
  assert.match(pi.lastMessage()!, /本进程保持 SSE/);
}));

test("other providers and models are ignored", withFakePi(async ({ fake }, t) => {
  const other = harness({ provider: "anthropic", id: "claude", api: "anthropic-messages" });
  other.emit("message_end", { message: { ...failure(1000), api: "anthropic-messages" } });
  assert.equal(other.status(), undefined);

  const pi = harness();
  fake("bundle").stats.set("s1", {});
  pi.emit("message_end", { message: failure(1000) });
  assert.equal(pi.status(), fallback);
  pi.emit("model_select", {}, { ...pi.ctx, model: { provider: "anthropic", id: "claude", api: "anthropic-messages" } } as ExtensionContext);
  assert.equal(pi.status(), undefined);
  pi.emit("model_select", {});
  assert.equal(pi.status(), fallback);
}));

test("the badge is hidden when transport is forced to SSE", withFakePi(async () => {
  const pi = harness(codexModel, "sse");
  await pi.emit("session_start", {});
  assert.equal(pi.status(), undefined);
}));
