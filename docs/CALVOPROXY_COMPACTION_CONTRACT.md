# Pi and CalvoProxy compaction coordination contract

Status: version 1 client contract. This document is owned by the Pi integration. It does not require or authorize transcript storage, and it does not move conversation-compaction policy into CalvoProxy.

## Ownership boundary

Pi owns the conversation and therefore owns all semantic compaction decisions:

1. decide when proactive compaction is needed;
2. preprocess the prepared history locally with the pinned `cervo-compress` pipeline;
3. request a structured continuation summary;
4. validate objective, constraints, progress, blockers, files, immediate next action, split-turn context, and size;
5. return `undefined` so Pi core performs native compaction if preprocessing, generation, or validation is unavailable or untrustworthy.

CalvoProxy remains a stateless model-routing and transport boundary. It may route, retry, rate-limit, or enforce its independent tool-result transport guard. It does not decide what conversation context Pi may discard. This integration adds no transcript, prompt, summary, tool-output, path, user, channel, or account persistence to CalvoProxy.

## Request headers

When the active summary provider identifies itself as CalvoProxy, Pi sends two content-free headers on extension-managed summary requests. Custom providers whose name or URL does not contain `calvoproxy` opt in with `PI_CALVOPROXY_COORDINATION=1`; the extension does not send a stable conversation identifier to unrelated providers.

### `X-Calvoproxy-Session-Id`

Value: a client-generated 128-bit opaque identifier, encoded by this extension as 32 hexadecimal characters.

- Stable for one Pi conversation only.
- Rotated on `session_start` and never reused as user, channel, tenant, device, or account identity.
- Never written to lifecycle diagnostics or configuration by this extension.
- A proxy implementation may use only a process-local HMAC for affinity. It must not persist the raw value.

### `X-Calvoproxy-Compaction`

Canonical version-1 form:

```text
v1;g=<uint>;cause=<threshold|growth|tools|emergency|manual>;result=<structured|native>;tool=<cervo|none>
```

Fields are categorical and advisory:

| Field | Meaning |
| --- | --- |
| `g` | Monotonic compaction generation within the Pi conversation. |
| `cause` | Closed trigger category; never a free-text reason. |
| `result` | `structured` for this extension's validated-summary path; `native` is reserved for a Pi-core caller that can attach the header. |
| `tool` | `cervo` only after successful local `cervo-compress` preprocessing; otherwise `none`. |

Version 1 is add-only. Readers ignore unknown fields. Absence of either header is valid and must not change request correctness. The header must never contain token counts, byte counts, prompts, summaries, file paths, tool output, credentials, or identifiers other than the opaque conversation id in its dedicated header.

## Response metadata

Pi may consume these existing CalvoProxy response signals when its provider transport exposes them:

- integer `Retry-After` on HTTP 429 or 503;
- `X-Calvoproxy-Route`, including categorical quota field `q=`;
- `X-Calvoproxy-Model`;
- `X-Calvoproxy-Profile`;
- `X-Calvoproxy-Attempt`;
- `X-Calvoproxy-Decision-Id` as an ephemeral diagnostic correlation value only.

All are optional. Missing or malformed metadata is ignored. Summary acceptance still depends exclusively on Pi's local validation contract, never on proxy metadata. This extension does not persist response headers.

`cmp=` inside `X-Calvoproxy-Route` describes CalvoProxy transport clipping only. It never means that Pi conversation compaction ran, succeeded, or was accepted.

## Failure behavior

- Missing bridge, bridge timeout/non-zero exit, malformed output, dishonest byte accounting, or conversation-shape mutation: do not call the summary model; return control to Pi core.
- Provider error, abort, or timeout: return control to Pi core.
- Missing required summary state, invalid size, missing file tags, or invalid split-turn context: retry only under the existing bounded policy, then return control to Pi core.
- Header absence or response-metadata absence: continue normally; coordination is advisory.

Fallback never sends transcript material to a separate coordination service and never asks CalvoProxy to persist it.

## Implementation references

- `src/compaction/cervo-preprocessor.ts` — bridge execution and output validation.
- `bridge/cervo-compress/` — pinned Go bridge over `github.com/cervantesh/cervo-compress`.
- `src/compaction/calvoproxy-coordination.ts` — closed header renderer.
- `src/compaction/orchestration.ts` — preprocessing and Pi-core fallback boundary.
- `src/compaction/compaction-workflow.ts` — final summary verification and commit.
