# Changelog

## [Unreleased]

### Added

- product vision, contributor workflow, examples, troubleshooting, and performance baseline documentation;
- coverage and policy benchmark scripts;
- CI and tag-driven release verification with dependency auditing.
- offline, vendored-schema validation for GitHub Actions and Dependabot configuration, including file-and-line diagnostics and negative fixtures.
- repeated hosted-runner benchmark evidence with schema-validated numeric artifacts, privacy-safe logs, and a separate evidence-derived regression budget.
- disabled-default, local-only lifecycle diagnostic persistence with a privacy-reviewed closed schema, bounded retention, durable clear, corruption/version handling, and compaction-safe failure isolation.

## v0.1.7

- Adds pre-prompt autocompaction to compact before accepting prompts that would exceed the threshold, then replays the prompt
- Bounds oversized summary prompts against the model context window before provider calls
- Exposes formal compaction lifecycle/invariant metadata for verification and telemetry
- Extends deferred post-agent autocompaction to wait through long continuations before compacting
- Condenses verbose todo snapshots, completed checklist runs, and count/path command-output listings before summary generation to avoid rehydrating noisy context

## v0.1.6

- Moves proactive autocompact from `turn_end` to `agent_end` so it does not interrupt an active agent/tool loop
- Keeps compaction as post-run maintenance instead of mid-work interruption

## v0.1.5

- Adds a `Continuation Contract` to compaction summaries so resumed agents know whether to continue automatically or ask the user
- Strengthens autocompact trigger instructions to preserve executable next actions across compaction

## v0.1.4

- Adds proactive autocompact triggering on `turn_end`
- Triggers earlier on soft threshold, rapid growth, sustained growth, tool-heavy turns, and emergency near-limit conditions
- Adds cooldown and in-flight protections to avoid compaction spam
- Adds global and project config files plus slash commands for status, enable/disable, immediate compaction, and config editing
- Keeps the improved summary template with `Discarded Hypotheses`, `Risks`, and `Immediate Next Action`
- Preserves and merges file tracking tags across extension-managed compactions

## v0.1.0

- Initial release of the autocompact v2 extension package for pi
- Adds `Discarded Hypotheses`, `Risks`, and `Immediate Next Action` to compaction summaries
- Preserves and merges file tracking tags across extension-managed compactions
- Uses focused vs aggressive summary guidance based on compaction context
