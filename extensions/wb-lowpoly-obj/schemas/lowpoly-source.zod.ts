/**
 * LowPolySource v1 — SSOT schema for a lowpoly humanoid character.
 *
 * Edited by: vibe pipeline (LLM) + sculpt pipeline (manual gizmo).
 * Persisted at: data/lowpoly-characters/<slug>/source.json
 * Baked to:    .glb (engine-neutral) via @gltf-transform/core
 *
 * Design contract:
 *  - One source.json = one character. The .glb is derived (content-addressed).
 *  - Bones are bind-pose-only here; runtime poses live in clips[].
 *  - Each part rigidly binds to exactly one bone (no vertex skinning weights —
 *    the lowpoly philosophy is "rigid attachment", not "smooth skinned mesh").
 *  - humanoid-standard-v1 has 17 bones; v2 may open custom skeletons.
 */
import { z } from 'zod'

/* ── Standard humanoid skeleton ────────────────────────────────────── */

export const HUMANOID_STANDARD_V1_BONES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand',
  'leftUpLeg', 'leftLeg', 'leftFoot',
  'rightUpLeg', 'rightLeg', 'rightFoot',
] as const

export type HumanoidBoneId = (typeof HUMANOID_STANDARD_V1_BONES)[number]

export const HumanoidBoneIdSchema = z.enum(HUMANOID_STANDARD_V1_BONES)

/* ── Geometry primitives ───────────────────────────────────────────── */

export const Vec3 = z.tuple([z.number(), z.number(), z.number()])
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const GeoBox = z.object({
  kind: z.literal('box'),
  size: Vec3, // width, height, depth
})
export const GeoCylinder = z.object({
  kind: z.literal('cylinder'),
  radiusTop: z.number().nonnegative(),
  radiusBottom: z.number().nonnegative(),
  height: z.number().positive(),
  segments: z.number().int().min(3).max(32).optional(),
})
export const GeoSphere = z.object({
  kind: z.literal('sphere'),
  radius: z.number().positive(),
  widthSeg: z.number().int().min(3).max(32).optional(),
  heightSeg: z.number().int().min(2).max(32).optional(),
})
export const GeoCapsule = z.object({
  kind: z.literal('capsule'),
  radius: z.number().positive(),
  height: z.number().positive(),
})
export const GeoCone = z.object({
  kind: z.literal('cone'),
  radius: z.number().positive(),
  height: z.number().positive(),
})

export const GeoSpec = z.discriminatedUnion('kind', [
  GeoBox, GeoCylinder, GeoSphere, GeoCapsule, GeoCone,
])
export type GeoSpec = z.infer<typeof GeoSpec>

/* ── Material ──────────────────────────────────────────────────────── */

export const Material = z.object({
  roughness: z.number().min(0).max(1).default(0.82),
  metalness: z.number().min(0).max(1).default(0.04),
  flatShading: z.boolean().default(true),
})

/* ── Part ──────────────────────────────────────────────────────────── */

export const Part = z.object({
  /** Stable id, kebab-case. Mirrored pairs use leftXxx/rightXxx prefix. */
  id: z.string().regex(/^[a-z][a-zA-Z0-9-]*$/),
  geo: GeoSpec,
  /** Bone this part rigidly attaches to. */
  attachTo: HumanoidBoneIdSchema,
  /** Local TRS relative to the attached bone, in bind pose. */
  offset: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]), // Euler XYZ rad
  scale: Vec3.default([1, 1, 1]),
  color: HexColor,
  material: Material.default({ roughness: 0.82, metalness: 0.04, flatShading: true }),
})
export type Part = z.infer<typeof Part>

/* ── Animation clip ────────────────────────────────────────────────── */

export const Keyframe = z.object({
  t: z.number().nonnegative(),
  /** value layout depends on track.property: translation/scale = [x,y,z]; rotation = quat [x,y,z,w]. */
  value: z.array(z.number()),
})

export const Track = z.object({
  bone: HumanoidBoneIdSchema,
  property: z.enum(['translation', 'rotation', 'scale']),
  interpolation: z.enum(['STEP', 'LINEAR', 'CUBICSPLINE']).default('LINEAR'),
  keyframes: z.array(Keyframe).min(1),
})

export const Clip = z.object({
  name: z.string().min(1),
  duration: z.number().positive(),
  loop: z.boolean().default(true),
  tracks: z.array(Track),
})
export type Clip = z.infer<typeof Clip>

/* ── Top-level source ──────────────────────────────────────────────── */

export const LowPolySource = z.object({
  schemaVersion: z.literal(1),
  meta: z.object({
    name: z.string().min(1),
    author: z.string().optional(),
    createdAt: z.string().datetime(),
    /** Whole-character uniform scale applied at bake time. */
    scale: z.number().positive().default(1),
  }),
  skeleton: z.union([
    z.literal('humanoid-standard-v1'),
    // v2: custom skeleton schema to be added.
  ]),
  parts: z.array(Part).min(1),
  /** Static named poses (excluding bind). Optional. */
  poses: z.record(
    z.string(),
    z.object({
      boneTransforms: z.record(
        HumanoidBoneIdSchema,
        z.object({
          translation: Vec3.optional(),
          rotation: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), // quat
          scale: Vec3.optional(),
        }),
      ),
    }),
  ).optional(),
  clips: z.array(Clip).default([]),
})
export type LowPolySource = z.infer<typeof LowPolySource>

/* ── Patch ops (vibe-edit returns these) ───────────────────────────── */

export const SourceOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addPart'),    part: Part }),
  z.object({ op: z.literal('removePart'), id: z.string() }),
  z.object({ op: z.literal('updatePart'), id: z.string(), patch: Part.partial() }),
  z.object({ op: z.literal('setColor'),   id: z.string(), color: HexColor }),
  z.object({ op: z.literal('setClip'),    clip: Clip }),
  z.object({ op: z.literal('removeClip'), name: z.string() }),
  z.object({ op: z.literal('setMeta'),    patch: z.object({ name: z.string().optional(), scale: z.number().positive().optional() }) }),
])
export type SourceOp = z.infer<typeof SourceOp>
