# ForgeaX Studio — forgeax-marketplace

[English](./README.md) · [简体中文](./README.zh-CN.md) · [↑ studio](https://github.com/ForgeaX-Games/forgeax-studio)

> **The content layer — the personas, system-prompt fragments, skills, and visual workbench plugins the agents compose to design and build games. Everything an agent is, minus its code.**

`forgeax-marketplace` is what the agent kernel loads at boot to *become* a game studio. It is
not a binary plugin host — it is a library of **markdown + JSON fragments**: named-agent
personas, ordered system-prompt slots, reusable skills, long-term-memory templates, and a fleet
of **workbench plugins** (visual editors for scenes, characters, narrative, animation, audio,
balance, and short-form "reel" content). Because content is data, the team and its tools grow by
adding files — not by changing the engine or the kernel.

## Why it matters

- **Persona *is* function ("人格层兼职能层").** Each peer agent is one file that fuses
  personality (voice, identity) with a function contract (input → output → ownership boundary).
  In the Workbench, each peer is a card that **owns a slice of the project's files** — so
  delegation and accountability are visible, not implicit.
- **A real studio roster, not faceless role literals.** The team has names and jobs:

  | Card | id | Role | Owns |
  |---|---|---|---|
  | 主线制作人 | `forge` | orchestrator | the game's `src/**` |
  | 核心玩法师 | `iori` | pillar / core-loop | the design pillar doc |
  | 体验设计师 | `suzu` | systems design | per-module design docs |
  | 剧情师 | `kotone` | narrative | story + dialogue |
  | 美术师 | `iro` | art | asset specs |
  | 工程师 | `tsumugi` | coding | implementation |

  The canonical roster lives in `manifest.json#agents`.
- **Prompts are composed, not hardcoded.** `src/system-prompt/` ships ordered fragments
  (`00-persona`, `01-platform-constraints`, `30-pillar-design-flow`, `50-question-tool`,
  `60-workflow`, `80-workbench-agents`, plus `peers/` and `shared/`) that slot into the kernel's
  priority-ordered prompt assembly. Editing behavior is editing a fragment.
- **Workbench plugins make the abstract tangible.** The `wb-*` plugins are domain editors the
  agents drive — `wb-scene-generator`, `wb-character`, `wb-narrative`, `wb-reel`, `wb-anim`,
  `wb-bgm`, `wb-items`, `wb-look`, `wb-balance`, `wb-3d-lowpoly`, and more — so a human can see and
  steer what the agent is building.
- **Pluggable model backends.** A persona/driver split (`cli-*` drivers: claude-code, codex,
  cursor, forgeax) lets the same persona run on different agent runtimes.
- **Self-extensible.** Authoring a new plugin or skill is itself a plugin
  (`skill-author-plugin`, `wb-plugin-author`, `wb-skill`) — the marketplace teaches agents to
  extend the marketplace.

## Structure

```
manifest.json            # the registry: id / version / schemaVersion / agents / skills
src/system-prompt/       # ordered prompt fragments (+ peers/, shared/)
src/skills/              # reusable skills (e.g. make-game-design)
src/memory/              # long-term-memory templates
plugins/                 # the plugin fleet:
  agent-*                #   named-agent personas
  wb-*                   #   visual workbench editors (scene / character / narrative / reel / …)
  cli-*                  #   model/runtime drivers
  skill-* / tool-* / node-editor / model-*
```

## Key concepts

persona = function (file-owning peers) · the named roster (`forge` / `iori` / `suzu` / `kotone`
/ `iro` / `tsumugi`) · ordered system-prompt slots · `wb-*` workbench plugins · `cli-*`
persona/driver split · `manifest.json` registry · content-as-data (extend by adding files).

## How it fits the studio

At agent boot, the kernel reads `manifest.json` and the `src/system-prompt/` fragments to
assemble Forge and her peers; the Workbench UI renders the personas as cards and mounts the
`wb-*` plugins as editors. When you ask Forge for a game, this is the content that decides *who*
does *what* and *with which tool*.

---

Part of the **ForgeaX Studio** monorepo. This repo is a submodule of
[`ForgeaX-Games/forgeax-studio`](https://github.com/ForgeaX-Games/forgeax-studio) — clone that
with `--recurse-submodules` to run the full studio. License: Apache-2.0.
