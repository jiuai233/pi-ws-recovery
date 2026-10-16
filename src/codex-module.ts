import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface CodexModule {
  getOpenAICodexWebSocketDebugStats(sessionId: string): unknown;
  resetOpenAICodexWebSocketDebugStats(sessionId?: string): void;
}

const CHUNK = /^openai-codex-responses-[\w-]+\.js$/;
const MODULAR = join("pi-ai", "dist", "api", "openai-codex-responses.js");

// CLI 加载打包后的 chunk，SDK 加载 pi-ai 模块；两份代码各自持有回退状态
export function candidateFiles(packageDir: string): string[] {
  const chunks = join(packageDir, "dist", "bundle", "chunks");
  const files = existsSync(chunks) ? readdirSync(chunks).filter((name) => CHUNK.test(name)).map((name) => join(chunks, name)) : [];
  files.push(join(packageDir, "node_modules", "@earendil-works", MODULAR), join(dirname(packageDir), MODULAR));
  return [...new Set(files.filter((file) => existsSync(file)).map((file) => realpathSync(file)))];
}

function isCodexModule(value: unknown): value is CodexModule {
  const module = value as Partial<CodexModule> | null;
  return typeof module?.getOpenAICodexWebSocketDebugStats === "function" &&
    typeof module.resetOpenAICodexWebSocketDebugStats === "function";
}

// 同一路径的 import 复用 Pi 已加载的模块实例；持有该会话统计的实例即为当前进程实际使用的那份
export async function findCodexModule(sessionId: string, packageDir = getPackageDir()): Promise<CodexModule | undefined> {
  for (const file of candidateFiles(packageDir)) {
    try {
      const module: unknown = await import(pathToFileURL(file).href);
      if (isCodexModule(module) && module.getOpenAICodexWebSocketDebugStats(sessionId) !== undefined) return module;
    } catch {
      continue;
    }
  }
}
