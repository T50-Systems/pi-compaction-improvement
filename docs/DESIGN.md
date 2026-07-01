# Design and roadmap

## Goal

Improve pi autocompact without replacing pi core compaction, and make it work as an installable package in the current environment.

## Architecture

### 1. Trigger policy

Hook: `turn_end`

Inputs:
- `ctx.getContextUsage()`
- previous token count
- recent growth streak
- tool-result volume
- cooldown / in-flight state
- configured reserve and buffers

Outputs:
- no-op
- proactive `ctx.compact(...)` with reason-specific instructions

### 2. Summary policy

Hook: `session_before_compact`

Inputs:
- pi's prepared compaction slice
- `previousSummary`
- split-turn prefix messages
- custom instructions from manual or proactive triggers

Outputs:
- improved structured summary
- merged file tags
- fallback to pi core on failure

### 3. Control plane

- global config file
- optional project override
- slash commands for status, enable/disable, immediate compaction, and config editing
- status line + status widget for observability

## Implemented roadmap

### Phase 0 — Baseline / observability
- status snapshot and report helpers
- runtime footer status
- `/autocompact-status`

### Phase 1 — Minimum proactive trigger
- soft threshold
- rapid growth
- cooldown

### Phase 2 — Adaptive policy
- sustained growth
- emergency band
- reason-coded custom instructions
- standard vs aggressive summarization directives

### Phase 3 — User configuration
- `~/.pi/agent/pi-autocompact-v2.json`
- `.pi/pi-autocompact-v2.json`
- config editing/reset/path commands

### Phase 4 — Tool-heavy awareness
- tool-result token estimation
- tool-heavy trigger path

### Phase 5 — Validation
- unit tests for policy, config, prompt, file tags, tool-result estimation
- package dry-run

### Phase 6 — Release + install
- git tag/release
- global `pi install` update

## Deliberately not done here

- patching pi core
- changing pi's cut-point algorithm
- upstreaming to pi core without source repo access
