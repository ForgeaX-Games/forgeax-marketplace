// @source wb-character/src/pipelines/spine/editor/SpineDataParser.ts
import type {
  RawSpineJson, RawBone, EditorBone, EditorSlot, EditorIK,
  EditorAnimation, EditorSkeleton, RawAttachment,
} from './types';

const ROLE_PATTERNS: [RegExp, string][] = [
  [/head|tou|头/i, 'head'],
  [/neck|bo|脖|颈/i, 'neck'],
  [/chest|xiong|胸|躯干2|^torso$/i, 'chest'],
  [/spine|ji|躯干|脊/i, 'spine'],
  [/hip|kuan|k1|腰|骨盆|臀|pelvis/i, 'hip'],
  [/shoulder|jb|肩/i, 'shoulder'],
  [/upper.?arm|arm.*up|db|x[12]|大臂/i, 'upper_arm'],
  [/forearm|arm.*down|xb|x[34]|小臂|前臂/i, 'forearm'],
  [/hand|shou|x[56]|^手$|手[^臂]/i, 'hand'],
  [/thigh|leg.*up|dt|t[12]|大腿/i, 'thigh'],
  [/shin|leg.*down|xt|t[34]|小腿/i, 'shin'],
  [/foot|jiao|t[56]|脚|足/i, 'foot'],
  [/weapon|wq|武器|刀|剑|枪|杖|弓|矛/i, 'weapon'],
  [/target|^ik/i, 'ik_target'],
  [/root/i, 'root'],
];

function inferRole(bone: RawBone, depth: number): string {
  for (const [pat, role] of ROLE_PATTERNS) {
    if (pat.test(bone.name)) return role;
  }
  if (bone.name.startsWith('g/')) {
    const sub = bone.name.slice(2);
    if (/^t\d/.test(sub)) return 'body_segment';
    if (/^x\d/.test(sub)) return 'arm_segment';
    if (/^n/.test(sub)) return 'leg_segment';
    if (/^w/.test(sub)) return 'leg_segment';
  }
  if (bone.name.startsWith('gg/')) return 'effect';
  if (bone.name.startsWith('w-') || bone.name.startsWith('w/')) return 'weapon';
  if (depth <= 1) return 'root_structure';
  return 'unknown';
}

export function parseSpineJson(raw: RawSpineJson): EditorSkeleton {
  const bones = new Map<string, EditorBone>();
  const boneOrder: string[] = [];
  const childrenMap = new Map<string, string[]>();

  for (const rb of raw.bones) {
    const parentName = rb.parent ?? null;
    if (parentName) {
      const arr = childrenMap.get(parentName) ?? [];
      arr.push(rb.name);
      childrenMap.set(parentName, arr);
    }
  }

  const depthMap = new Map<string, number>();
  function getDepth(name: string): number {
    if (depthMap.has(name)) return depthMap.get(name)!;
    const rb = raw.bones.find(b => b.name === name);
    if (!rb?.parent) { depthMap.set(name, 0); return 0; }
    const d = getDepth(rb.parent) + 1;
    depthMap.set(name, d);
    return d;
  }

  for (const rb of raw.bones) {
    const depth = getDepth(rb.name);
    const eb: EditorBone = {
      name: rb.name,
      parent: rb.parent ?? null,
      children: childrenMap.get(rb.name) ?? [],
      localX: rb.x ?? 0,
      localY: rb.y ?? 0,
      localRotation: rb.rotation ?? 0,
      length: rb.length ?? 0,
      scaleX: rb.scaleX ?? 1,
      scaleY: rb.scaleY ?? 1,
      shearX: rb.shearX ?? 0,
      shearY: rb.shearY ?? 0,
      transform: rb.transform ?? rb.inherit ?? 'normal',
      role: inferRole(rb, depth),
      worldX: 0,
      worldY: 0,
      worldRotation: 0,
      worldA: 1, worldB: 0, worldC: 0, worldD: 1,
      setupX: rb.x ?? 0,
      setupY: rb.y ?? 0,
      setupRotation: rb.rotation ?? 0,
    };
    bones.set(rb.name, eb);
    boneOrder.push(rb.name);
  }

  computeWorldTransforms(bones, boneOrder);

  const rootBones = boneOrder.filter(n => bones.get(n)!.parent === null);

  const slots: EditorSlot[] = raw.slots.map(s => ({
    name: s.name,
    boneName: s.bone,
    attachmentName: s.attachment ?? null,
  }));

  const ik: EditorIK[] = (raw.ik ?? []).map(r => ({
    name: r.name,
    boneNames: r.bones,
    targetName: r.target,
    bendPositive: r.bendPositive ?? true,
    mix: r.mix ?? 1,
  }));

  const animations = new Map<string, EditorAnimation>();
  for (const [name, rawAnim] of Object.entries(raw.animations ?? {})) {
    let maxTime = 0;
    const boneTimelines: EditorAnimation['boneTimelines'] = {};

    if (rawAnim.bones) {
      for (const [boneName, tl] of Object.entries(rawAnim.bones)) {
        const entry: EditorAnimation['boneTimelines'][string] = {};

        if (tl.rotate) {
          entry.rotate = tl.rotate.map(k => ({
            time: k.time ?? 0,
            value: k.value ?? k.angle ?? 0,
          }));
          for (const k of entry.rotate) if (k.time > maxTime) maxTime = k.time;
        }
        if (tl.translate) {
          entry.translate = tl.translate.map(k => ({
            time: k.time ?? 0,
            x: k.x ?? 0,
            y: k.y ?? 0,
          }));
          for (const k of entry.translate) if (k.time > maxTime) maxTime = k.time;
        }
        if (tl.scale) {
          entry.scale = tl.scale.map(k => ({
            time: k.time ?? 0,
            x: k.x ?? 1,
            y: k.y ?? 1,
          }));
          for (const k of entry.scale) if (k.time > maxTime) maxTime = k.time;
        }
        if (tl.shear) {
          entry.shear = tl.shear.map(k => ({
            time: k.time ?? 0,
            x: k.x ?? 0,
            y: k.y ?? 0,
          }));
          for (const k of entry.shear) if (k.time > maxTime) maxTime = k.time;
        }
        boneTimelines[boneName] = entry;
      }
    }

    animations.set(name, { name, duration: maxTime || 1, boneTimelines });
  }

  const rawSkinsMap = new Map<string, any>();
  for (const skin of raw.skins ?? []) {
    rawSkinsMap.set(skin.name || 'default', skin);
  }

  const skinAttachments = new Map<string, Map<string, RawAttachment>>();
  for (const skin of raw.skins ?? []) {
    if (!skin.attachments) continue;
    for (const [slotName, atts] of Object.entries(skin.attachments)) {
      for (const [attName, attData] of Object.entries(atts)) {
        if (!skinAttachments.has(slotName)) skinAttachments.set(slotName, new Map());
        
        let finalData = attData as RawAttachment;
        if (finalData.type === 'linkedmesh') {
          const parentSkinName = finalData.skin ?? 'default';
          const parentAttName = finalData.parent ?? attName;
          const parentSkin = rawSkinsMap.get(parentSkinName);
          if (parentSkin && parentSkin.attachments && parentSkin.attachments[slotName]) {
            const parentAtt = parentSkin.attachments[slotName][parentAttName];
            if (parentAtt) {
              finalData = { ...parentAtt, ...finalData, type: 'mesh' };
            }
          }
        }
        
        skinAttachments.get(slotName)!.set(attName, finalData);
      }
    }
  }

  return { bones, boneOrder, rootBones, slots, ik, animations, skinAttachments };
}

/**
 * Compute world transforms using Spine's standard 2x2 matrix approach.
 * Each bone's world matrix = parent_world_matrix * local_matrix.
 * local_matrix = rotation(localRotation) * scale(scaleX, scaleY) * shear(shearX, shearY).
 */
export function updateBoneWorldMatrix(b: EditorBone, p: EditorBone | undefined): void {
  if (!p) {
    const rotationY = b.localRotation + 90 + b.shearY;
    b.worldA = Math.cos((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
    b.worldB = Math.cos(rotationY * Math.PI / 180) * b.scaleY;
    b.worldC = Math.sin((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
    b.worldD = Math.sin(rotationY * Math.PI / 180) * b.scaleY;
    b.worldX = b.localX;
    b.worldY = b.localY;
    b.worldRotation = b.localRotation;
    return;
  }

  let pa = p.worldA, pb = p.worldB, pc = p.worldC, pd = p.worldD;
  b.worldX = pa * b.localX + pb * b.localY + p.worldX;
  b.worldY = pc * b.localX + pd * b.localY + p.worldY;

  switch (b.transform) {
    case 'normal':
    default: {
      const rotationY = b.localRotation + 90 + b.shearY;
      const la = Math.cos((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
      const lb = Math.cos(rotationY * Math.PI / 180) * b.scaleY;
      const lc = Math.sin((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
      const ld = Math.sin(rotationY * Math.PI / 180) * b.scaleY;
      b.worldA = pa * la + pb * lc;
      b.worldB = pa * lb + pb * ld;
      b.worldC = pc * la + pd * lc;
      b.worldD = pc * lb + pd * ld;
      break;
    }
    case 'onlyTranslation': {
      const rotationY = b.localRotation + 90 + b.shearY;
      b.worldA = Math.cos((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
      b.worldB = Math.cos(rotationY * Math.PI / 180) * b.scaleY;
      b.worldC = Math.sin((b.localRotation + b.shearX) * Math.PI / 180) * b.scaleX;
      b.worldD = Math.sin(rotationY * Math.PI / 180) * b.scaleY;
      break;
    }
    case 'noRotationOrReflection': {
      let s = pa * pa + pc * pc;
      let prx = 0;
      if (s > 0.0001) {
        s = Math.abs(pa * pd - pb * pc) / s;
        // Adjust for parent's inherited scale logic, removing scale component for proper rotation removal
        // In normal Spine, pa and pc are unscaled by this.skeleton.scaleX/Y.
        let pa_tmp = pa; let pc_tmp = pc;
        let pb_tmp = pc_tmp * s;
        let pd_tmp = pa_tmp * s;
        prx = Math.atan2(pc_tmp, pa_tmp) * 180 / Math.PI;
        
        const rx = b.localRotation + b.shearX - prx;
        const ry = b.localRotation + b.shearY - prx + 90;
      const la = Math.cos(rx * Math.PI / 180) * b.scaleX;
      const lb = Math.cos(ry * Math.PI / 180) * b.scaleY;
      const lc = Math.sin(rx * Math.PI / 180) * b.scaleX;
      const ld = Math.sin(ry * Math.PI / 180) * b.scaleY;
        // Note Spine's minus signs for b and d are applied to b.worldA and b.worldB components
        b.worldA = pa_tmp * la - pb_tmp * lc;
        b.worldB = pa_tmp * lb - pb_tmp * ld;
        b.worldC = pc_tmp * la + pd_tmp * lc;
        b.worldD = pc_tmp * lb + pd_tmp * ld;
      } else {
      prx = 90 - Math.atan2(pd, pb) * 180 / Math.PI;
      
      const rx = b.localRotation + b.shearX - prx;
      const ry = b.localRotation + b.shearY - prx + 90;
      const la = Math.cos(rx * Math.PI / 180) * b.scaleX;
      const lb = Math.cos(ry * Math.PI / 180) * b.scaleY;
      const lc = Math.sin(rx * Math.PI / 180) * b.scaleX;
      const ld = Math.sin(ry * Math.PI / 180) * b.scaleY;
      b.worldA = 0 * la - pb * lc;
      b.worldB = 0 * lb - pb * ld;
      b.worldC = 0 * la + pd * lc;
      b.worldD = 0 * lb + pd * ld;
    }
    break;
  }
  case 'noScale':
  case 'noScaleOrReflection': {
    const cos = Math.cos(b.localRotation * Math.PI / 180);
    const sin = Math.sin(b.localRotation * Math.PI / 180);
    let za = (pa * cos + pb * sin) / 1; // Assuming parent global scale X is 1
    let zc = (pc * cos + pd * sin) / 1; // Assuming parent global scale Y is 1
    let s = Math.sqrt(za * za + zc * zc);
    if (s > 0.00001) s = 1 / s;
    za *= s;
    zc *= s;
    s = Math.sqrt(za * za + zc * zc);
    // Spine behavior for noScale when reflection occurs:
    if (b.transform === 'noScale' && (pa * pd - pb * pc < 0)) s = -s;
    const r = Math.PI / 2 + Math.atan2(zc, za);
    const zb = Math.cos(r) * s;
    const zd = Math.sin(r) * s;
      const la = Math.cos((b.shearX) * Math.PI / 180) * b.scaleX;
      const lb = Math.cos((90 + b.shearY) * Math.PI / 180) * b.scaleY;
      const lc = Math.sin((b.shearX) * Math.PI / 180) * b.scaleX;
      const ld = Math.sin((90 + b.shearY) * Math.PI / 180) * b.scaleY;
      b.worldA = za * la + zb * lc;
      b.worldB = za * lb + zb * ld;
      b.worldC = zc * la + zd * lc;
      b.worldD = zc * lb + zd * ld;
      break;
    }
  }

  // Spine's reference implementation does:
  // this.a *= this.skeleton.scaleX; etc.
  // which is skeleton scale, not bone scale. Since we don't have skeleton scale,
  // we do NOT multiply by b.scaleX here because it's ALREADY multiplied in local matrix 'la'.
  // b.worldA *= b.scaleX; etc. is WRONG here.

  b.worldRotation = Math.atan2(b.worldC, b.worldA) * 180 / Math.PI;
}

export function computeWorldTransforms(bones: Map<string, EditorBone>, order: string[]): void {
  for (const name of order) {
    const b = bones.get(name)!;
    const p = b.parent ? bones.get(b.parent) : undefined;
    updateBoneWorldMatrix(b, p);
  }
}

/**
 * Apply IK constraints after forward kinematics.
 * WORLD-ONLY: modifies only worldX/worldY/worldRotation, never localRotation.
 * This prevents frame-over-frame drift and keeps authored bone data intact.
 */
export function applyIKConstraints(
  bones: Map<string, EditorBone>,
  order: string[],
  ikConstraints: EditorIK[],
): void {
  for (const ik of ikConstraints) {
    if (ik.mix === 0) continue;
    const target = bones.get(ik.targetName);
    if (!target) continue;

    if (ik.boneNames.length === 1) {
      solveIK1(bones, order, ik.boneNames[0], target, ik.mix);
    } else if (ik.boneNames.length >= 2) {
      solveIK2(bones, order, ik.boneNames[0], ik.boneNames[1], target, ik.mix, ik.bendPositive);
    }
  }
}

function normDeg(deg: number): number {
  deg = deg % 360;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  return deg;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 1-bone IK: rotate bone so its tip aims at the target (world-only). */
function solveIK1(
  bones: Map<string, EditorBone>,
  order: string[],
  boneName: string,
  target: EditorBone,
  mix: number,
): void {
  const bone = bones.get(boneName);
  if (!bone) return;

  const desiredWorld = Math.atan2(
    target.worldY - bone.worldY,
    target.worldX - bone.worldX,
  ) * 180 / Math.PI;

  const diff = normDeg(desiredWorld - bone.worldRotation);
  const adjustDeg = diff * mix;
  bone.worldRotation += adjustDeg;
  const adjustRad = adjustDeg * Math.PI / 180;
  const ca = Math.cos(adjustRad), sa = Math.sin(adjustRad);
  const oa = bone.worldA, ob = bone.worldB, oc = bone.worldC, od = bone.worldD;
  bone.worldA = ca * oa - sa * oc;
  bone.worldB = ca * ob - sa * od;
  bone.worldC = sa * oa + ca * oc;
  bone.worldD = sa * ob + ca * od;

  propagateDescendants(bones, order, boneName);
}

/**
 * 2-bone IK matching Spine's runtime algorithm:
 * 1. Compute child joint angle with bendDirection (controls knee bend side)
 * 2. Derive parent rotation from child angle
 * Only modifies world transforms — localRotation stays untouched.
 */
function solveIK2(
  bones: Map<string, EditorBone>,
  order: string[],
  parentName: string,
  childName: string,
  target: EditorBone,
  mix: number,
  bendPositive: boolean,
): void {
  const parent = bones.get(parentName);
  const child = bones.get(childName);
  if (!parent || !child) return;

  const l1 = parent.length;
  const l2 = child.length;
  if (l1 <= 0 || l2 <= 0) return;

  const tx = target.worldX, ty = target.worldY;
  const px = parent.worldX, py = parent.worldY;

  let dist = Math.sqrt((tx - px) ** 2 + (ty - py) ** 2);
  dist = clamp(dist, Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);

  const aimAngle = Math.atan2(ty - py, tx - px);

  // Spine's algorithm: compute CHILD joint angle first with bendDirection,
  // then derive parent angle. This matches the Spine runtime exactly.
  const bendDir = bendPositive ? 1 : -1;
  const cosChild = clamp((dist * dist - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1);
  const childJointAngle = Math.acos(cosChild) * bendDir;

  const desiredParentWorld = (aimAngle - Math.atan2(
    l2 * Math.sin(childJointAngle),
    l1 + l2 * Math.cos(childJointAngle),
  )) * 180 / Math.PI;

  const parentDiff = normDeg(desiredParentWorld - parent.worldRotation);
  const pAdjustDeg = parentDiff * mix;
  parent.worldRotation += pAdjustDeg;
  const pAdjustRad = pAdjustDeg * Math.PI / 180;
  const pca = Math.cos(pAdjustRad), psa = Math.sin(pAdjustRad);
  const opa = parent.worldA, opb = parent.worldB, opc = parent.worldC, opd = parent.worldD;
  parent.worldA = pca * opa - psa * opc;
  parent.worldB = pca * opb - psa * opd;
  parent.worldC = psa * opa + pca * opc;
  parent.worldD = psa * opb + pca * opd;

  // Recompute child's world matrix with new parent matrix
  updateBoneWorldMatrix(child, parent);

  // Child: aim at the target
  const desiredChildWorld = Math.atan2(ty - child.worldY, tx - child.worldX) * 180 / Math.PI;
  child.worldRotation = Math.atan2(child.worldC, child.worldA) * 180 / Math.PI;
  const childDiff = normDeg(desiredChildWorld - child.worldRotation);
  const cAdjustDeg = childDiff * mix;
  child.worldRotation += cAdjustDeg;
  const cAdjustRad = cAdjustDeg * Math.PI / 180;
  const cca = Math.cos(cAdjustRad), csa = Math.sin(cAdjustRad);
  const oca2 = child.worldA, ocb2 = child.worldB, occ2 = child.worldC, ocd2 = child.worldD;
  child.worldA = cca * oca2 - csa * occ2;
  child.worldB = cca * ocb2 - csa * ocd2;
  child.worldC = csa * oca2 + cca * occ2;
  child.worldD = csa * ocb2 + cca * ocd2;

  propagateDescendants(bones, order, childName);
}

/**
 * Recompute world transforms for all descendants of a bone (not the bone itself).
 * Uses parent's world matrix to properly propagate scale.
 */
function propagateDescendants(bones: Map<string, EditorBone>, order: string[], parentBone: string): void {
  const idx = order.indexOf(parentBone);
  if (idx < 0) return;

  const dirty = new Set<string>();
  dirty.add(parentBone);

  for (let i = idx + 1; i < order.length; i++) {
    const name = order[i];
    const b = bones.get(name)!;
    if (!b.parent || !dirty.has(b.parent)) continue;

    dirty.add(name);
    const p = bones.get(b.parent)!;
    updateBoneWorldMatrix(b, p);
  }
}

export function buildSkeletonDescriptorText(skel: EditorSkeleton): string {
  const lines: string[] = ['Bone Hierarchy:'];
  function printBone(name: string, indent: number) {
    const b = skel.bones.get(name)!;
    const pad = '  '.repeat(indent);
    lines.push(`${pad}- ${b.name} [role:${b.role}] pos:(${b.localX.toFixed(1)},${b.localY.toFixed(1)}) rot:${b.localRotation.toFixed(1)}° len:${b.length.toFixed(1)}`);
    for (const child of b.children) printBone(child, indent + 1);
  }
  for (const root of skel.rootBones) printBone(root, 0);

  if (skel.ik.length > 0) {
    lines.push('\nIK Constraints:');
    for (const ik of skel.ik) {
      lines.push(`- ${ik.name}: bones=[${ik.boneNames.join(',')}] target=${ik.targetName}`);
    }
  }

  lines.push(`\nSlots: ${skel.slots.length}`);
  lines.push(`Animations: ${[...skel.animations.keys()].join(', ')}`);

  return lines.join('\n');
}
