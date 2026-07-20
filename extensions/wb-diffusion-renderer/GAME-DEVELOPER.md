# Game-facing visual generation API

Games integrate through `@forgeax/types/visual-generation`; they do not import
this plugin and do not call browser globals. `VisualSource` and the resolved
effect frame are Studio/plugin host contracts, not game APIs.

> [!WARNING]
> This document describes the target v2 program contract. Phase 1 deliberately
> does not migrate existing games; use the schema exports as the authoritative
> source until Phase 2 updates the samples.

```ts
import {
  commitVisualPresentation,
  setVisualIntent,
} from '@forgeax/types/visual-generation';

setVisualIntent(world, {
  scene: {
    location: 'rainy market street',
    tags: ['night', 'rain'],
    continuityKey: 'market-night',
    actors: [{ id: 'hero', role: 'player', stateTags: ['walking'] }],
  },
  camera: {
    mode: 'third-person',
    motion: 'follow',
  },
});

commitVisualPresentation(world, {
  operationId: 'hero-posture-42',
  state: {
    signals: { 'input.move-y': 1 },
    activeBehaviors: [{
      recipeKey: 'cover-duck',
      instanceId: 'hero-posture',
      actorId: 'hero',
    }],
  },
});
```

`setVisualPresentationIntent` is the game-facing way to change player-authored
direction or request `paused` playback. Use the helpers
`pauseVisualPresentation`, `resumeVisualPresentation`, and
`restartVisualPresentation` for lifecycle changes; games never call Reactor
commands directly.

## Publishing image priors

`continuityKey` is an opaque game-owned key. The game must publish a matching
catalog at `visual-priors/manifest.json`; the Studio host resolves the catalog
entry before a seed-image backend session is created.

```text
.forgeax/games/<slug>/
├── main.ts
└── visual-priors/
    ├── manifest.json
    └── market-night.jpg
```

Presentation recipes live in `visual-presentation/manifest.json`. They use the
same game-owned `continuityKey` as the prior catalog, but never contain image
paths or Provider fields:

```json
{
  "version": 2,
  "entries": [
    {
      "continuityKey": "market-night",
      "signals": [{ "key": "input.move-y", "type": "number", "default": 0 }],
      "baseline": {},
      "recipes": [{ "key": "cover-duck", "active": { "prompt": [{
        "id": "duck", "slot": "world", "mode": "append",
        "text": "The courier takes cover."
      }] } }]
    }
  ]
}
```

Recipes may be combined only by publishing multiple behavior instances. They
cannot nest, activate other recipes, carry provider-specific fields, or encode
arbitrary expressions.

`image` paths are relative to the **game root**, not the `visual-priors/`
directory. A file at `visual-priors/market-night.jpg` must be declared as
`visual-priors/market-night.jpg` (or live elsewhere under the game root, e.g.
`assets/seed.jpg`).

```json
{
  "version": 1,
  "entries": [
    {
      "continuityKey": "market-night",
      "label": "Rainy market",
      "image": "visual-priors/market-night.jpg"
    }
  ]
}
```

> [!WARNING]
> A missing catalog, or an unknown `continuityKey`, fails the presentation
> request before Reactor or another provider is contacted. Panel defaults also
> skip seed-image backends when the active game has no catalog. Do not add
> provider URLs or fallback keys to game code.

## Publishing rules

| Data | API | Semantics |
| :-- | :-- | :-- |
| Durable scene, actor, camera facts | `setVisualIntent` | Full snapshot; identical values keep their revision |
| Signals, active behaviors, lifecycle | `commitVisualPresentation` | One atomic commit; enter/exit transitions are derived from active state |
| Scene/continuity change | `commitVisualPresentation` with a new `continuityKey` in `VisualIntent` | Presenter resets Provider continuity without guessing gameplay |

> [!WARNING]
> Never branch deterministic gameplay on visual presenter status or generated
> pixels. Provider latency, moderation, quota, and networking are asynchronous
> presentation concerns.

The City Stroll sample is the reference consumer. It derives visual state from
its auxiliary scene frame, third-person camera, and autoplay/movement state.

## Phase 2 reference application

`.forgeax/games/visual-probe` is the interactive LingBot Presentation Lab. It
ports Noir Alley Patrol, Battlefield Horseman, and Jet Ski Cruise into
manifest-v2 recipes with the same `event-1` recipe key. Each selected scene
gives that key different game-owned prompt semantics, proving the plugin does
not interpret physical input or recipe names.

Generated video remains in the Diffusion Renderer panel. Do not add the
provider output stream to game code: the game must remain usable when no
Provider is selected, a session fails, or generated media is delayed.
