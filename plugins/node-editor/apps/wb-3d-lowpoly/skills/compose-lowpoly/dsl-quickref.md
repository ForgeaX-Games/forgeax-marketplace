# Geometry DSL — syntax quick reference

The DSL is the single source of truth. You submit the full text via
`lowpoly:model.apply({ source })`; the backend compiles it to a graph, executes,
bakes, and runs QC in one call. **Never** hand-wire nodes/edges.

## Grammar

One statement per line: `id = op(arg=value, arg=value, ...)`

- **id** — unique, SSA (assign once). Referenced later by name.
- **op** — an operation name from `op-directory.md` (the full signature SSOT).
- **args** — `name=value` pairs; order-free. Omitted optional args take defaults.
- `#` starts a comment to end of line. Blank lines are ignored.

## Value kinds

| kind   | example                       | notes                                   |
|--------|-------------------------------|-----------------------------------------|
| number | `0.12`, `-3`, `3e2`           | meters / radians / degrees per param    |
| string | `"revolute"`, `"a.obj"`       | double quotes                           |
| bool   | `true`, `false`               |                                         |
| list   | `[0.2, 0.4, 0.8]`, `[[0,0],[1,0]]`, `[p1, p2, p3]` | vectors, nested lists, **or a list of refs** |
| ref    | `base`, `p_body`              | a bare id referencing a prior statement |

A **ref** wires geometry together: `part(shape=base)` means this part uses the
shape produced by the statement `base`. Refs must point to an **earlier** line.

A **list of refs** feeds multi-input ops: `loft(profiles=[p1, p2, p3])` lofts the
three earlier `profile_*` statements (in order). Use the plain `[a, b, c]` list
syntax with bare ids — no quotes, no special delimiter. Same for
`extrude_with_holes(outer=o, holes=[h1, h2])`.

## Minimal example (a hinged lid)

```
mat    = material(rgba=[0.6, 0.4, 0.2, 1])
body   = box(size=[0.6, 0.4, 0.8])
cavity = box(size=[0.55, 0.38, 0.7])
shell  = difference(base=body, tool=cavity)   # hollow the box
p_body = part(shape=shell, material=mat)
lid    = box(size=[0.6, 0.02, 0.75])
p_lid  = part(shape=lid, material=mat, origin=[0, 0.21, 0])
hinge  = joint(type="revolute", parent=p_body, child=p_lid,
               axis=[0, 0, 1], origin=[0.3, 0.2, 0], lower=0, upper=1.57)
```

Submit the whole block with `model.apply`. The receipt tells you, per DSL line,
any parse/validate errors, QC signals (islands, overlaps, orphan profiles, joint
placement), mesh-aware interpenetration (with concrete translation deltas to fix
it), and the URDF fingerprint. Fix the flagged lines and re-apply.

## Rules of thumb

- Build one **rooted** tree: every `part` must reach the root via `joint`s
  (else it's a floating link, dropped at URDF time).
- A `profile_*` (2D sketch) is not a solid — it must be consumed by
  `extrude` / `loft` / `revolve` (a lone profile bakes to a ~2mm slab).
- `lathe`/`revolve` read profile points as `(r, z)` — author a dedicated r,z
  profile with all `r >= 0`, not an origin-centered XY rect/circle.
- Prefer rich ops (Parts, gears, architecture, CSG) over stacking bare
  primitives.
- To assemble already-baked meshes, reference them by name from
  `lowpoly:parts.list`: `m = mesh(filename="<sha>.obj")`.

See `op-directory.md` for the complete, auto-generated list of op signatures.
