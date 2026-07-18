# memory/ — Long-Term Memory Templates

Memory fragments mirror the pattern from `3rd/agentic_os/persona/`'s
session-memory model: each topic / project / user-relationship is a
small markdown file the agent reads on session start, separate from the
persona.

## Two layers

| Layer            | Lives where                         | Purpose                                      | Updated by |
|------------------|-------------------------------------|----------------------------------------------|------------|
| **shared**       | `forgeax-marketplace/src/memory/`   | Project-wide context: "what is ForgeaX", "current sprint focus", "known gotchas" | maintainer commits |
| **per-instance** | `forgeax/.forgeax/agenteam-state/instances/<id>/team/agents/<id>/memory/` | What this specific agent learned: user prefs, project history, recurring decisions | the agent itself, via the `memory` tool |

The cli's `marketplace_loader` capability (Phase 2 — see issue
[#forgeax-marketplace-wire-up]) loads **shared** memory at instance
boot, then merges per-instance memory on top.

## File naming

```
src/memory/
├── 00-forgeax-overview.md      project-wide context
├── 01-art-style-tendencies.md  what art tone we usually lean toward
├── 10-user-pref-defaults.md    defaults if no per-user data yet
└── README.md                   (this file)
```

Lower numbers load first. Per-instance memory files use the same
numbering convention.

## Format

- Plain markdown.
- Short. Long memory is a smell; if you have lots to remember, that's
  usually a skill or a system-prompt fragment, not memory.
- Front-matter optional. If present, fields like `last_updated`,
  `confidence`, `decay_at` may be honored by future memory rotation
  logic. For now they're documentation only.

## Anti-patterns

- **Don't store secrets** here. This repo is private but the content
  surfaces as agent context to whatever LLM the user is wired to.
- **Don't store per-game design** here. Game design goes under
  `forgeax/games/<slug>/` (the workspace), not into agent memory.
- **Don't store transient task state** here. The session ledger and
  the agent's own scratchpad cover that.
