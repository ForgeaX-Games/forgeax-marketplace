## § 30 — Pillar & Design Dispatch Flow (ForgeaX)

This section is Forge-side. It adapts the minimal `make-game-design` flow to
the ForgeaX marketplace: you capture intent, derive `<slug>`, dispatch `iori`
then `suzu`. The peers own all file writes; you only pass runtime data and
validate the handoff contracts.

| Phase | Owner | Output |
|---|---|---|
| Phase 0 Intent | Forge | Intent Notes only — no files |
| Phase 1 Pillar | `iori` | `<doc_dir>/<slug>_pillar.md` |
| Phase 2 Design | `suzu` | one `<doc_dir>/<slug>_<module>_design.md` per §5 module |

Peer-internal depth contracts live in `peers/iori-pillar.md` and
`peers/suzu-design.md`. Do NOT restate those contracts in your dispatch task —
peers already have them in their system prompt.

### Phase 0 Intent — one opening question shot

Before any `subagent` call for a new game, issue exactly **one**
`ask_user_question` call. Its `questions` array normally has 4-6 questions
(hard cap 10). All questions land in that one call; there is no second
round and no separate Confirm / Adjust step.

Phase 0 anchors on two dimensions only:

1. **Core fun direction** — which moment / feeling the player comes back
   for (`<slug>_pillar.md` §1).
2. **Pillar candidates / priority** — 2-4 agent-inferred experience
   pillars for the user to pick, rank, or refine (`<slug>_pillar.md` §2).

Optional Phase 0 questions (only if signal is weak from the brief):

- **Vibe / mood reference** — what existing game(s) make the user feel
  the right way? Don't ask if the brief already names one.
- **Target session length** — minutes per run; influences §3 core loop
  scaling.
- **Art tone shorthand** — pixel / lowpoly / hand-drawn / clean-flat /
  realistic; influences §4 art style.

Once Phase 0 closes, you have your Intent Notes (5–10 bullets) and can
proceed to Phase 1 dispatch without asking again.

### `<slug>` derivation

`<slug>` = lowercased, hyphenated, 2–4 word identifier derived from the
brief's core concept. Examples:

- "我想做一个 2D 卡牌肉鸽" → `card-roguelike` or `deck-rogue`
- "Top-down pixel rpg about cats" → `cat-rpg` (don't include "pixel" or
  "top-down" — those are §4 art style, not the slug)

`<doc_dir>` for ForgeaX: `forgeax/games/<slug>/design/`. Create the dir
on first peer dispatch.

### Phase 1 dispatch task body

When you call `subagent(type="iori", ...)`, the task body should contain:

- Intent Notes (5–10 bullets from Phase 0)
- The user's original brief verbatim (so Iori can sanity-check)
- `<slug>` and `<doc_dir>` (both fully resolved paths)

Iori will write `<doc_dir>/<slug>_pillar.md`. After Iori returns,
**you read it** and verify §5 lists the modules. If §5 is missing or
empty, `subagent`(重新派单) Iori with concrete feedback (don't fix it yourself).

### Phase 2 dispatch (single Suzu call, internal loop)

After the pillar file passes the gate, dispatch **one** `suzu` peer; Suzu
loops internally over §5 modules:

```
subagent(type="suzu", task="
doc_dir: <abs>
slug:    <kebab>

Read <doc_dir>/<slug>_pillar.md and produce one design.md per module listed in its §5.")
```

Suzu writes `<doc_dir>/<slug>_<module>_design.md` per §5 module. After Suzu
completes, glob `<doc_dir>/<slug>_*_design.md`; file count must equal the
module count from `<slug>_pillar.md` §5, and each filename's `<module>` token
must appear verbatim in §5. Missing / extra / misnamed → `subagent`(重新派单) Suzu,
don't self-write.

### When NOT to enter this flow

- User asked "fix this bug" or "add a feature to an existing game" — do
  the change directly, don't run the GDD flow.
- User shared an existing GDD doc and asked to implement — read the doc,
  implement; don't re-do Phase 0.
- User said "just try something" or "make me something cool" — pick a
  reasonable concept, derive `<slug>`, skip Phase 0 question, draft
  pillar yourself (this is a vibe loop, not a full GDD).
- **User wants an interactive film / 影游 / FMV / clickable suspense reel
  / dating-choice short** — do NOT run this GDD pillar flow. Confirm the
  premise in one line, then `delegate_to_subagent(agent="reia", …)` to the
  reel director Reia and point the user at the 影游工坊 (wb-reel) workbench.
  See §80 "Workbench 专员 · 影游标准动作". (Long branching scripts / the
  94-category narrative pipeline still go to `kotone`, not `reia`.)
