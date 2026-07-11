# Extension release backlog

This roadmap covers only work owned by `pi-compaction-improvement`. The former `pi-gui` patch plan is archived at [`docs/archive/pi-gui-compaction-roadmap.md`](../docs/archive/pi-gui-compaction-roadmap.md) and is not an extension commitment.

## Next milestone

Next means implementation or maintainer review is committed for the next eligible minor release. Every row must link an open issue, an owner role, a product metric from [`docs/PRODUCT.md`](../docs/PRODUCT.md), status, and verification evidence.

| Issue | Metric | Owner | Status | Verification evidence |
|---|---|---|---|---|
| [#23 — command-handler coverage](https://github.com/T50-Systems/pi-compaction-improvement/issues/23) | UX-1, REL-1 | Package maintainers | Implemented on run branch; review pending | commit `532034e`; `npm run test:coverage` |
| [#24 — summary pipeline benchmark](https://github.com/T50-Systems/pi-compaction-improvement/issues/24) | PERF-1 | Performance maintainer | Implemented on run branch; baseline review pending | commit `de7bf2a`; `npm run benchmark` |
| [#25 — security/dependency policy](https://github.com/T50-Systems/pi-compaction-improvement/issues/25) | SAFE-1 | Security maintainer | Implemented on run branch; policy review pending | commit `30d3163`; YAML parse, audit, and workflow validation |
| [#26 — privacy-safe diagnostics](https://github.com/T50-Systems/pi-compaction-improvement/issues/26) | REL-1, UX-1 | Package maintainers | Implemented on run branch; privacy review pending | commit `532034e`; lifecycle and command tests |
| [#27 — governed extension backlog](https://github.com/T50-Systems/pi-compaction-improvement/issues/27) | UX-1 | Product maintainer | Implemented on run branch; prioritization review pending | this roadmap and archived external plan |

An issue remains in Next until its change is merged and release/test evidence is linked. Local implementation does not imply issue closure or release approval.

## Later milestone

Later is for accepted package-owned work that is not committed to the next minor release. Promotion to Next requires an open issue, owner, mapped metric, verification plan, and explicit maintainer priority. There are currently no accepted Later items.

Potential ideas discovered during implementation are not added here automatically. They remain proposals outside the frozen run scope until maintainers create or approve an issue.

## Deferred milestone

Deferred items are intentionally not scheduled. Each must state why it is deferred and what would justify reconsideration.

| Item | Ownership | Reason deferred | Reconsider when |
|---|---|---|---|
| Archived `pi-gui` composer/transcript changes | External dependency: `pi-gui` | Different package and runtime boundary | The owning repository links a scoped issue and requests extension integration |

## Completed evidence

Completed work is removed from Next only after it has durable release or test evidence. Foundation work shipped through [release v0.1.7](https://github.com/T50-Systems/pi-compaction-improvement/releases/tag/v0.1.7) and is summarized in [`CHANGELOG.md`](../CHANGELOG.md); it is not retained as pending roadmap prose.

## Triage and stale-item policy

- Review this roadmap at least once per minor release and during the release-readiness check.
- Confirm every Next issue is open, owned, metric-linked, and backed by current verification evidence.
- If a Next item has no owner or material activity for one minor-release cycle, move it to Later or Deferred with a reason; do not leave stale committed prose.
- Close work only when merge/release evidence exists. Link that evidence in the issue and Completed evidence before removing the row.
- Close obsolete or duplicate issues with the superseding issue or decision linked.
- Deferral must preserve the issue link, metric, reason, and a concrete reconsideration condition.
- External work must be labeled `External dependency` and must never be presented as package-owned delivery.
- Product prioritization, issue creation, and milestone assignment remain maintainer decisions.
