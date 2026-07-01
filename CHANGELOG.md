# Changelog

## v0.2.0

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
