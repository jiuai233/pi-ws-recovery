import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeCodex {
  stats: Map<string, unknown>;
  resets: string[];
}

declare global {
  var __piWsRecoveryFake: Record<string, FakeCodex> | undefined;
}

function moduleSource(name: string): string {
  return `const fake = (globalThis.__piWsRecoveryFake ??= {})[${JSON.stringify(name)}] ??= { stats: new Map(), resets: [] };
export function getOpenAICodexWebSocketDebugStats(id) { return fake.stats.get(id); }
export function resetOpenAICodexWebSocketDebugStats(id) { fake.resets.push(id); fake.stats.delete(id); }
`;
}

// 模拟全局安装布局：.../@earendil-works/pi-coding-agent 带打包 chunk，pi-ai 提升为同级目录
export function fakePiInstall(): { root: string; packageDir: string; fake(name: "bundle" | "hoisted"): FakeCodex } {
  const root = mkdtempSync(join(tmpdir(), "pi-ws-recovery-"));
  const scope = join(root, "@earendil-works");
  const packageDir = join(scope, "pi-coding-agent");
  const chunks = join(packageDir, "dist", "bundle", "chunks");
  const modular = join(scope, "pi-ai", "dist", "api");
  mkdirSync(chunks, { recursive: true });
  mkdirSync(modular, { recursive: true });
  writeFileSync(join(chunks, `openai-codex-responses-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}.js`), moduleSource(`${root}:bundle`));
  writeFileSync(join(chunks, "chunk-OTHER.js"), "export {};\n");
  writeFileSync(join(modular, "openai-codex-responses.js"), moduleSource(`${root}:hoisted`));
  const fake = (name: "bundle" | "hoisted") => {
    const all = globalThis.__piWsRecoveryFake ??= {};
    return all[`${root}:${name}`] ??= { stats: new Map(), resets: [] };
  };
  return { root, packageDir, fake };
}
