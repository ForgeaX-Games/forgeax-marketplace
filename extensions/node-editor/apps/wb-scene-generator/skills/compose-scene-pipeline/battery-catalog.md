# Battery Catalog

The battery catalog is runtime data. Always query it instead of copying stale
IDs from old scene generator docs.

## List Batteries

```json
{
  "toolId": "scene:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

Each item includes the op `id`, display names, inputs, outputs, params, dynamic
ports, lacing, and principal output hints.

## Get One Battery

```json
{
  "toolId": "scene:batteries.get",
  "args": { "id": "add_child" },
  "caller": { "kind": "ai" }
}
```

Use the returned `inputs`, `outputs`, and `params` exactly when building graph
batches. Do not guess a port name yourself from a display name — raw battery
schemas here generally don't carry a connectable semantic label.

This is different from **groups** (instantiated templates): those expose
`exposedInputs`/`exposedOutputs` with a `label` field (via
`instantiateTemplate` or a group lookup), and `scene:pipeline.applyBatch`'s
`connect` op accepts `{ "port": { "label": "SomeLabel" } }` directly for those
— the backend resolves it to the real port name for you, so for **group**
ports prefer `label` over hand-mapping to `in_N`/`out_N`. See
`pipeline-schema.md`.

## Scene Guidance

- Prefer scene, terrain, room, prop, road, city, or world-map batteries when the
  catalog contains one that matches the user's vocabulary.
- Use renderer-facing outputs that the current catalog and preview surface can
  display.
- Treat missing batteries as a capability gap and report it instead of
  inventing op IDs.
