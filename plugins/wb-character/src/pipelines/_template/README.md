# Pipeline Template

## How to create a new pipeline

1. Copy this `_template/` folder to `pipelines/your-pipeline-name/`
2. Edit `index.ts`:
   - Change `meta.id` to a unique identifier (e.g., `'my-pipeline'`)
   - Change `meta.name` to a display name
   - Change `meta.icon` to an emoji
   - Implement `init()`, `createUI()`, `dispose()`
3. Save — Vite HMR picks it up instantly

## IPipeline Interface

```typescript
interface IPipeline {
  meta: { id, name, icon, description, version }
  init(ctx: PipelineContext): Promise<void>
  dispose(): void
  createUI(container: HTMLElement): void
  destroyUI(): void
  getDefaultParams(): Record<string, unknown>
}
```

## PipelineContext

The `ctx` object gives you access to:

- `ctx.engine` — Three.js renderer, camera, scene
- `ctx.sceneManager` — Load/switch 3D scenes
- `ctx.characterPreview` — Show a model on the turntable
- `ctx.eventBus` — Cross-pipeline communication
- `ctx.workspacePath` — Where MCP tools output files

## Multi-person workflow

- Each pipeline is a self-contained folder
- To share: zip your pipeline folder and send it
- To integrate: drop the folder into `pipelines/` — done
- Only dependency: `src/core/types.ts` (the IPipeline interface)
