# Compact follow-up roadmap

## 1. Validate non-blocking `/compact`
- Reproduce original blocking behavior in `pi-gui`
- Measure perceived UI stall before/after background compaction
- Confirm transcript refresh does not clobber in-progress composer input

## 2. Trace compaction to the deepest implementation boundary
- Follow `record.session.compact(customInstructions)` to the concrete runtime/session object
- Document whether compaction is implemented locally, vendored, or externally provided
- Capture any transport/API boundary involved

## 3. Compare transcript side effects
- Document transcript changes produced by compaction
- Check whether `compactionSummary` shape or ordering differs across runs
- Verify whether tree/timeline rendering should treat compaction as a special case

## 4. Reduce coupling in desktop orchestration
- Isolate `/compact` command handling from generic composer command flow
- Consider dedicated state for in-flight compaction per session
- Define expected behavior if user sends another prompt while compaction is running

## 5. Add focused test coverage
- Unit/integration coverage for `/compact` command handling
- Verify background completion path appends success/failure activity
- Verify error path preserves session error state
- Verify transcript reload does not regress selected transcript pagination/windowing

## 6. Decide ship strategy
- Keep as local patch in `pi-gui`, or
- Extract a reusable compact orchestration module, or
- Upstream only documentation if the behavior should remain in app layer
