import assert from "node:assert/strict";
import { realpathSync, rmSync } from "node:fs";
import { basename } from "node:path";
import test from "node:test";
import { candidateFiles, findCodexModule } from "../src/codex-module.ts";
import { fakePiInstall } from "./fixture.ts";

test("candidates cover the bundled chunk and an installed pi-ai copy", () => {
  const { root, packageDir } = fakePiInstall();
  try {
    const files = candidateFiles(packageDir);
    assert.equal(files.length, 2);
    assert.match(basename(files[0]!), /^openai-codex-responses-.+\.js$/);
    assert.equal(files[1], realpathSync(`${root}/@earendil-works/pi-ai/dist/api/openai-codex-responses.js`));
    assert.deepEqual(candidateFiles(`${root}/missing/pi-coding-agent`), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("the module holding the session's WebSocket stats is selected", async () => {
  const { root, packageDir, fake } = fakePiInstall();
  try {
    assert.equal(await findCodexModule("s1", packageDir), undefined);
    fake("hoisted").stats.set("s1", { requests: 1 });
    const module = await findCodexModule("s1", packageDir);
    module!.resetOpenAICodexWebSocketDebugStats("s1");
    assert.deepEqual(fake("hoisted").resets, ["s1"]);
    assert.deepEqual(fake("bundle").resets, []);
  } finally {
    rmSync(root, { recursive: true });
  }
});
