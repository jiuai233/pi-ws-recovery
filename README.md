# pi-ws-recovery

**Shows when Pi's OpenAI Codex models fall back from WebSocket to SSE, and brings WebSocket back automatically.**

[Install](#install) · [Commands](#commands) · [中文](README.zh-CN.md)

After a WebSocket failure, Pi's Codex provider switches to SSE and stays on SSE for the rest of the process. This extension:

- **Makes the transport visible**: Codex models show `⇄ WS` in the status bar; during fallback it turns to the warning color as `⇄ WS→SSE`, and `⇄ WS 重连中` while retrying WebSocket. Hidden when transport is set to `sse`.
- **Recovers WebSocket**: after a cooldown the next request retries WebSocket, backing off 30, 60, 120, 240 and 300 seconds; a successful retry ends the fallback.
- **Takes over sessions already on SSE**: on load or `/reload`, sessions the provider already holds in SSE fallback retry WebSocket on their next request.
- **Handles oversized requests**: after `1009 message too big`, WebSocket is retried only once the request body is at least 20% smaller than the one that failed.

It acts only on `openai-codex-responses` models, never rewrites requests, and does not modify Pi's installed files.

## Install

Requires Node.js 24+ and Pi 1.1.0+.

```bash
pi install git:github.com/jiuai233/pi-ws-recovery
```

Run `/reload` in Pi.

## Commands

| Command | Action |
| --- | --- |
| `/ws`, `/ws status` | Show the current session's fallback reason, consecutive failures, last error and next retry |
| `/ws retry` | Skip the cooldown so the next request retries WebSocket |

## Behavior

- When the stream drops mid-response, that request still ends with an error and Pi's automatic retry completes it over SSE; the extension handles the indicator and later recovery.
- Fallback state is kept in memory per session; a restarted Pi starts on WebSocket. Run `/reload` in an already running Pi after installing.
- Recovery relies on debug exports of Pi's Codex provider module. If the module cannot be found, only the indicator is shown and `/ws` reports that this process stays on SSE.
