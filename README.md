# pi-compaction-improvement

Compaction improvement package for Pi.

## What it does
- proactive trigger on `turn_end`
- earlier compaction on soft threshold, rapid growth, sustained growth, tool-heavy turns, and near-limit emergency band
- cooldown and in-flight guards
- richer `session_before_compact` summaries
- manual commands such as `/autocompact-now`, `/autocompact-status`, and `/autocompact-config`

## Install in Pi
```bash
pi install git:github.com/T50-Systems/pi-compaction-improvement@main
```

## Scope
This repo is an installable Pi package.
It does not act as a durable external state or context sync system.
