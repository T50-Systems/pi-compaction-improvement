# Archived pi-gui compaction roadmap

Archived from `reports/roadmap.md` on 2026-07-11 because these items belong to the separate `pi-gui` product. They are external dependency notes, not commitments owned by `pi-compaction-improvement`.

## Validate non-blocking `/compact`

- Reproduce original blocking behavior in `pi-gui`.
- Measure perceived UI stall before/after background compaction.
- Confirm transcript refresh does not clobber in-progress composer input.

## Trace compaction to the deepest implementation boundary

- Follow `record.session.compact(customInstructions)` to the concrete runtime/session object.
- Document whether compaction is implemented locally, vendored, or externally provided.
- Capture any transport/API boundary involved.

## Compare transcript side effects

- Document transcript changes produced by compaction.
- Check whether `compactionSummary` shape or ordering differs across runs.
- Verify whether tree/timeline rendering should treat compaction as a special case.

## Reduce coupling in desktop orchestration

- Isolate `/compact` command handling from generic composer command flow.
- Consider dedicated state for in-flight compaction per session.
- Define expected behavior if a user sends another prompt while compaction is running.

## Add focused pi-gui coverage

- Unit/integration coverage for `/compact` command handling.
- Verify background completion path appends success/failure activity.
- Verify error path preserves session error state.
- Verify transcript reload does not regress selected transcript pagination/windowing.

## Ship strategy decision

- Keep as a local `pi-gui` patch, extract a reusable orchestration module, or upstream documentation if behavior should remain in the app layer.

Any revival requires an issue in the owning repository and must be linked here as an explicitly external dependency.
