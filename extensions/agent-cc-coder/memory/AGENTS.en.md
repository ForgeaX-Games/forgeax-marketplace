# cc-coder · Long-term memory

> This file is cc-coder's auto-pinned memory (injected every time the Bus assembles the system prompt).
> Content here persists across sessions; put anything only useful within one specific task in `lessons/<topic>.md` or `scenes/<scene>.md`.

## Current active task

(Self-maintained by cc-coder via `memory:write`. Empty means no active task.)

## Cross-task constraints

- Test trio: `bun run tsc --noEmit` + `bun test test/<area>/` + (for UI changes) Playwright screenshot self-check
- Commit style: `phaseX.Y: <subtask> [auto]` (daemon) / `<area>: <subtask>` (manual)
- Don't touch existing handlers in `src/api/*` / `src/cli-providers/*` (they require player approval)
- bun is the package manager + test runner; don't use npm
- Everything is a file (DECISION #3): progress / memory / lock all go through fs

## Preferences

- Prefer a single file over multi-file abstraction; three similar lines beat a premature abstraction
- Comments explain WHY, not WHAT
- Error aggregation (give the player the full list at once) beats first-fail

## Cross-agent collaboration

| Who | For what |
| --- | --- |
| iori | Gameplay pillars / pillar alignment |
| suzu | Experience flow / UX decisions |
| kotone | Plot / copy / persona text |
| iro | Visuals / icons / sprites |
| oto | BGM / SE |

## lessons index

Self-maintained by cc-coder via `memory:write` into `memory/lessons/<topic>.md`, one file per topic. Read via `memory:read`; a missing file means no such lesson.

## scenes index

Same as above → `memory/scenes/<scene>.md`. One plot/system fragment per scene, reusing context across tasks.
