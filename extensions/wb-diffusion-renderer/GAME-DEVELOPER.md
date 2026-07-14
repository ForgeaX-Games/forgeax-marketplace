# Diffusion Renderer — Game Developer Guide

This guide is for game code that wants to drive the Diffusion Renderer prompt from
runtime state. You do not need to know the FluxRT protocol or the Studio plugin
internals.

## What You Can Control

The plugin exposes an optional browser global while the Diffusion Renderer panel is
mounted:

```ts
window.forgeaxDiffusion
```

Use it to send a **game-state prompt fragment**. The plugin composes that fragment
with the prompt the human typed in the panel:

```text
effective prompt = panel base prompt + ", " + game fragment
```

Example:

```text
Panel base prompt:
polished 3D game render, detailed models, clean geometry, rich materials, cinematic lighting

Game fragment:
night, heavy rain, wet reflections

Effective prompt sent to FluxRT:
polished 3D game render, detailed models, clean geometry, rich materials, cinematic lighting, night, heavy rain, wet reflections
```

This means game code should describe **what changed in the scene**, not restate the
whole visual style.

## Basic Usage

Always use optional chaining. The API is available only when the inline Diffusion
Renderer panel is mounted.

```ts
window.forgeaxDiffusion?.setPrompt('night, heavy rain, wet reflections');
```

Clear the game fragment when the condition no longer applies:

```ts
window.forgeaxDiffusion?.setPrompt('');
```

Or hand control fully back to the panel:

```ts
window.forgeaxDiffusion?.clearGameOverrides();
```

The game does **not** start or stop the live stream. The human still opens the panel
and clicks `Go Live`. Game code only adjusts the live rendering params if the panel is
present.

## ECS Pattern

Set the fragment from a system or `ctx.registerUpdate`. Prefer deriving a small
fragment from game state and updating it only when the fragment changes.

```ts
let lastFragment = '';

function setDiffusionFragment(fragment: string): void {
  if (fragment === lastFragment) return;
  lastFragment = fragment;
  window.forgeaxDiffusion?.setPrompt(fragment);
}

export async function bootstrap(world: World, ctx: GameContext) {
  ctx.registerUpdate(() => {
    const player = findPlayer(world);
    if (!player) {
      setDiffusionFragment('');
      return;
    }

    if (player.onFire) {
      setDiffusionFragment('engulfed in flames, embers, heat haze');
      return;
    }

    if (player.inCave) {
      setDiffusionFragment('dark damp cave, torchlight, deep shadows');
      return;
    }

    if (player.weather === 'storm') {
      setDiffusionFragment('heavy rain, wet ground, dramatic storm clouds');
      return;
    }

    setDiffusionFragment('');
  });
}
```

`findPlayer`, `World`, and `GameContext` above are placeholders for your game's actual
ECS helpers/types.

## API Reference

```ts
interface ForgeaxDiffusionControl {
  readonly version: 1;
  isLive(): boolean;
  setPrompt(fragment: string): void;
  setParams(params: Partial<{
    prompt: string;
    steps: number;
    interp: number;
    seed: number;
  }>): void;
  clearGameOverrides(): void;
  subscribe(cb: (status: ForgeaxDiffusionStreamStatus) => void): () => void;
}
```

### `setPrompt(fragment)`

Sets only the game prompt fragment. This is the normal game integration path.

```ts
window.forgeaxDiffusion?.setPrompt('low fog, cold moonlight');
```

An empty string removes the game fragment but keeps the panel base prompt.

### `setParams(params)`

Advanced API for overriding non-text parameters:

```ts
window.forgeaxDiffusion?.setParams({
  prompt: 'fast motion blur, racing speed lines',
  steps: 1,
});
```

Only `prompt` composes with the panel base prompt. `steps`, `interp`, and `seed` are
plain overrides of the panel values while they are set.

Use these sparingly:

- `steps`: lower is faster, higher is more detailed. Valid FluxRT range is `1`-`4`.
- `interp`: `0` off, `1` = 2x, `2` = 4x smoothing.
- `seed`: keep stable unless you intentionally want style variation.

### `clearGameOverrides()`

Clears all game-provided overrides. The panel returns to manual-only control.

```ts
window.forgeaxDiffusion?.clearGameOverrides();
```

### `isLive()`

Returns whether the stream is currently live.

```ts
if (window.forgeaxDiffusion?.isLive()) {
  window.forgeaxDiffusion.setPrompt('boss arena, red warning lights');
}
```

### `subscribe(cb)`

Subscribe to stream status if you want an in-game HUD or debug display.

```ts
const unsubscribe = window.forgeaxDiffusion?.subscribe((status) => {
  console.log(status.state, status.fps, status.e2eMs);
});

// Later:
unsubscribe?.();
```

## Types

The types-only declaration lives at:

```text
packages/marketplace/extensions/wb-diffusion-renderer/src/game-api.d.ts
```

It declares `window.forgeaxDiffusion` and the status/params types. Game code can also
remain untyped and use optional chaining directly; the runtime does not require an
import.

## Runtime Notes

- The API is optional. If the panel is closed, `window.forgeaxDiffusion` is undefined.
- The API is currently same-window and targets the in-process edit viewport
  (`canvas#app`). The `/preview/` iframe runtime is a separate realm and does not have
  this direct channel yet.
- The panel shows a `game` badge when a game fragment is active. The human can click
  `reclaim` to clear the game fragment.
- The stream already coalesces params per captured frame. Avoid doing expensive string
  work every frame, but it is safe for a game loop to call `setPrompt` after checking
  that the fragment changed.
- Keep fragments short and concrete. The runtime caps game prompt fragments before
  sending them.

## Prompt Fragment Tips

Good fragments describe current state:

```text
night market, neon signs, wet pavement
```

```text
inside lava cave, orange glow, smoke and sparks
```

```text
underwater, blue caustics, floating particles
```

Avoid repeating the panel's base style:

```text
photorealistic, PBR, high quality, detailed, cinematic, night market...
```

The panel is already responsible for stable style. The game fragment should carry
gameplay and environment state.
