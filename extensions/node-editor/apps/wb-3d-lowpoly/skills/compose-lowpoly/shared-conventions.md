# Shared conventions — part manifest + anti-primitive rules

> Referenced by [PART A](executions/part-a-asset.md) and [PART D](executions/part-d-character.md)
> (both decompose an object into parts, model each on its own, and bake it — see
> each file's Phase 0 / Phase 1 section for the PART-specific additions on top of
> this). PART B uses a different brief shape (see
> [PART B §3](executions/part-b-building.md#3-write-the-building-brief-before-building));
> PART C's per-item scene checklist is analogous in spirit but item-level, not
> part-level (see [PART C](executions/part-c-scene-assembly.md)).

## Part manifest (hard gate)

This manifest is the **build spec that Phase 1 models against**, so it must be
detailed enough that someone could model each part *from the row alone, without
seeing the original object*. A thin list like "A: box, B: cylinder, C: box" is a
**failed manifest** — it carries no form, no function, no features, and Phase 1
will degrade straight back into stacked primitives. Be specific and concrete:
describe the *real thing*, not a placeholder shape.

First decompose the object into its real parts (a part = a piece that is a
distinct solid, a distinct material/color, or a piece that moves/bends
independently — do not merge two functionally different pieces into one row, and
do not invent filler parts). Then write **one row per part** with **all** of these
fields:

- **part name + function** — what this part *is* and what it *does* in the whole
  object (e.g. "barrel — houses the piston and forms the main pressure body";
  "trigger — the pivoting lever the finger pulls"). Function drives form.
- **real form** — 2–3 sentences describing the actual geometry so it is
  recognizable: overall silhouette, the cross-section/profile, whether it is
  hollow vs solid, tapered/curved/straight, symmetry, and what makes it read as
  *this* object and not a generic block. Ban placeholder phrases ("a box-ish
  thing", "roughly cylindrical", "some kind of cover").
- **family / op route** — the concrete modeling route, as an op sketch, not just a
  family name: e.g. "Profile→CSG: `g_profile_rounded_rect` → `g_extrude` →
  `g_difference` (bore the cavity)", or "Parts: `g_knob` (body_style=domed,
  bore_d=…)". Use the [battery-catalog.md](battery-catalog.md) routing table.
- **key dimensions** — meters, with the axis each one runs along (length X / depth
  Y / height Z, radii, wall thickness) **and** rough proportion to neighbouring
  parts so scale stays consistent across the assembly.
- **detail features** — every feature that must show up and *where it sits*: holes
  / bores / cavities / recesses / chamfers / fillets / grilles / slots / ribs /
  embossed text / tapers. For each, say roughly where on the part and how big.
  This is the list Phase 1 must actually build (mostly via CSG/Parts).
- **local origin / datum + orientation** — where the part's local origin sits
  (which face / axis / centerline) and how it is oriented, because Phase 1 bakes
  *local* coordinates and Phase 2 places the part by this datum. State which face
  or axis mates to the parent.
- **assembly link** — which part it attaches to, and how: PART A gives the joint
  (`g_joint_fixed` for static, or `g_joint_revolute`/`prismatic`/`continuous` for
  moving parts, with the axis and rough limits); PART D gives the bone instead
  (see PART D's two extra columns below). This is the Phase-2 wiring reference.
- **material / color** — the part's color/finish (applied in Phase 2 via
  `g_material`, not baked into the mesh).
- **per-primitive justification** — if (and only if) a part is routed to a bare
  `Primitive`, finish the sentence: *"this part is a primitive because the real
  form here is literally a {slab|rod|ball|ring}, with no cut, cavity, curve, or
  fillet."* If you need a "but it also has a hole / it's rounded / it's close
  enough", it is **not** a primitive — route it to CSG/Parts. "Close enough" and
  "I'll approximate it" are banned.

**PART D adds two more columns** (see [PART D Phase 0](executions/part-d-character.md)):
which bone this part maps to, and that bone's parent bone (by anatomy — limbs each
parent to a central bone, **never leg-to-leg**).

**Worked example of the required level of detail (one row):**

> **Part: `barrel` — function:** the main body of the spray bottle; holds the
> liquid and threads onto the cap. **Real form:** a tall hollow cylinder with a
> slight shoulder taper near the top and a rounded bottom; open at the top with an
> external thread collar, walls thin (it's a vessel, not a solid rod).
> **Op route:** Profile→CSG — `g_profile_circle` → `g_revolve` for the tapered
> body, then `g_difference` with an inner `g_revolve` to hollow it (wall ~2 mm).
> **Dimensions:** height 0.18 (Z), outer radius 0.035, wall 0.002, shoulder starts
> at Z≈0.15. **Detail features:** internal cavity (full hollow); thread collar
> ring at the top rim (Z 0.17–0.18); rounded bottom fillet r≈0.01. **Datum:**
> local origin at the center of the base, axis = +Z; top rim mates to the cap.
> **Assembly link:** parent of `cap` via `g_joint_fixed` at the top rim (or
> `revolute` about Z if the cap should twist). **Material:** translucent white.

A correct manifest has every part at roughly that density. **Do not build any
node until the manifest is complete** — and if a row reads as thin/generic, fix
the row before modeling, not during.

## Anti-primitive modeling rules

Real objects are **shells, cuts, curves, recesses, grilles, gears, hinges and
fillets** — almost none are a bare box or cylinder. Before placing any primitive,
default to "which CSG/Parts op builds this for real?":

- hollow shell / casing / enclosure → profile → `g_extrude`/`g_revolve` then
  `g_difference` (cut the cavity), **not** a box.
- opening / window / port / slot / vent → `g_difference` (or `g_vent_grille` /
  `g_perforated_panel` / `g_slot_panel`), **not** a smaller box laid on top.
- round / domed / bottle / nozzle / barrel body → `g_revolve` / `g_lathe` /
  `g_loft`, **not** a cylinder.
- pipe / cable / handle / duct → `g_pipe` / `g_sweep`, **not** stacked cylinders.
- knob, bezel, wheel, tire, hinge, fan, gear → the matching `Parts` op (gears via
  the `spur_gear` / `herringbone_gear` / `bevel_gear` / `ring_gear` / `rack_gear` /
  `worm` / `planetary_gearset` DSL ops in
  [parts-mechanical](op-directory/parts-mechanical.md); parametric and already
  correct), **not** an approximation.
- rounded edges / chamfers / fillets → build them into the profile
  (`g_profile_rounded_rect`) or via CSG, **not** ignored.
- irregular / organic / craggy (rock, boulder, rubble, terrain chunk) →
  `rock`/`boulder` ([core](op-directory/core.md); deterministic-noise icosphere,
  `seed` for reproducibility), **not** a plain `sphere`.

`g_bake_part` skips native primitives on purpose: if `shape_id` points at a
`box`/`cylinder`/`sphere` it bakes nothing and returns an empty `filename` plus a
`note`. Such trivial parts need no mesh — assemble them in Phase 2 with `g_box`
/ `g_cylinder` / `g_sphere` directly.
