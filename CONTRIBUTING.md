# Contributing

## Prerequisites

- Node.js 22 or newer
- npm
- Pi CLI for interactive validation

## Shortest path to a verified change

```bash
git clone https://github.com/T50-Systems/pi-compaction-improvement.git
cd pi-compaction-improvement
npm ci
npm run validate:github-config
npm run typecheck
npm test
npm run check:file-size
npm audit --audit-level=high
```

Load the checkout directly with `pi --no-extensions -e ./extensions/index.ts` and inspect `/autocompact-status` before testing manual or automatic compaction.

## Configuration

Use `/autocompact-config` to inspect and update global/project configuration. Never commit provider credentials, private session transcripts, or machine-specific config files.

## Pull requests

- Preserve fallback-to-core semantics.
- Add focused tests for trigger, lifecycle, summary, or contract changes.
- Keep orchestration thin and pure rules in their owning module.
- Update the changelog and relevant documentation.
- Run `npm audit --audit-level=high` for dependency changes.

### Repository automation

Run `npm run validate:github-config` before changing `.github/workflows/*.yml` or `.github/dependabot.yml`. The command parses YAML with duplicate-key detection and validates it against reviewed, vendored upstream schemas without network access. Schema provenance and the review-only update procedure are documented in `scripts/schemas/README.md`.
