# Implementation notes

`pi-autocompact-v2` now implements the full extension-side roadmap that can work in the current pi install here.

## Trigger side (`when`)

Implemented in `extensions/index.ts` + `src/policy.ts`:

- proactive trigger on `turn_end`
- soft threshold before pi core's hard threshold
- rapid growth trigger
- sustained growth trigger
- tool-heavy turn trigger
- emergency near-limit trigger
- cooldown / hysteresis guard
- in-flight guard
- runtime status line
- manual control commands
- global + project config files

## Summary side (`how`)

Implemented in `extensions/index.ts` + `src/prompt.ts` + `src/file-tags.ts`:

- improved structured summary template
- directive-aware standard/focused/aggressive summary modes
- preserved `previousSummary`
- preserved split-turn behavior
- preserved and merged file tracking tags
- fallback to pi core summary on missing model/auth or extension failure

## Command surface

- `/autocompact-status`
- `/autocompact-status clear`
- `/autocompact-now [instructions]`
- `/autocompact-on`
- `/autocompact-off`
- `/autocompact-config`
- `/autocompact-config project`
- `/autocompact-config [global|project] reset`
- `/autocompact-config [global|project] path`
- `/autocompact-config global <key> <value>`

## Validation

Covered by unit tests for:

- policy decisions
- config normalization/parsing
- prompt generation
- file tag handling
- tool-result size estimation
