# Security Policy

Security issues must be reported privately. Never put transcripts, prompts, generated summaries, API keys, provider tokens, request headers, credentials, private file contents, customer data, personal information, or exploit details in a public issue.

## Supported versions

Security fixes target the default branch and the latest published release. Older releases may receive a fix when severity, exploitability, and upgrade feasibility justify backporting. The release notes will identify any broader supported range.

## Private reporting

Use [T50 Systems organization private vulnerability reporting](https://github.com/T50-Systems/.github/security/advisories/new) and name `T50-Systems/pi-compaction-improvement` as the affected repository. If repository-local private reporting is available, the repository **Security** tab's **Report a vulnerability** action is also acceptable. Do not create a public placeholder issue when private reporting is unavailable locally.

Include the affected release or commit, impact, minimal reproduction, and a proposed mitigation when safe. Redact all transcript-derived content and credentials. The organization policy defines acknowledgement, triage, update, and coordinated-disclosure targets.

## Trust boundaries

### Transcript-derived prompts and model providers

The extension builds compaction prompts from Pi's prepared conversation slice, prior summary, custom compaction instructions, and file-operation paths. That content is sent to the model provider configured and authenticated by Pi. Provider selection, transport, retention, and processing are therefore part of the configured provider's trust boundary. Users must not assume compaction is local unless their selected provider is local.

The extension's notifications and lifecycle diagnostics never intentionally log prompt text, generated summary text, transcript content, file contents, API keys, authentication headers, or provider tokens. Diagnostics retain only timestamp, trigger category, terminal state, duration, retry count, invariant identifiers, and fallback category in session memory.

### Provider credentials

Credentials and headers are resolved through Pi's model registry and passed directly to the provider adapter for the active request. They are not written to project/global autocompact configuration, status output, lifecycle diagnostics, benchmark fixtures, or package logs. Provider/auth failures are reported by classified category without credential values.

### Configuration writes

`/autocompact-config` writes either the user's Pi agent configuration path or the trusted project's `.pi/pi-autocompact-v2.json`. Project configuration is read only for trusted projects. Configuration files contain policy values, not provider credentials. Review paths with `/autocompact-config [global|project] path` before editing in sensitive environments.

### Pi-core fallback

The extension returns `undefined` whenever a model is unavailable, auth cannot be resolved, a provider fails or times out, the request is aborted, or summary contracts fail. This delegates compaction to Pi core. Fallback preserves the safety boundary; it is not evidence that compaction was skipped entirely.

## Dependency maintenance

Dependabot checks npm and GitHub Actions weekly. Maintainers review updates for provider/auth boundary changes, run `npm ci`, typecheck, full tests with coverage, file-size checks, benchmarks, `npm audit --audit-level=high`, and package/release verification before merge. Security updates take priority over routine batches; breaking provider/runtime changes require explicit compatibility review and rollback notes.
