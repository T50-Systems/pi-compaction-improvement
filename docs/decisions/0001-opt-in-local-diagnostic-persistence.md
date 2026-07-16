# ADR 0001: Opt-in local lifecycle diagnostic persistence

## Status

Accepted

## Date

2026-07-15

## Context

Compaction lifecycle diagnostics currently retain at most 20 categorical records in memory. Operators may need those records after restarting Pi, but persistence creates a privacy boundary: compaction handles prompts, transcripts, summaries, credentials, headers, and file content that must never enter this diagnostic store. Persistence is non-critical and must not alter compaction or fallback behavior.

## Decision

- Persistence is disabled by default and enabled only with the `persistLifecycleDiagnostics` boolean configuration option.
- The store is local-only and machine-scoped at `~/.pi/agent/pi-autocompact-v2-diagnostics.json`. It is never synchronized, transmitted, or written into a project checkout.
- The only accepted on-disk shape is a versioned, closed envelope: `{ "version": 1, "entries": [...] }`. Envelope and entry keys use exact allowlists; unknown keys reject the complete payload.
- Entries may contain only `timestamp`, `triggerReason`, `terminalState`, `durationMs`, `retryCount`, `violatedInvariants`, and optional `fallbackCategory`. Every value must belong to the existing closed diagnostic categories or bounded numeric/string formats.
- Transcript, prompt, summary, credential, authorization, header, path, project name, error message, and arbitrary free-text fields are forbidden. No extension point for extra metadata is provided.
- Retention remains the newest 20 entries. Loading and writing both enforce the bound.
- There are no earlier persisted schema versions. The version dispatcher is explicit so a future known migration can be added deliberately. Unknown older versions, future versions, malformed JSON, and schema-invalid/corrupt payloads are ignored as empty and never partially recovered.
- Session-start hydration replaces in-memory history rather than appending, so repeated starts cannot duplicate records.
- Writes are best-effort and atomic where supported: serialize to a same-directory temporary file, rename over the destination, and attempt temporary-file cleanup after failure. No retry loop is used.
- Durable clear empties memory and best-effort deletes both the destination and a known temporary file. A missing file is success.
- Status output discloses whether persistence is enabled, its local-only path, the 20-entry retention limit, and that categorical-only data is stored.
- Read, write, rename, and delete failures are contained. They must never throw into or change compaction lifecycle, result validation, retry, or fallback paths.
- Flush occurs after a compaction lifecycle handler reaches completion and after clear. Shutdown is not the primary durability boundary.

## Alternatives Considered

1. **Always-on persistence:** rejected because diagnostics should not silently become durable.
2. **Project-local storage:** rejected because it risks accidental source-control inclusion and would require persisting project identity or selecting per-project paths.
3. **General telemetry/log records:** rejected because open-ended metadata could admit sensitive free text.
4. **Database or OS credential store:** rejected as unnecessary operational complexity for bounded non-sensitive categories.
5. **Fail compaction when persistence fails:** rejected because diagnostics are observational and compaction safety/fallback is authoritative.

## Consequences

### Positive

- Operators can opt into bounded cross-restart diagnostic continuity.
- Exact schema validation makes forbidden data structurally unrepresentable on accepted reads and writes.
- Atomic replacement reduces partial-file exposure.
- Compaction behavior degrades safely when local storage is unavailable.

### Negative

- Diagnostics are shared across local projects because project identity is intentionally not stored.
- Corrupt or unknown-version files are discarded rather than partially salvaged.
- Best-effort writes may lose recent diagnostics without affecting compaction.
- Atomic rename semantics ultimately depend on the local filesystem.

## Migration and Evolution

Any future schema version requires a new ADR/privacy review, a closed schema, an explicit migration from each supported version, bounded output, and tests proving forbidden fields remain impossible. Future readers must reject versions they do not understand. This ADR must be superseded rather than silently broadening the envelope.

## Reversal Signals

Reconsider this decision if diagnostics need project attribution, centralized collection, user-authored annotations, compliance retention, encryption-at-rest guarantees, or multi-process coordination. Those requirements need a separate threat model and ADR rather than expansion of this file format.
