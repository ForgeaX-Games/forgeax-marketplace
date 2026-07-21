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

`pipeline.get` also accepts `groupId` / `nodeIds` to scope the summary to a
subgraph, and (2026-07-15) `nameContains` (case-insensitive substring match on
node/group names) and `opIdIn` (exact match on `opId`) for grep-like fuzzy
lookup when you don't remember the exact `groupId`:

```json
{ "toolId": "scene:pipeline.get", "args": { "nameContains": "merge" }, "caller": { "kind": "ai" } }
```

The response includes `search: { matchCount }` when either filter is used.
Any of `groupId` / `nodeIds` / `nameContains` / `opIdIn` matching zero nodes
now returns an explicitly empty node/edge list instead of silently falling
back to the full graph.

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

**Two additions as of 2026-07-15:**

- `connect`'s `source.port` / `target.port` can be either the plain
  `"in_N"`/`"out_N"` string, or `{ "label": "SomeExposedLabel" }` — the label
  from the group's `exposedInputs`/`exposedOutputs` (as returned by
  `instantiateTemplate` / group lookup). Prefer the label form when a group
  has one; it avoids off-by-one/relabeled-port mistakes and produces a loud
  error (listing the group's currently valid labels) if the label doesn't
  exist, instead of silently wiring the wrong port.
- A composite op `appendMergeItem` replaces the old three-step "read
  `portCount` → `updateNode` it +1 → `connect` to the new `item_N`" dance for
  appending one more source into an existing `tree_merge` node:

```json
{ "type": "appendMergeItem", "mergeNodeId": "some_tree_merge_node", "source": { "nodeId": "g1", "port": { "label": "Output" } } }
```

  Multiple `appendMergeItem` ops in the same batch targeting the same merge
  node increment correctly in sequence. It only targets nodes whose `opId` is
  `tree_merge`.

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

The (non-`raw`) execute summary's `verification.topologyIssues` (2026-07-15)
reports structural graph problems — most importantly a shared upstream Rest
port fanned out to ≥2 downstream groups (`kind: "rest-fan-out"`) and a
non-root `tree_merge` used to locally pre-aggregate ≥2 groups' outputs before
feeding a single root merge (`kind: "illegal-local-merge"`). For AI callers,
`execute` throws immediately when either of these is detected, with a message
that includes ready-to-apply `suggestedOps` for the local-merge case — apply
those verbatim in your next `applyBatch` rather than re-deriving the fix by
hand. A third, non-blocking kind flags `manual_points` nodes whose `x`/`y`
silently defaulted to `(0,0)`.
