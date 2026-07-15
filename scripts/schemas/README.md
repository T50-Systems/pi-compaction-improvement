# Vendored GitHub configuration schemas

Validation is intentionally offline: CI and local checks read these reviewed copies instead of downloading schemas while a pull request runs.

| File | Immutable upstream revision | Retrieved (UTC) | SHA-256 |
|---|---|---:|---|
| `github-workflow.schema.json` | [`SchemaStore/schemastore@7c910423`](https://github.com/SchemaStore/schemastore/blob/7c910423df8b6b68a9ec85cd7ee5fb5d508c4953/src/schemas/json/github-workflow.json) | 2026-07-15 | `7a952fdb7c1b130732e40ccea9db9bced906c1198e97834f8a49ae3b411f3161` |
| `dependabot-2.0.schema.json` | [`SchemaStore/schemastore@3a542e76`](https://github.com/SchemaStore/schemastore/blob/3a542e76452bb4d28d6017a6621bd663a7555b99/src/schemas/json/dependabot-2.0.json) | 2026-07-15 | `02285d6a056356921ef03aae69add8a57b13691fdaa0ab1f2cf7eaec9763e662` |

`validate-github-config.mjs` applies one documented local hardening overlay: Dependabot `schedule` objects reject keys not declared by the upstream schema. SchemaStore intentionally leaves those objects open, which would otherwise allow misspelled schedule keys. The negative fixture protects this stricter repository policy.

## Review and update procedure

1. Download a candidate schema from the recorded HTTPS URL into a temporary file.
2. Review the upstream SchemaStore history and the full local diff. Schema changes can expand accepted workflow behavior and therefore require the same review as a dependency update.
3. Replace the vendored file and update the date and SHA-256 in this table.
4. Run `npm run validate:github-config` and `npm test`; confirm the negative fixtures still fail with file-and-line diagnostics.
5. Submit the schema update through a pull request. Never fetch a schema dynamically from CI.

Generate the review digest with:

```bash
sha256sum scripts/schemas/*.json
```
