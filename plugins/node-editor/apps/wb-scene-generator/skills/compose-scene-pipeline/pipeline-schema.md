# Pipeline And Batch Shape

The scene plugin uses `@forgeax/node-runtime` graph storage. Agents should
mutate it with `scene:pipeline.applyBatch`.

## Read

Call:

```json
{ "toolId": "scene:pipeline.get", "args": {}, "caller": { "kind": "ai" } }
```

The result is the active pipeline snapshot:

```json
{
  "id": "main",
  "hash": "...",
  "nodes": {},
  "edges": {},
  "metadata": {}
}
```

## Mutate

Call:

```json
{
  "toolId": "scene:pipeline.applyBatch",
  "args": {
    "ops": [],
    "opts": {
      "actor": "ai:scene",
      "label": "add terrain and props"
    }
  },
  "caller": { "kind": "ai" }
}
```

Use the op shapes already accepted by node-runtime for create/update/connect,
delete, grouping, layout, and metadata changes. Inspect an existing graph and
the node-runtime API contract before emitting non-trivial batches.

**Identifier field names are strict, not aliases** (2026-07-01 postmortem — a
prior batch silently produced an `undefined`-id zombie node because the field
name was wrong and nothing validated it; this is now a loud, structured,
opIndex-addressed rejection instead):

| op | required identifier field(s) |
|---|---|
| `createNode` / `updateNode` / `deleteNode` | `nodeId` (**not** `id`) |
| `connect` | `source.nodeId` / `target.nodeId` (**not** `id`); optional `edgeId` (**not** `id`) |
| `disconnect` | `edgeId` |
| `createGroup` / `updateGroup` / `deleteGroup` / `ungroup` | `groupId` (**not** `id`) |

A missing or wrong-named identifier field now rejects the WHOLE batch with a
diagnostic naming the offending `opIndex` and the expected field name — call
`scene:pipeline.get` after any `applyBatch` to confirm what actually landed,
but a `status: 'ok'` response is a much stronger signal now than it used to be.

## Execute

```json
{
  "toolId": "scene:pipeline.execute",
  "args": { "nodeId": "optional-node-id" },
  "caller": { "kind": "ai" }
}
```

Omit `nodeId` for a full graph execution.
