# Quickstart

Use Studio ToolRegistry as the only control plane:

1. `scene:projects.list` to find the active project.
2. `scene:projects.create` or `scene:projects.open` when needed.
3. `scene:batteries.list` and `scene:batteries.get` to inspect exact op IDs,
   params, inputs, and outputs.
4. `scene:pipeline.get` to read the current graph.
5. `scene:pipeline.applyBatch` to mutate the graph.
6. `scene:pipeline.execute` to run the graph.
7. `scene:renderer.info` / `scene:renderer.setViewMode` to control the preview
   view mode.
8. `scene:assets.list` to inspect generated project assets.

Do not write runtime JSON directly. The backend persists graphs, history, and
outputs through node-runtime so human UI actions and AI tool calls stay on the
same path.

## Example Tool Call

```json
{
  "toolId": "scene:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

## Iteration Loop

After every meaningful graph change:

1. Execute the graph.
2. Read the execute output summary (no errors, expected layer/asset names).
3. Inspect renderer state, selected layers, and assets when relevant.
4. Apply another focused batch if the outputs show a mismatch.
