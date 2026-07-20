// @source wb-character/src/pipelines/spine/editor/AIAnimPanel.ts
import type { EditorSkeleton, EditorAnimation } from './types';
import { buildSkeletonDescriptorText } from './SpineDataParser';
import { spineIcon, spineBtnLabel } from './spine-icons';

type GenerateMode = 'demo' | 'backend' | 'clipboard' | 'custom_api' | 'claude';
type WeaponType = 'sword' | 'gun' | 'bow' | 'staff' | 'spear' | 'fist' | 'unknown';

/* ─── World-rotation-target reference animations (skeleton-geometry-independent) ─── */
/*
 * Keyframes use WORLD rotation targets (absolute direction in Y-up coords).
 * 0°=RIGHT, 90°=UP, 180°=LEFT, 270°=DOWN.
 * At conversion time, these are transformed to local deltas using each
 * bone's actual setupWorldRotation, so the same visual motion works on
 * any skeleton regardless of bone orientations.
 *
 * 'r' = local rotation delta (for small motions where direction is irrelevant)
 * 'wr' = world rotation target (for big motions where visual direction matters)
 * 'tr' = translation (stored as fraction of skeleton height, 1.0 = full height)
 * t values are fraction of duration (0..1)
 */
type RefKF = { t: number; v: number };
type RefWorldKF = { t: number; w: number };
type RefTKF = { t: number; x: number; y: number };
interface RefBoneTimeline {
  r?: RefKF[];        // local rotation delta (geometry-dependent, for small motions)
  wr?: RefWorldKF[];  // world rotation targets (geometry-independent, for big motions)
  tr?: RefTKF[];      // translation as fraction of skeleton height
}
interface RefAnim { bones: Record<string, RefBoneTimeline> }

/*
 * Downward chop attack — arm raises overhead then swings down.
 * All world rotation targets describe a character facing RIGHT.
 * weapon_upper_arm: rest→UP(80°)→RIGHT(350°)→DOWN-FORWARD(290°)→rest
 */
const REF_ATTACK1: RefAnim = {
  bones: {
    weapon_upper_arm: { wr: [
      { t: 0, w: -1 },       // -1 = use setup (rest)
      { t: 0.18, w: 80 },    // arm raised overhead
      { t: 0.35, w: 350 },   // arm forward (mid-downswing)
      { t: 0.5, w: 290 },    // arm down-forward (strike impact)
      { t: 0.75, w: 260 },   // follow-through
      { t: 1.0, w: -1 },     // return to rest
    ]},
    weapon_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -35 }, { t: 0.5, v: -50 },
      { t: 0.75, v: -30 }, { t: 1.0, v: 0 },
    ]},
    off_upper_arm: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -20 }, { t: 0.5, v: -40 },
      { t: 0.75, v: -25 }, { t: 1.0, v: 0 },
    ]},
    off_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -15 }, { t: 0.5, v: -25 },
      { t: 0.75, v: -15 }, { t: 1.0, v: 0 },
    ]},
    hip: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -10 }, { t: 0.5, v: 18 },
      { t: 0.75, v: 12 }, { t: 1.0, v: 0 },
    ], tr: [
      { t: 0, x: 0, y: 0 }, { t: 0.18, x: -0.01, y: 0.02 },
      { t: 0.5, x: 0.04, y: -0.03 }, { t: 0.75, x: 0.03, y: -0.02 },
      { t: 1.0, x: 0, y: 0 },
    ]},
    chest: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -15 }, { t: 0.35, v: 5 },
      { t: 0.5, v: 20 }, { t: 0.75, v: 12 }, { t: 1.0, v: 0 },
    ]},
    weapon: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -20 }, { t: 0.5, v: 40 },
      { t: 0.75, v: 25 }, { t: 1.0, v: 0 },
    ]},
    head: { r: [
      { t: 0, v: 0 }, { t: 0.18, v: -8 }, { t: 0.5, v: 12 },
      { t: 0.75, v: 6 }, { t: 1.0, v: 0 },
    ]},
  },
};

/*
 * Horizontal slash — arm swings from back to front horizontally.
 * weapon_upper_arm: rest→BACK(150°)→FORWARD(350°)→rest
 */
const REF_ATTACK2: RefAnim = {
  bones: {
    weapon_upper_arm: { wr: [
      { t: 0, w: -1 },
      { t: 0.15, w: 150 },   // arm pulled back
      { t: 0.35, w: 30 },    // mid-swing (forward-up)
      { t: 0.5, w: 330 },    // slash impact (forward-down)
      { t: 0.75, w: 300 },   // follow-through
      { t: 1.0, w: -1 },
    ]},
    weapon_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 25 }, { t: 0.5, v: -30 },
      { t: 0.75, v: -15 }, { t: 1.0, v: 0 },
    ]},
    off_upper_arm: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 15 }, { t: 0.5, v: -25 },
      { t: 0.75, v: -10 }, { t: 1.0, v: 0 },
    ]},
    off_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 10 }, { t: 0.5, v: -20 },
      { t: 0.75, v: -10 }, { t: 1.0, v: 0 },
    ]},
    hip: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 12 }, { t: 0.5, v: -18 },
      { t: 0.75, v: -10 }, { t: 1.0, v: 0 },
    ]},
    chest: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 15 }, { t: 0.5, v: -20 },
      { t: 0.75, v: -8 }, { t: 1.0, v: 0 },
    ]},
    weapon: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 15 }, { t: 0.5, v: -40 },
      { t: 0.75, v: -20 }, { t: 1.0, v: 0 },
    ]},
    head: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 5 }, { t: 0.5, v: -8 },
      { t: 0.75, v: -4 }, { t: 1.0, v: 0 },
    ]},
  },
};

/*
 * Upward slash — arm swings from low to high.
 * weapon_upper_arm: rest→LOW(300°)→UP(60°)→rest
 */
const REF_ATTACK3: RefAnim = {
  bones: {
    weapon_upper_arm: { wr: [
      { t: 0, w: -1 },
      { t: 0.15, w: 300 },   // arm low (prepare)
      { t: 0.35, w: 10 },    // mid-swing (forward)
      { t: 0.5, w: 60 },     // arm high (upslash impact)
      { t: 0.75, w: 80 },    // follow-through high
      { t: 1.0, w: -1 },
    ]},
    weapon_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: -20 }, { t: 0.5, v: -40 },
      { t: 0.75, v: -25 }, { t: 1.0, v: 0 },
    ]},
    off_upper_arm: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 10 }, { t: 0.5, v: -30 },
      { t: 0.75, v: -15 }, { t: 1.0, v: 0 },
    ]},
    off_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.5, v: -15 }, { t: 1.0, v: 0 },
    ]},
    hip: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 8 }, { t: 0.5, v: -12 },
      { t: 0.75, v: -6 }, { t: 1.0, v: 0 },
    ], tr: [
      { t: 0, x: 0, y: 0 }, { t: 0.5, x: 0.03, y: 0.02 },
      { t: 1.0, x: 0, y: 0 },
    ]},
    chest: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 10 }, { t: 0.5, v: -18 },
      { t: 0.75, v: -8 }, { t: 1.0, v: 0 },
    ]},
    weapon: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 30 }, { t: 0.5, v: -50 },
      { t: 0.75, v: -25 }, { t: 1.0, v: 0 },
    ]},
    head: { r: [
      { t: 0, v: 0 }, { t: 0.15, v: 5 }, { t: 0.5, v: -10 },
      { t: 0.75, v: -5 }, { t: 1.0, v: 0 },
    ]},
  },
};

/*
 * Gun draw/aim (Attack 1) — raise arms from rest to aim forward and hold.
 * This is the preparation before shooting.
 */
const REF_GUN_ATTACK1: RefAnim = {
  bones: {
    weapon_upper_arm: { wr: [
      { t: 0, w: -1 },       // rest
      { t: 0.8, w: 350 },    // raise to aim forward
      { t: 1.0, w: 350 },    // hold
    ]},
    weapon_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.8, v: -15 }, { t: 1.0, v: -15 }
    ]},
    off_upper_arm: { wr: [
      { t: 0, w: -1 },
      { t: 0.8, w: 330 },
      { t: 1.0, w: 330 },
    ]},
    off_forearm: { r: [
      { t: 0, v: 0 }, { t: 0.8, v: -40 }, { t: 1.0, v: -40 }
    ]},
    hip: { r: [
      { t: 0, v: 0 }, { t: 0.8, v: -5 }, { t: 1.0, v: -5 }
    ]},
    chest: { r: [
      { t: 0, v: 0 }, { t: 0.8, v: 5 }, { t: 1.0, v: 5 }
    ]},
    weapon: { wr: [
      { t: 0, w: -1 },
      { t: 0.8, w: 350 },    // force weapon to point forward along aiming line
      { t: 1.0, w: 350 },
    ]},
    head: { r: [
      { t: 0, v: 0 }, { t: 0.8, v: 5 }, { t: 1.0, v: 5 }
    ]},
  },
};

/*
 * Gun shoot (Attack 2) — starts from aim pose, recoils fast, returns slow to aim.
 * Recoil: fast backward translation and upward rotation, slow recovery.
 */
const REF_GUN_ATTACK2: RefAnim = {
  bones: {
    weapon_upper_arm: { wr: [
      { t: 0, w: 350 },      // start at aim
      { t: 0.1, w: 30 },     // recoil fast UP/BACK
      { t: 1.0, w: 350 },    // recover slow to aim
    ]},
    weapon_forearm: { r: [
      { t: 0, v: -15 }, { t: 0.1, v: -30 }, { t: 1.0, v: -15 }
    ]},
    off_upper_arm: { wr: [
      { t: 0, w: 330 },
      { t: 0.1, w: 60 },     // off arm also recoils
      { t: 1.0, w: 330 },
    ]},
    off_forearm: { r: [
      { t: 0, v: -40 }, { t: 0.1, v: -60 }, { t: 1.0, v: -40 }
    ]},
    hip: { r: [
      { t: 0, v: -5 }, { t: 0.1, v: -12 }, { t: 1.0, v: -5 }
    ], tr: [
      { t: 0, x: 0, y: 0 }, 
      { t: 0.1, x: -0.04, y: 0 },   // recoil backwards fast
      { t: 1.0, x: 0, y: 0 }        // recover slow
    ]},
    chest: { r: [
      { t: 0, v: 5 }, { t: 0.1, v: 18 }, { t: 1.0, v: 5 } // lean back fast
    ]},
    weapon: { wr: [
      { t: 0, w: 350 },      // start at aim
      { t: 0.1, w: 40 },     // gun itself recoils up more
      { t: 1.0, w: 350 },    // recover
    ]},
    head: { r: [
      { t: 0, v: 5 }, { t: 0.1, v: 12 }, { t: 1.0, v: 5 }
    ]},
  },
};

const REF_IDLE: RefAnim = {
  bones: {
    hip: { r: [{ t: 0, v: 0 }, { t: 0.5, v: -2 }, { t: 1, v: 0 }],
      tr: [{ t: 0, x: 0, y: 0 }, { t: 0.5, x: 0, y: -0.005 }, { t: 1, x: 0, y: 0 }],
    },
    chest: { r: [{ t: 0, v: 0 }, { t: 0.5, v: 2 }, { t: 1, v: 0 }] },
    weapon_upper_arm: { r: [{ t: 0, v: 0 }, { t: 0.5, v: -3 }, { t: 1, v: 0 }] },
    weapon_forearm: { r: [{ t: 0, v: 0 }, { t: 0.5, v: 3 }, { t: 1, v: 0 }] },
    off_upper_arm: { r: [{ t: 0, v: 0 }, { t: 0.5, v: 2 }, { t: 1, v: 0 }] },
    off_forearm: { r: [{ t: 0, v: 0 }, { t: 0.5, v: 3 }, { t: 1, v: 0 }] },
    head: { r: [{ t: 0, v: 0 }, { t: 0.5, v: 2 }, { t: 1, v: 0 }] },
  },
};

const REF_RUN: RefAnim = {
  bones: {
    hip: {
      r: [
        { t: 0.00, v: -15.7 }, { t: 0.25, v: -11.6 }, { t: 0.50, v: -15.7 },
        { t: 0.75, v: -11.6 }, { t: 1.00, v: -15.7 },
      ],
      tr: [
        { t: 0.00, x: 0.112, y: -0.013 }, { t: 0.25, x: 0.103, y: 0.012 },
        { t: 0.50, x: 0.112, y: -0.013 }, { t: 0.75, x: 0.103, y: 0.012 },
        { t: 1.00, x: 0.112, y: -0.013 },
      ],
    },
    chest: {
      r: [
        { t: 0.00, v: 0 }, { t: 0.25, v: -5.1 }, { t: 0.50, v: 0 },
        { t: 0.75, v: -5.1 }, { t: 1.00, v: 0 },
      ],
    },
    weapon_upper_arm: {
      r: [{ t: 0.00, v: -32.2 }, { t: 0.50, v: -23.8 }, { t: 1.00, v: -32.2 }],
    },
    weapon_forearm: {
      r: [{ t: 0.00, v: 1.1 }, { t: 0.50, v: -4.8 }, { t: 1.00, v: 1.1 }],
    },
    weapon: {
      r: [{ t: 0.00, v: -42.1 }, { t: 1.00, v: -42.1 }],
    },
    off_upper_arm: {
      r: [
        { t: 0.00, v: 2.8 }, { t: 0.25, v: 61.9 }, { t: 0.75, v: -40.9 },
        { t: 1.00, v: 2.8 },
      ],
    },
    off_forearm: {
      r: [
        { t: 0.00, v: 59.7 }, { t: 0.25, v: 104.7 }, { t: 0.50, v: 92.1 },
        { t: 0.75, v: 44.1 }, { t: 1.00, v: 59.7 },
      ],
    },
    left_ik: {
      tr: [
        { t: 0.00, x: 0.019, y: 0.227 }, { t: 0.25, x: 0.333, y: 0.120 },
        { t: 0.30, x: 0.339, y: 0.073 }, { t: 0.50, x: 0.060, y: 0.018 },
        { t: 0.75, x: -0.308, y: 0.160 }, { t: 1.00, x: 0.019, y: 0.227 },
      ],
    },
    right_ik: {
      tr: [
        { t: 0.00, x: 0.027, y: -0.012 }, { t: 0.15, x: -0.204, y: 0.029 },
        { t: 0.20, x: -0.285, y: 0.144 }, { t: 0.30, x: -0.267, y: 0.214 },
        { t: 0.50, x: 0.015, y: 0.133 }, { t: 0.75, x: 0.271, y: 0.085 },
        { t: 0.85, x: 0.213, y: 0.004 }, { t: 1.00, x: 0.027, y: -0.012 },
      ],
    },
  }
};

const REF_ANIMS: Record<string, RefAnim> = {
  idle: REF_IDLE,
  run: REF_RUN,
  walk: REF_RUN,
  attack1: REF_ATTACK1,
  attack2: REF_ATTACK2,
  attack3: REF_ATTACK3,
  gun_attack1: REF_GUN_ATTACK1,
  gun_attack2: REF_GUN_ATTACK2,
};

function getRefKeyForAnim(animName: string, weaponType: WeaponType): string | null {
  const baseName = animName.toLowerCase();
  const isAttack = baseName.includes('attack') || baseName.includes('skill');
  
  if (!isAttack) {
    return baseName in REF_ANIMS ? baseName : null;
  }
  
  // Try exact weapon-specific name first (e.g. gun_attack1)
  const wtSpecific = `${weaponType}_${baseName}`;
  if (wtSpecific in REF_ANIMS) return wtSpecific;
  
  // Try exact generic name (e.g. attack1)
  if (baseName in REF_ANIMS) return baseName;
  
  // Fallback to weapon's first attack
  const wtFallback = `${weaponType}_attack1`;
  if (wtFallback in REF_ANIMS) return wtFallback;
  
  // Final fallback to generic attack1
  return 'attack1' in REF_ANIMS ? 'attack1' : null;
}

/**
 * Compute a skeleton-agnostic size metric for translation scaling.
 * Uses the overall bounding height of all bones in world space.
 * Falls back to bone-length sum or a default if world transforms aren't available.
 */
const REF_SKELETON_HEIGHT = 486; // dz_g.json declared height
function getSkeletonHeight(skeleton: EditorSkeleton): number {
  let minY = Infinity, maxY = -Infinity;
  let hasWorld = false;
  for (const [, bone] of skeleton.bones) {
    const y = bone.worldY;
    if (y !== 0 || bone.worldX !== 0) hasWorld = true;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (hasWorld && maxY - minY > 10) return maxY - minY;
  // Fallback: accumulate bone lengths from root down the longest chain
  let totalLen = 0;
  for (const [, bone] of skeleton.bones) totalLen += bone.length;
  if (totalLen > 10) return totalLen * 0.4;
  return REF_SKELETON_HEIGHT; // absolute fallback = no scaling
}

/**
 * Map reference template roles to actual bone names in the current skeleton,
 * then produce a complete JSON string usable as few-shot example.
 */
function buildFewShotJSON(
  skeleton: EditorSkeleton, refAnim: RefAnim,
  animName: string, duration: number,
): string | null {
  const roleMap = new Map<string, string>();

  // Detect which arm has the weapon attached
  let weaponArmSide: 'left' | 'right' | null = null;
  for (const [bname, bone] of skeleton.bones) {
    if (bone.role === 'weapon') {
      let parent = bone.parent;
      while (parent) {
        const pb = skeleton.bones.get(parent);
        if (!pb) break;
        if (pb.role === 'upper_arm' || pb.role === 'forearm') {
          weaponArmSide = (parent.includes('_l') || parent.includes('_f') || parent.includes('left') || parent.includes('左')) ? 'left' : 'right';
          break;
        }
        parent = pb.parent;
      }
      break;
    }
  }

  for (const [bname, bone] of skeleton.bones) {
    if (!bone.role || bone.role === 'unknown' || bone.role === 'root') continue;
    const isLeft = bname.includes('_l') || bname.includes('_f') || bname.includes('left') || bname.includes('左')
      || bname.includes('Left') || bname.includes('l_');
    const r = bone.role;
    const isWeaponSide = weaponArmSide
      ? (weaponArmSide === 'left' ? isLeft : !isLeft)
      : isLeft; // default: left is weapon side (common in game templates)
    if (r === 'upper_arm' && isWeaponSide) roleMap.set('weapon_upper_arm', bname);
    else if (r === 'upper_arm' && !isWeaponSide) roleMap.set('off_upper_arm', bname);
    else if (r === 'forearm' && isWeaponSide) roleMap.set('weapon_forearm', bname);
    else if (r === 'forearm' && !isWeaponSide) roleMap.set('off_forearm', bname);
    else if (r === 'upper_leg' || r === 'thigh') {
      if (isLeft && !roleMap.has('left_thigh')) roleMap.set('left_thigh', bname);
      else if (!isLeft && !roleMap.has('right_thigh')) roleMap.set('right_thigh', bname);
    } else if (r === 'lower_leg' || r === 'shin') {
      if (isLeft && !roleMap.has('left_shin')) roleMap.set('left_shin', bname);
      else if (!isLeft && !roleMap.has('right_shin')) roleMap.set('right_shin', bname);
    } else if ((r === 'hip' || r === 'spine') && !roleMap.has('hip')) roleMap.set('hip', bname);
    else if (r === 'chest' && !roleMap.has('chest')) roleMap.set('chest', bname);
    else if (r === 'weapon' && !roleMap.has('weapon')) roleMap.set('weapon', bname);
    else if (r === 'head' && !roleMap.has('head')) roleMap.set('head', bname);
  }

  // Map IK targets for legs if present
  for (const ik of skeleton.ik) {
    if (ik.boneNames.length > 0) {
      const firstBone = skeleton.bones.get(ik.boneNames[0]);
      if (firstBone) {
        const isLeft = firstBone.name.includes('_l') || firstBone.name.includes('_f') || firstBone.name.includes('left') || firstBone.name.includes('左')
            || firstBone.name.includes('Left') || firstBone.name.includes('l_');
        if (firstBone.role === 'thigh' || firstBone.role === 'shin' || firstBone.role === 'upper_leg') {
            if (isLeft) roleMap.set('left_ik', ik.targetName);
            else roleMap.set('right_ik', ik.targetName);
        }
      }
    }
  }

  const skelHeight = getSkeletonHeight(skeleton);

  const reverseRoleMap = new Map<string, string>();
  for (const [r, b] of roleMap.entries()) reverseRoleMap.set(b, r);

  const boneTimelines: Record<string, any> = {};
  let mapped = 0;
  const interpR = (rotTimeline: any[] | undefined, t: number) => {
    if (!rotTimeline || rotTimeline.length === 0) return 0;
    if (rotTimeline.length === 1) return rotTimeline[0].value;
    if (t <= rotTimeline[0].time) return rotTimeline[0].value;
    if (t >= rotTimeline[rotTimeline.length - 1].time) return rotTimeline[rotTimeline.length - 1].value;
    for (let i = 0; i < rotTimeline.length - 1; i++) {
      const a = rotTimeline[i], b = rotTimeline[i + 1];
      if (t >= a.time && t <= b.time) {
        const frac = (b.time - a.time) > 0 ? (t - a.time) / (b.time - a.time) : 0;
        return a.value + (b.value - a.value) * frac;
      }
    }
    return 0;
  };

  const getParentAnimWorld = (boneName: string, t: number): number => {
    const b = skeleton.bones.get(boneName);
    if (!b || !b.parent) return 0;
    let world = 0;
    let curr: string | null = b.parent;
    const chain: string[] = [];
    while (curr) {
      chain.push(curr);
      curr = skeleton.bones.get(curr)?.parent ?? null;
    }
    chain.reverse(); // root to direct parent
    for (const pName of chain) {
      const pb = skeleton.bones.get(pName)!;
      const pt = boneTimelines[pName];
      const delta = pt?.rotate ? interpR(pt.rotate, t) : 0;
      world += pb.setupRotation + delta;
    }
    return world;
  };

  for (const boneName of skeleton.boneOrder) {
    const refRole = reverseRoleMap.get(boneName);
    if (!refRole) continue;
    const tl = refAnim.bones[refRole];
    if (!tl) continue;
    
    const bone = skeleton.bones.get(boneName)!;
    mapped++;
    const entry: any = {};

    if (tl.wr) {
      // World rotation targets → direction-preserving local deltas.
      // Must account for the fact that parent's world rotation is ALSO animating!
      let prevWorld = bone.worldRotation;
      let accumulatedLocal = 0;
      entry.rotate = tl.wr.map(k => {
        const targetWorld = k.w === -1 ? bone.worldRotation : k.w;
        const animTime = +(k.t * duration).toFixed(3);
        
        // Find what the parent's world rotation is at this exact animation time
        const parentAnimWorld = getParentAnimWorld(boneName, animTime);
        // The local rotation needed to achieve targetWorld:
        const requiredLocal = targetWorld - parentAnimWorld;
        // The delta from setup local rotation:
        const requiredDelta = requiredLocal - bone.setupRotation;
        
        // Ensure we take the shortest arc from the previous delta state
        let jump = requiredDelta - accumulatedLocal;
        while (jump > 180) jump -= 360;
        while (jump <= -180) jump += 360;
        accumulatedLocal += jump;
        
        return { time: animTime, value: +accumulatedLocal.toFixed(1) };
      });
    } else if (tl.r) {
      entry.rotate = tl.r.map(k => ({
        time: +(k.t * duration).toFixed(3),
        value: +k.v.toFixed(1),
      }));
    }

    if (tl.tr) {
      // Translations stored as fraction of skeleton height
      entry.translate = tl.tr.map(k => ({
        time: +(k.t * duration).toFixed(3),
        x: +(k.x * skelHeight).toFixed(1),
        y: +(k.y * skelHeight).toFixed(1),
      }));
    }
    
    // Add the entry to the boneTimelines using the original boneName
    boneTimelines[boneName] = entry;
  }

  if (mapped < 3) return null;

  return JSON.stringify({
    name: animName,
    duration,
    boneTimelines,
  }, null, 2);
}

/**
 * Build a reference-based animation from template data for the demo generator.
 * Returns an EditorAnimation using the actual bone names.
 */
function buildAnimFromRef(
  skeleton: EditorSkeleton, refAnim: RefAnim,
  animName: string, duration: number,
): EditorAnimation | null {
  const json = buildFewShotJSON(skeleton, refAnim, animName, duration);
  if (!json || json.startsWith('/* ERROR')) {
    console.error("buildAnimFromRef failed:", json);
    return null;
  }
  try {
    const parsed = JSON.parse(json);
    // fixLargeRotations inserts intermediate keyframes for world→local jumps >100°
    return fixLargeRotations({
      name: parsed.name,
      duration: parsed.duration,
      boneTimelines: parsed.boneTimelines,
    });
  } catch (err) {
    console.error("buildAnimFromRef parse error:", err, json);
    return null;
  }
}

const WEAPON_KEYWORDS: Record<WeaponType, string[]> = {
  sword: ['刀', '剑', '斧', '大剑', '太刀', '匕首', '武士', '剑士', '战士', '刺客', '盗贼', '忍者',
          'sword', 'blade', 'axe', 'dagger', 'warrior', 'knight', 'assassin', 'rogue', 'ninja', 'samurai', 'saber'],
  gun: ['枪', '手枪', '步枪', '火枪', '机枪', '狙击', '炮',
        'gun', 'rifle', 'pistol', 'shooter', 'gunner', 'sniper', 'musket'],
  bow: ['弓', '弩', '弓箭', '猎手', '射手', '游侠',
        'bow', 'archer', 'crossbow', 'ranger', 'hunter'],
  staff: ['法杖', '魔法', '法师', '巫师', '魔导', '术士', '牧师', '祭司',
          'staff', 'mage', 'wizard', 'magic', 'sorcerer', 'priest', 'healer', 'caster'],
  spear: ['矛', '长枪', '戟', '薙刀', '枪兵', '龙骑',
          'spear', 'lance', 'halberd', 'polearm', 'lancer', 'dragoon', 'pike'],
  fist: ['拳', '格斗', '武僧', '拳击', '空手', '搏击',
         'fist', 'monk', 'martial', 'unarmed', 'brawler', 'pugilist', 'fighter'],
  unknown: [],
};

function detectWeaponType(concept: string): WeaponType {
  const lower = concept.toLowerCase();
  let best: WeaponType = 'unknown';
  let bestScore = 0;
  for (const [wt, keywords] of Object.entries(WEAPON_KEYWORDS) as [WeaponType, string[]][]) {
    if (wt === 'unknown') continue;
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) { bestScore = score; best = wt; }
  }
  return best;
}

const WEAPON_LABELS: Record<WeaponType, string> = {
  sword: '近战刀剑',
  gun: '远程枪械',
  bow: '远程弓弩',
  staff: '魔法法杖',
  spear: '长柄武器',
  fist: '近战拳脚',
  unknown: '未知类型',
};

const WEAPON_ATTACK_PROMPTS: Record<WeaponType, string> = {
  sword: `Melee sword combo attack. ARM does the big arc (200-350°), weapon bone barely rotates (±30-70°). Follow the reference animation closely.`,
  gun: `Ranged SHOOTING attack. DO NOT lower arms back to idle at the end! Keep arms raised in aiming pose for continuous shooting combos. Recoil should be FAST up/back, then SLOW recover to aim. Follow the reference animation closely.`,
  bow: `Ranged BOW attack. Pull string arm back, keep front arm steady. Release string fast, follow-through. Return to idle.`,
  staff: `Magic CASTING attack. Raise staff, thrust forward forcefully to cast, arms spread briefly. Return to idle.`,
  spear: `THRUST attack with polearm. Pull back, fast linear forward thrust (translation is key). Return to idle.`,
  fist: `PUNCH attack. Hip rotates first, then torso, then shoulder, then arm extends (kinetic chain). Fast retract.`,
  unknown: `Generic melee attack. Wind-up, fast strike, follow-through, return to idle.`,
};

function getWeaponAwarePrompt(basePrompt: string, wt: WeaponType, animId: string): string {
  if (animId === 'attack' || animId.includes('attack') || animId.includes('skill')) {
    return WEAPON_ATTACK_PROMPTS[wt] || basePrompt;
  }
  if (animId === 'idle' && wt === 'gun') {
    return 'Idle stance for a gunner. Weapon arm holds gun at side or across chest, support arm ready. Subtle breathing, slight weight shifting between feet. Loop seamlessly.';
  }
  if (animId === 'idle' && wt === 'bow') {
    return 'Idle stance for an archer. Bow arm holds bow at side, string arm hangs naturally. Alert posture. Subtle breathing. Loop seamlessly.';
  }
  if (animId === 'idle' && wt === 'staff') {
    return 'Idle stance for a mage. Staff-holding arm keeps staff upright at side, other arm relaxed. Ethereal subtle sway. Loop seamlessly.';
  }
  return basePrompt;
}

const PRESETS: { id: string; name: string; prompt: string; duration: number }[] = [
  { id: 'idle', name: '待机 (Idle)', prompt: 'Subtle idle/breathing. Chest rises and falls gently, minor head bob, soft arm sway. Loop seamlessly. Keep motion small and natural.', duration: 1.2 },
  { id: 'walk', name: '走路 (Walk)', prompt: 'Walk cycle. Left and right legs alternate, arms swing opposite to legs, slight torso lean forward, head stays level. Loop seamlessly.', duration: 0.8 },
  { id: 'run', name: '跑步 (Run)', prompt: 'Run cycle. Wider stride, more forward lean, exaggerated arm pump, knees lift higher, faster cadence. Loop seamlessly.', duration: 0.6 },
  { id: 'attack1', name: '攻击1 (Combo Hit 1)', prompt: '[auto-adapted by weapon type] First hit in combo — quick overhead chop/slash. Upper arm raises up ~200° then chops down. Non-looping.', duration: 0.35 },
  { id: 'attack2', name: '攻击2 (Combo Hit 2)', prompt: '[auto-adapted by weapon type] Second combo hit — side diagonal slash from different angle. Upper arm arcs ~250°. Non-looping.', duration: 0.35 },
  { id: 'attack3', name: '攻击3 (Combo Hit 3)', prompt: '[auto-adapted by weapon type] Third combo hit — rising backslash or spinning slash. Reverse direction arc. Non-looping.', duration: 0.4 },
  { id: 'attack4', name: '攻击4 (Combo Hit 4)', prompt: '[auto-adapted by weapon type] Final heavy combo hit — massive downward slam. Full ~350° arm arc. Dramatic impact. Non-looping.', duration: 0.5 },
  { id: 'hit', name: '受击 (Hit)', prompt: 'Hit reaction. Quick backward lean with head snap, brief stagger, then recover to neutral. Non-looping.', duration: 0.3 },
  { id: 'jump', name: '跳跃 (Jump)', prompt: 'Jump sequence. Crouch anticipation (bend knees), launch upward (extend legs, raise arms), airborne (tuck legs), land (crouch on impact), stand. Non-looping.', duration: 0.7 },
  { id: 'dodge', name: '闪避 (Dodge)', prompt: 'Quick dodge/dash. Lean sharply to one side, arms trail behind, legs push off. Fast recovery. Non-looping.', duration: 0.4 },
  { id: 'death', name: '死亡 (Death)', prompt: 'Death collapse. Stagger backward, knees buckle, torso falls forward, arms go limp, end lying on ground. Non-looping.', duration: 1.0 },
];

/**
 * Post-process animation to fix the >180° rotation shortcut problem.
 * When two consecutive keyframes differ by more than MAX_DELTA degrees,
 * the interpolation engine takes the "short path" (wrong direction).
 * This function inserts intermediate keyframes to force the intended direction.
 */
function fixLargeRotations(anim: EditorAnimation): EditorAnimation {
  const MAX_DELTA = 100;
  const result: EditorAnimation = {
    name: anim.name,
    duration: anim.duration,
    boneTimelines: {},
  };

  for (const [boneName, tl] of Object.entries(anim.boneTimelines)) {
    const fixed = { ...tl };

    if (tl.rotate && tl.rotate.length >= 2) {
      const newRotate: { time: number; value: number }[] = [tl.rotate[0]];

      for (let i = 1; i < tl.rotate.length; i++) {
        const prev = tl.rotate[i - 1];
        const curr = tl.rotate[i];
        const delta = curr.value - prev.value;

        if (Math.abs(delta) > MAX_DELTA) {
          const segments = Math.ceil(Math.abs(delta) / MAX_DELTA);
          const stepTime = (curr.time - prev.time) / segments;
          const stepValue = delta / segments;

          for (let s = 1; s < segments; s++) {
            newRotate.push({
              time: +(prev.time + stepTime * s).toFixed(4),
              value: +(prev.value + stepValue * s).toFixed(2),
            });
          }
        }

        newRotate.push(curr);
      }

      fixed.rotate = newRotate;
    }

    result.boneTimelines[boneName] = fixed;
  }

  return result;
}

async function callLLM(prompt: string, baseUrl: string, apiKey: string, model?: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  if (!resp.ok) throw new Error(`LLM API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callBackendProxy(prompt: string): Promise<string> {
  const BASE = (import.meta as any).env?.BASE_URL || '/';
  const apiBase = BASE.replace(/\/dev\/[^/]+\/$/, '');
  const resp = await fetch(`${apiBase}/api/llm/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 8000,
    }),
  });
  if (!resp.ok) throw new Error(`Backend proxy ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? data.content ?? '';
}

async function callClaudeLocal(prompt: string): Promise<string> {
  const resp = await fetch('/__ce-api__/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: prompt },
      ],
      maxTokens: 16000,
    }),
  });
  if (!resp.ok) throw new Error(`Claude API HTTP ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  if (data.success === false) {
    throw new Error(data.error || 'Claude API 返回错误');
  }
  if (data.content && Array.isArray(data.content)) {
    return data.content.map((c: any) => c.text || '').join('');
  }
  const text = data.text ?? data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('Claude 返回了空内容');
  return text;
}

const SYSTEM_PROMPT = `You are a Spine 2D animation data generator. Output ONLY valid JSON.

RULES:
1. Output valid JSON only — no markdown, no explanation, no comments
2. Rotation in degrees, translation in Spine units, all relative to setup pose (0 = default)
3. Rotation interpolation takes SHORTEST ARC. For arcs >100°, insert intermediate keyframes every 80°
4. Looping animations: first keyframe values = last keyframe values
5. When a REFERENCE ANIMATION is provided in the user message, use it as your baseline and generate a close variation`;

export class AIAnimPanel {
  private root: HTMLDivElement;
  private skeleton: EditorSkeleton | null = null;
  private resultArea!: HTMLDivElement;
  private promptInput!: HTMLTextAreaElement;
  private nameInput!: HTMLInputElement;
  private conceptInput!: HTMLInputElement;
  private weaponBadge!: HTMLSpanElement;
  private presetGrid!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private progressEl!: HTMLDivElement;
  private modeSelect!: HTMLSelectElement;
  private customApiSection!: HTMLDivElement;
  private llmUrlInput!: HTMLInputElement;
  private llmKeyInput!: HTMLInputElement;
  private modelInput!: HTMLInputElement;
  private animListEl!: HTMLDivElement;
  private isGenerating = false;
  private weaponType: WeaponType = 'unknown';

  onAnimationGenerated: ((anim: EditorAnimation) => void) | null = null;
  onAnimationDeleted: ((name: string) => void) | null = null;
  onAnimationSelected: ((name: string) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'se-ai-panel';
    container.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'se-panel-header';
    header.textContent = 'AI 动画生成器';
    this.root.appendChild(header);

    this.buildCharacterConcept();
    this.buildModeSelector();
    this.buildPresets();
    this.buildNameInput();
    this.buildPromptArea();
    this.buildStatus();
    this.buildAnimList();
  }

  private buildCharacterConcept(): void {
    const section = document.createElement('div');
    section.className = 'se-ai-concept-section';
    this.root.appendChild(section);

    const label = document.createElement('div');
    label.className = 'se-ai-label';
    label.textContent = '角色设定:';
    section.appendChild(label);

    const row = document.createElement('div');
    row.className = 'se-ai-concept-row';
    section.appendChild(row);

    this.conceptInput = document.createElement('input');
    this.conceptInput.className = 'se-ai-concept-input';
    this.conceptInput.type = 'text';
    this.conceptInput.placeholder = '如：暗黑射手、武士、冰系法师、双刀刺客...';
    this.conceptInput.value = localStorage.getItem('se-ai-concept') ?? '';
    row.appendChild(this.conceptInput);

    this.weaponBadge = document.createElement('span');
    this.weaponBadge.className = 'se-ai-weapon-badge';
    row.appendChild(this.weaponBadge);

    const hint = document.createElement('div');
    hint.className = 'se-ai-concept-hint';
    hint.textContent = '输入角色名称/类型后，攻击等动画提示词会自动适配武器风格（刀剑挥砍 vs 弓箭射击 vs 法杖施法...）';
    section.appendChild(hint);

    const updateWeapon = () => {
      const val = this.conceptInput.value.trim();
      localStorage.setItem('se-ai-concept', val);
      this.weaponType = val ? detectWeaponType(val) : 'unknown';
      if (this.weaponType !== 'unknown') {
        this.weaponBadge.textContent = WEAPON_LABELS[this.weaponType];
        this.weaponBadge.style.display = 'inline-block';
      } else {
        this.weaponBadge.style.display = val ? 'inline-block' : 'none';
        this.weaponBadge.textContent = val ? '通用' : '';
      }
    };

    this.conceptInput.addEventListener('input', updateWeapon);
    updateWeapon();
  }

  private buildModeSelector(): void {
    const section = document.createElement('div');
    section.className = 'se-ai-llm-config';
    this.root.appendChild(section);

    const label = document.createElement('div');
    label.className = 'se-ai-label';
    label.textContent = '生成方式:';
    section.appendChild(label);

    this.modeSelect = document.createElement('select');
    this.modeSelect.className = 'se-ai-input';
    this.modeSelect.innerHTML = `
      <option value="claude">Claude Opus（本地服务端调用，推荐）</option>
      <option value="demo">演示模式（内置动画模板，无需配置）</option>
      <option value="backend">后端代理（使用服务器 API Key）</option>
      <option value="clipboard">复制提示词（复制后在 Cursor 中让 AI 生成）</option>
      <option value="custom_api">自定义 API（自行配置，Key 存本地）</option>
    `;
    this.modeSelect.value = localStorage.getItem('se-ai-mode') ?? 'claude';
    this.modeSelect.addEventListener('change', () => {
      localStorage.setItem('se-ai-mode', this.modeSelect.value);
      this.updateModeUI();
    });
    section.appendChild(this.modeSelect);

    const modeDesc = document.createElement('div');
    modeDesc.className = 'se-ai-mode-desc';
    modeDesc.id = 'se-ai-mode-desc';
    section.appendChild(modeDesc);

    this.customApiSection = document.createElement('div');
    this.customApiSection.className = 'se-ai-custom-api';
    section.appendChild(this.customApiSection);

    this.llmUrlInput = document.createElement('input');
    this.llmUrlInput.className = 'se-ai-input';
    this.llmUrlInput.placeholder = 'Base URL (如 https://api.openai.com)';
    this.llmUrlInput.value = localStorage.getItem('se-llm-url') ?? '';
    this.llmUrlInput.addEventListener('change', () => localStorage.setItem('se-llm-url', this.llmUrlInput.value));
    this.customApiSection.appendChild(this.llmUrlInput);

    this.llmKeyInput = document.createElement('input');
    this.llmKeyInput.className = 'se-ai-input';
    this.llmKeyInput.type = 'password';
    this.llmKeyInput.placeholder = 'API Key（仅存储在浏览器本地）';
    this.llmKeyInput.value = localStorage.getItem('se-llm-key') ?? '';
    this.llmKeyInput.addEventListener('change', () => localStorage.setItem('se-llm-key', this.llmKeyInput.value));
    this.customApiSection.appendChild(this.llmKeyInput);

    this.modelInput = document.createElement('input');
    this.modelInput.className = 'se-ai-input';
    this.modelInput.placeholder = '模型名称（默认 gemini-2.0-flash）';
    this.modelInput.value = localStorage.getItem('se-llm-model') ?? '';
    this.modelInput.addEventListener('change', () => localStorage.setItem('se-llm-model', this.modelInput.value));
    this.customApiSection.appendChild(this.modelInput);

    const secNote = document.createElement('div');
    secNote.className = 'se-ai-sec-note';
    secNote.textContent = '提示：API Key 仅存储在浏览器 localStorage 中（明文），不会上传服务器。但页面内 JS 可访问，请注意安全。';
    this.customApiSection.appendChild(secNote);

    this.updateModeUI();
  }

  private updateModeUI(): void {
    const mode = this.modeSelect.value as GenerateMode;
    this.customApiSection.style.display = mode === 'custom_api' ? 'block' : 'none';
    const desc = this.root.querySelector('#se-ai-mode-desc') as HTMLDivElement;
    if (desc) {
      const descs: Record<GenerateMode, string> = {
        demo: '使用内置的运动学模板生成动画，质量有限但无需任何配置。',
        backend: '通过 VAG 后端服务器代理调用 LLM，API Key 安全存储在服务端。',
        clipboard: '构建完整的提示词并复制到剪贴板，你可以粘贴给 Cursor Agent 让它帮你生成动画 JSON。',
        custom_api: '直接从浏览器调用你自己的 LLM API。Key 存在浏览器本地。',
        claude: '通过 Claude API 生成动画，支持高质量的自然语言动作描述。',
      };
      desc.textContent = descs[mode];
    }
  }

  private buildPresets(): void {
    this.presetGrid = document.createElement('div');
    this.presetGrid.className = 'se-ai-presets';
    this.refreshPresets();
    this.root.appendChild(this.presetGrid);
  }

  private refreshPresets(): void {
    this.presetGrid.innerHTML = '';
    for (const p of PRESETS) {
      const hasBuiltIn = this.skeleton?.animations.has(p.id) ?? false;
      const refKey = getRefKeyForAnim(p.id, this.weaponType);
      const hasRef = refKey !== null;
      const wrapper = document.createElement('div');
      wrapper.className = 'se-ai-preset-wrapper';

      const btn = document.createElement('button');
      btn.className = 'se-ai-preset-btn' + (hasRef ? ' has-ref' : '') + (hasBuiltIn ? ' has-builtin' : '');
      btn.textContent = hasBuiltIn ? `${p.name} (内置)` : p.name;
      btn.title = hasBuiltIn
        ? '骨骼自带此动画，点击直接加载'
        : (hasRef ? '点击填入提示词，或使用右侧按钮直接从模板生成' : '点击填入提示词');
      btn.addEventListener('click', () => {
        if (hasBuiltIn) {
          this.loadBuiltInAnimation(p.id);
        } else {
          this.usePreset(p);
        }
      });
      wrapper.appendChild(btn);

      if (hasRef && !hasBuiltIn) {
        const quickBtn = document.createElement('button');
        quickBtn.className = 'se-ai-quick-gen-btn';
        quickBtn.innerHTML = spineIcon('thumbsUp', 'spine-icon-svg se-ai-recommend-svg');
        quickBtn.title = '推荐模板生成（基于专业参考数据）';
        quickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.quickGenerateFromTemplate(p);
        });
        wrapper.appendChild(quickBtn);
      }

      this.presetGrid.appendChild(wrapper);
    }
  }

  private loadBuiltInAnimation(animId: string): void {
    if (!this.skeleton) return;
    const anim = this.skeleton.animations.get(animId);
    if (!anim) return;
    this.onAnimationGenerated?.(anim);
    this.statusEl.textContent = `已加载内置动画「${animId}」(${Object.keys(anim.boneTimelines).length} 根骨骼)`;
    this.statusEl.className = 'se-ai-status success';
  }

  private quickGenerateFromTemplate(preset: typeof PRESETS[0]): void {
    if (!this.skeleton) {
      this.statusEl.textContent = '未加载骨骼，请先从模板库选择一个骨架。';
      return;
    }
    const refKey = getRefKeyForAnim(preset.id, this.weaponType);
    if (!refKey) return;
    const refAnim = REF_ANIMS[refKey];
    if (!refAnim) return;

    const name = preset.id;
    const dur = preset.duration;

    // Check name collision
    if (this.skeleton.animations.has(name)) {
      if (!confirm(`动画 "${name}" 已存在，是否覆盖？`)) return;
    }

    const json = buildFewShotJSON(this.skeleton, refAnim, name, dur);
    if (!json || json.startsWith('/* ERROR')) {
      console.error("buildAnimFromRef failed:", json);
      this.statusEl.textContent = '模板生成失败: 无法将骨骼映射到动画。';
      this.statusEl.className = 'se-ai-status';
      return;
    }
    const parsed = JSON.parse(json);
    // fixLargeRotations inserts intermediate keyframes for world→local jumps >100°
    const fixedAnim = fixLargeRotations({
      name: parsed.name,
      duration: parsed.duration,
      boneTimelines: parsed.boneTimelines,
    });
    const boneCount = Object.keys(fixedAnim.boneTimelines).length;

    if (boneCount < 2) {
      this.statusEl.textContent = '骨骼角色映射不足（需要更多骨骼标识为 upper_arm/hip/chest 等角色）。无法从模板生成。';
      this.statusEl.className = 'se-ai-status';
      return;
    }

    this.statusEl.textContent = `模板生成完成：「${preset.name}」→ ${boneCount} 根骨骼，基于专业参考数据。`;
    this.statusEl.className = 'se-ai-status success';
    this.nameInput.value = name;
    this.resultArea.innerHTML = '';
    this.showResult(fixedAnim);
  }

  private buildNameInput(): void {
    const nameLabel = document.createElement('div');
    nameLabel.className = 'se-ai-label';
    nameLabel.textContent = '动画名称:';
    this.root.appendChild(nameLabel);

    this.nameInput = document.createElement('input');
    this.nameInput.className = 'se-ai-name-input';
    this.nameInput.type = 'text';
    this.nameInput.placeholder = '如 idle, walk, attack（预设按钮会自动填入）';
    this.root.appendChild(this.nameInput);
  }

  private buildPromptArea(): void {
    const promptLabel = document.createElement('div');
    promptLabel.className = 'se-ai-label';
    promptLabel.textContent = '动画描述:';
    this.root.appendChild(promptLabel);

    this.promptInput = document.createElement('textarea');
    this.promptInput.className = 'se-ai-prompt';
    this.promptInput.rows = 4;
    this.promptInput.placeholder = '描述你要生成的动画效果（英文效果更好）...';
    this.root.appendChild(this.promptInput);

    const btnRow = document.createElement('div');
    btnRow.className = 'se-ai-btn-row';
    this.root.appendChild(btnRow);

    const genBtn = document.createElement('button');
    genBtn.className = 'se-ai-gen-btn';
    genBtn.innerHTML = spineBtnLabel('rocket', '生成动画');
    genBtn.addEventListener('click', () => this.generate());
    btnRow.appendChild(genBtn);

    const importBtn = document.createElement('button');
    importBtn.className = 'se-ai-import-btn';
    importBtn.innerHTML = spineBtnLabel('upload', '导入动画 JSON');
    importBtn.addEventListener('click', () => this.importAnimJson());
    btnRow.appendChild(importBtn);
  }

  private buildStatus(): void {
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'se-ai-status';
    this.root.appendChild(this.statusEl);

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'se-ai-progress';
    this.progressEl.innerHTML = '<div class="se-ai-progress-bar"></div>';
    this.root.appendChild(this.progressEl);

    this.resultArea = document.createElement('div');
    this.resultArea.className = 'se-ai-result';
    this.root.appendChild(this.resultArea);
  }

  private setGeneratingState(active: boolean): void {
    this.isGenerating = active;
    if (this.progressEl) this.progressEl.classList.toggle('active', active);
  }

  private buildAnimList(): void {
    this.animListEl = document.createElement('div');
    this.animListEl.className = 'se-ai-anim-list';
    this.root.appendChild(this.animListEl);
  }

  refreshAnimList(): void {
    if (!this.animListEl) return;
    this.animListEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'se-ai-anim-list-header';
    header.textContent = '已有动画';
    this.animListEl.appendChild(header);

    if (!this.skeleton || this.skeleton.animations.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'se-ai-anim-empty';
      empty.textContent = '暂无动画，点击预设或生成添加';
      this.animListEl.appendChild(empty);
      return;
    }

    for (const [name, anim] of this.skeleton.animations) {
      const row = document.createElement('div');
      row.className = 'se-ai-anim-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'se-ai-anim-name';
      nameEl.textContent = name;
      row.appendChild(nameEl);

      const dur = document.createElement('span');
      dur.className = 'se-ai-anim-dur';
      dur.textContent = `${anim.duration.toFixed(1)}s`;
      row.appendChild(dur);

      const boneCount = document.createElement('span');
      boneCount.className = 'se-ai-anim-dur';
      boneCount.textContent = `${Object.keys(anim.boneTimelines).length}骨`;
      row.appendChild(boneCount);

      const playBtn = document.createElement('button');
      playBtn.className = 'se-ai-anim-btn';
      playBtn.innerHTML = spineIcon('play', 'spine-icon-svg se-ai-anim-svg');
      playBtn.title = '播放';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onAnimationSelected?.(name);
      });
      row.appendChild(playBtn);

      const renameBtn = document.createElement('button');
      renameBtn.className = 'se-ai-anim-btn';
      renameBtn.innerHTML = spineIcon('paint', 'spine-icon-svg se-ai-anim-svg');
      renameBtn.title = '重命名';
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renameAnimation(name);
      });
      row.appendChild(renameBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'se-ai-anim-btn se-ai-anim-del';
      delBtn.innerHTML = spineIcon('trash', 'spine-icon-svg se-ai-anim-svg');
      delBtn.title = '删除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`删除动画 "${name}"？`)) {
          this.onAnimationDeleted?.(name);
        }
      });
      row.appendChild(delBtn);

      row.addEventListener('click', () => {
        this.onAnimationSelected?.(name);
      });

      this.animListEl.appendChild(row);
    }
  }

  private renameAnimation(oldName: string): void {
    if (!this.skeleton) return;
    const newName = prompt('新名称:', oldName);
    if (!newName || newName === oldName) return;
    const anim = this.skeleton.animations.get(oldName);
    if (!anim) return;
    if (this.skeleton.animations.has(newName)) {
      if (!confirm(`动画 "${newName}" 已存在，是否覆盖？`)) return;
    }
    this.skeleton.animations.delete(oldName);
    anim.name = newName;
    this.skeleton.animations.set(newName, anim);
    this.onAnimationGenerated?.(anim);
  }

  setSkeleton(skel: EditorSkeleton): void {
    this.skeleton = skel;
    if (this.presetGrid) this.refreshPresets();
  }

  setCharacterConcept(desc: string, profession?: string): void {
    if (!desc && !profession) return;
    const val = desc || (profession === 'ranged' ? '远程射手' : '近战战士');
    if (this.conceptInput && !this.conceptInput.value.trim()) {
      this.conceptInput.value = val;
      this.conceptInput.dispatchEvent(new Event('input'));
    }
  }

  private usePreset(preset: typeof PRESETS[0]): void {
    this.nameInput.value = preset.id;
    const adaptedPrompt = getWeaponAwarePrompt(preset.prompt, this.weaponType, preset.id);
    this.promptInput.value = adaptedPrompt;
    const refKey = getRefKeyForAnim(preset.id, this.weaponType);
    const hasRef = refKey !== null;
    const weaponInfo = this.weaponType !== 'unknown' ? ` (${WEAPON_LABELS[this.weaponType]}风格)` : '';
    if (hasRef) {
      this.statusEl.textContent = `预设「${preset.name}」${weaponInfo} — 推荐使用"Demo生成"模式，内置专业参考模板。`;
    } else {
      this.statusEl.textContent = `已填入预设「${preset.name}」${weaponInfo}，可修改后点击"生成动画"。`;
    }
    this.statusEl.className = 'se-ai-status';
  }

  private async generate(): Promise<void> {
    if (!this.skeleton) {
      this.statusEl.textContent = '未加载骨骼，请先从模板库选择一个骨架。';
      return;
    }
    const prompt = this.promptInput.value.trim();
    if (!prompt) {
      this.statusEl.textContent = '请输入提示词或点击上方预设按钮。';
      return;
    }
    if (this.isGenerating) {
      this.statusEl.textContent = '⏳ 正在生成中，请等待完成...';
      return;
    }

    const rawName = this.nameInput.value.trim();
    let name = rawName || `anim_${Date.now()}`;

    if (this.skeleton.animations.has(name)) {
      const action = confirm(`动画 "${name}" 已存在。\n\n确定 = 覆盖，取消 = 自动重命名`);
      if (!action) {
        let i = 2;
        while (this.skeleton.animations.has(`${rawName || 'anim'}_${i}`)) i++;
        name = `${rawName || 'anim'}_${i}`;
        this.nameInput.value = name;
      }
    }

    this.setGeneratingState(true);
    this.statusEl.textContent = '正在构建提示词...';
    this.statusEl.className = 'se-ai-status active';
    this.resultArea.innerHTML = '';

    const skelDesc = buildSkeletonDescriptorText(this.skeleton);
    const preset = PRESETS.find(p => p.id === name);
    const dur = preset?.duration ?? 1.0;
    
    let fullPrompt: string;
    try {
      fullPrompt = this.buildLLMPrompt(skelDesc, prompt, name, dur);
    } catch (e) {
      console.error(e);
      this.setGeneratingState(false);
      this.statusEl.textContent = '构建提示词失败: ' + (e as Error).message;
      this.statusEl.className = 'se-ai-status';
      return;
    }

    const mode = this.modeSelect.value as GenerateMode;
    let resultAnim: EditorAnimation | null = null;

    try {
      if (mode === 'clipboard') {
        try {
          await navigator.clipboard.writeText(fullPrompt);
          this.statusEl.textContent = '提示词已复制到剪贴板！请粘贴给 Cursor Agent，让它生成 JSON 后用下方「导入动画 JSON」按钮导入。';
          this.statusEl.className = 'se-ai-status success';
        } catch (clipboardErr) {
          console.error("Clipboard error:", clipboardErr);
          this.statusEl.textContent = '复制到剪贴板失败，请手动从下方预览区域复制。';
          this.statusEl.className = 'se-ai-status';
        }
        
        const promptPreview = document.createElement('pre');
        promptPreview.className = 'se-ai-prompt-preview';
        promptPreview.textContent = fullPrompt;
        this.resultArea.appendChild(promptPreview);
        this.setGeneratingState(false);
        return;
      }

      if (mode === 'claude') {
        this.statusEl.textContent = '正在通过 Claude Opus 生成动画（可能需要 10-30 秒）...';
        try {
          const raw = await callClaudeLocal(fullPrompt);
          console.log('[AIAnimPanel] Claude raw response length:', raw.length);
          resultAnim = this.parseRawResponse(raw, name, dur);
          this.statusEl.textContent = `Claude 动画生成完成：${Object.keys(resultAnim.boneTimelines).length} 根骨骼参与动画。`;
          this.statusEl.className = 'se-ai-status success';
        } catch (err: any) {
          console.error('[AIAnimPanel] Claude generation failed:', err);
          const errMsg = err?.message || String(err);
          this.statusEl.innerHTML = `Claude 调用失败：<strong>${errMsg}</strong><br>已回退到演示模板。`;
          this.statusEl.className = 'se-ai-status';
          resultAnim = this.generateDemoAnimation(name, dur);
        }
      } else if (mode === 'backend') {
        this.statusEl.textContent = '正在通过后端代理调用 LLM...';
        try {
          const raw = await callBackendProxy(fullPrompt);
          resultAnim = this.parseRawResponse(raw, name, dur);
          this.statusEl.textContent = `后端代理生成完成：${Object.keys(resultAnim.boneTimelines).length} 根骨骼参与动画。`;
          this.statusEl.className = 'se-ai-status success';
        } catch (err) {
          this.statusEl.textContent = `后端代理失败 (${err})，回退到演示模式。如后端未配置 /api/llm/chat 端点则此模式不可用。`;
          this.statusEl.className = 'se-ai-status';
          resultAnim = this.generateDemoAnimation(name, dur);
        }
      } else if (mode === 'custom_api') {
        const url = this.llmUrlInput.value.trim();
        const key = this.llmKeyInput.value.trim();
        if (!url || !key) {
          this.statusEl.textContent = '请填写 Base URL 和 API Key。';
          this.setGeneratingState(false);
          return;
        }
        this.statusEl.textContent = '正在调用自定义 LLM API...';
        const raw = await callLLM(fullPrompt, url, key, this.modelInput.value.trim() || undefined);
        resultAnim = this.parseRawResponse(raw, name, dur);
        this.statusEl.textContent = `LLM 动画已生成：${Object.keys(resultAnim.boneTimelines).length} 根骨骼参与动画。`;
        this.statusEl.className = 'se-ai-status success';
      } else {
        await new Promise(r => setTimeout(r, 300));
        resultAnim = this.generateDemoAnimation(name, dur);
        const refUsed = getRefKeyForAnim(name, this.weaponType) !== null;
        this.statusEl.textContent = refUsed
          ? `基于专业参考模板生成：${Object.keys(resultAnim.boneTimelines).length} 根骨骼参与动画（推荐模式）。`
          : `Demo 动画已生成（内置模板）。攻击动画建议用 attack1-attack3 预设获取专业质量。`;
        this.statusEl.className = 'se-ai-status success';
      }
    } catch (err) {
      this.statusEl.textContent = `生成失败：${err}。回退到演示模式。`;
      this.statusEl.className = 'se-ai-status';
      resultAnim = this.generateDemoAnimation(name, dur);
    }

    this.showResult(resultAnim);
    this.setGeneratingState(false);
  }

  private showResult(resultAnim: EditorAnimation): void {
    const applyBtn = document.createElement('button');
    applyBtn.className = 'se-ai-apply-btn';
    applyBtn.innerHTML = spineBtnLabel('check', '应用动画到预览');
    applyBtn.addEventListener('click', () => {
      this.onAnimationGenerated?.(resultAnim);
    });
    this.resultArea.appendChild(applyBtn);

    const fullJson = JSON.stringify(resultAnim, null, 2);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'se-ai-import-btn';
    copyBtn.innerHTML = spineBtnLabel('copy', '复制完整 JSON');
    copyBtn.style.margin = '4px 0';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(fullJson);
      copyBtn.innerHTML = spineBtnLabel('check', '已复制');
      setTimeout(() => { copyBtn.innerHTML = spineBtnLabel('copy', '复制完整 JSON'); }, 1500);
    });
    this.resultArea.appendChild(copyBtn);

    const jsonPreview = document.createElement('pre');
    jsonPreview.className = 'se-ai-json-preview';
    jsonPreview.textContent = fullJson.length > 3000
      ? fullJson.slice(0, 3000) + '\n\n(预览已截断，请用上方按钮复制完整 JSON)'
      : fullJson;
    this.resultArea.appendChild(jsonPreview);
  }

  private importAnimJson(): void {
    const textarea = document.createElement('textarea');
    textarea.style.cssText = 'width:100%;height:150px;font-size:11px;font-family:monospace;background:#111;color:#ddd;border:1px solid #444;border-radius:4px;padding:8px;margin:8px 0;';
    textarea.placeholder = '粘贴完整的动画 JSON（注意：不要粘贴带 ... 的截断预览）';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'se-ai-apply-btn';
    confirmBtn.textContent = '解析并应用';
    confirmBtn.addEventListener('click', () => {
      try {
        let text = textarea.value.trim();
        if (!text) throw new Error('请粘贴 JSON 内容');

        // Strip markdown code fences if present
        text = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '');

        // Remove trailing truncation markers like "..." or "\n..."
        text = text.replace(/[,\s]*\.{3,}\s*$/g, '');

        // Try to find the outermost complete JSON object
        let depth = 0, start = -1, end = -1;
        for (let i = 0; i < text.length; i++) {
          if (text[i] === '{') { if (start < 0) start = i; depth++; }
          else if (text[i] === '}') { depth--; if (depth === 0 && start >= 0) { end = i; break; } }
        }
        if (start < 0 || end < 0) throw new Error('未找到有效的 JSON 对象（需要完整的 { ... }）');

        let jsonStr = text.substring(start, end + 1);

        // Fix common issues: trailing commas before } or ]
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

        const parsed = JSON.parse(jsonStr);
        const anim = this.parseLLMResponse(parsed, parsed.name ?? 'imported', parsed.duration ?? 1.0);
        this.onAnimationGenerated?.(anim);
        this.statusEl.textContent = `已导入动画 "${anim.name}"，${Object.keys(anim.boneTimelines).length} 根骨骼。`;
        this.statusEl.className = 'se-ai-status success';
        textarea.remove();
        confirmBtn.remove();
      } catch (err) {
        this.statusEl.textContent = `JSON 解析失败：${err}`;
        this.statusEl.className = 'se-ai-status';
      }
    });

    this.resultArea.innerHTML = '';
    this.resultArea.appendChild(textarea);
    this.resultArea.appendChild(confirmBtn);
    textarea.focus();
  }

  private parseRawResponse(raw: string, name: string, dur: number): EditorAnimation {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);
    return this.parseLLMResponse(parsed, name, dur);
  }

  private parseLLMResponse(data: any, fallbackName: string, fallbackDur: number): EditorAnimation {
    const name = data.name ?? fallbackName;
    const duration = data.duration ?? fallbackDur;
    const boneTimelines: EditorAnimation['boneTimelines'] = {};

    // Max reasonable translation = 20% of skeleton height
    const skelH = this.skeleton ? getSkeletonHeight(this.skeleton) : 500;
    const maxTrans = Math.max(skelH * 0.2, 30);

    const rawTimelines = data.boneTimelines ?? data.bones ?? {};
    for (const [boneName, tl] of Object.entries(rawTimelines)) {
      if (!this.skeleton?.bones.has(boneName)) continue;
      const entry: EditorAnimation['boneTimelines'][string] = {};
      const timeline = tl as any;
      if (timeline.rotate && Array.isArray(timeline.rotate)) {
        entry.rotate = timeline.rotate.map((k: any) => ({
          time: k.time ?? 0,
          value: k.value ?? k.angle ?? 0,
        }));
      }
      if (timeline.translate && Array.isArray(timeline.translate)) {
        entry.translate = timeline.translate.map((k: any) => {
          let x = k.x ?? 0;
          let y = k.y ?? 0;
          // Clamp oversized translations proportionally
          const mag = Math.sqrt(x * x + y * y);
          if (mag > maxTrans) {
            const s = maxTrans / mag;
            x *= s; y *= s;
          }
          return { time: k.time ?? 0, x, y };
        });
      }
      if (timeline.scale && Array.isArray(timeline.scale)) {
        entry.scale = timeline.scale.map((k: any) => ({
          time: k.time ?? 0,
          x: k.x ?? 1,
          y: k.y ?? 1,
        }));
      }
      boneTimelines[boneName] = entry;
    }

    return fixLargeRotations({ name, duration, boneTimelines });
  }

  private buildLLMPrompt(skelDesc: string, userPrompt: string, animName: string, duration: number): string {
    const concept = this.conceptInput.value.trim();
    const wt = this.weaponType;
    const isAttackAnim = animName.includes('attack') || userPrompt.toLowerCase().includes('attack')
      || userPrompt.includes('攻击') || userPrompt.includes('挥砍') || userPrompt.includes('劈');

    // Try to find the best reference animation for few-shot
    let refJson: string | null = null;
    if (this.skeleton) {
      const refKey = getRefKeyForAnim(animName, wt);
      if (refKey && REF_ANIMS[refKey]) {
        refJson = buildFewShotJSON(this.skeleton, REF_ANIMS[refKey], animName, duration);
      }
    }

    let characterInfo = '';
    if (concept) characterInfo += `Character: "${concept}". `;
    if (wt !== 'unknown') characterInfo += `Weapon: ${wt} (${WEAPON_LABELS[wt]}). `;

    const skelHeight = this.skeleton ? getSkeletonHeight(this.skeleton) : 0;
    const scaleNote = skelHeight > 10
      ? `\nSKELETON SCALE: Character height ≈ ${skelHeight.toFixed(0)} units. Keep ALL bone translations proportional — a large attack lunge should be at most ~${(skelHeight * 0.05).toFixed(0)}-${(skelHeight * 0.15).toFixed(0)} units. Most bones need only ROTATION, not translation.`
      : '';

    // Core prompt — short, with emphasis on the reference example
    let prompt = `Spine 2D animation expert. Output ONLY valid JSON, no markdown, no explanation.

SKELETON (use ONLY these bone names):
${skelDesc}
${characterInfo ? '\n' + characterInfo : ''}${scaleNote}
REQUEST: Generate "${animName}" animation, ${duration}s duration.
Description: ${userPrompt}

RULES:
1. All rotation/translation values are RELATIVE to setup pose (0 = default)
2. Rotation interpolation takes SHORTEST ARC. For arcs >100°, add intermediate keyframes every 80°
3. Kinetic chain: hip → spine → chest → shoulder → arm → hand
4. For looping animations: first and last keyframe values must match
5. Translation values must be proportional to skeleton size. Most bones only need ROTATION, not translation
6. IF IK constraints are present for legs, move legs ONLY by TRANSLATING the IK targets (x/y). DO NOT rotate thigh/shin bones!`;

    if (refJson) {
      prompt += `

CRITICAL — REFERENCE ANIMATION (from professional game data):
The following is a high-quality "${animName}" animation using the exact bone names of this skeleton.
Use this as your BASELINE. You may adjust timing and values, but follow the same structure, 
bone coordination patterns, and rotation magnitudes closely.

${refJson}

IMPORTANT: Match the reference's rotation ranges and keyframe density. Do NOT simplify.
If the reference has arm rotation reaching -218°, your output should have similar magnitude.
Generate a VARIATION of this reference that matches the user's description.`;
    } else {
      prompt += `

OUTPUT FORMAT:
{
  "name": "${animName}",
  "duration": ${duration},
  "boneTimelines": {
    "bone_name": {
      "rotate": [{"time": 0, "value": 0}, {"time": 0.1, "value": -70}, ...],
      "translate": [{"time": 0, "x": 0, "y": 0}, ...]
    }
  }
}`;
    }

    return prompt;
  }

  private generateDemoAnimation(name: string, duration: number): EditorAnimation {
    if (!this.skeleton) return { name, duration, boneTimelines: {} };

    const animType = name.toLowerCase();

    // For attack animations with reference templates, use them directly
    const refKey = getRefKeyForAnim(name, this.weaponType);
    if (refKey && REF_ANIMS[refKey]) {
      const refAnim = buildAnimFromRef(this.skeleton, REF_ANIMS[refKey], name, duration);
      if (refAnim && Object.keys(refAnim.boneTimelines).length >= 3) {
        return fixLargeRotations(refAnim);
      }
    }

    const timelines: EditorAnimation['boneTimelines'] = {};
    const bones = this.skeleton.bones;
    const d = duration;
    const wt = this.weaponType;

    const isIdle = animType.includes('idle');
    const isWalk = animType.includes('walk');
    const isRun = animType.includes('run');
    const isAttack = animType.includes('attack') || animType.includes('skill');
    const comboHit = parseInt(animType.replace(/\D/g, '') || '1') || 1;
    const isHit = animType.includes('hit');
    const isJump = animType.includes('jump');

    // Check if IK constraints exist for legs — if so, animate IK targets instead of thigh/shin
    const hasLegIK = this.skeleton.ik.length > 0;
    const ikTargetNames = new Set(this.skeleton.ik.map(c => c.targetName));
    const ikControlledBones = new Set<string>();
    for (const c of this.skeleton.ik) {
      for (const bn of c.boneNames) ikControlledBones.add(bn);
    }

    // Generate IK target keyframes for walk/run when IK is present
    if (hasLegIK && (isWalk || isRun)) {
      const amp = isRun ? 8 : 5;
      const vAmp = isRun ? 4 : 2;
      for (const c of this.skeleton.ik) {
        const firstBone = bones.get(c.boneNames[0]);
        const isLeft = firstBone?.name.includes('_l') || firstBone?.name.includes('左') || false;
        const phase = isLeft ? 0 : 0.5;
        timelines[c.targetName] = { translate: [
          { time: 0,            x: Math.sin(phase * Math.PI * 2) * amp, y: Math.abs(Math.cos(phase * Math.PI * 2)) * vAmp },
          { time: d * 0.25,     x: Math.sin((phase + 0.25) * Math.PI * 2) * amp, y: Math.abs(Math.cos((phase + 0.25) * Math.PI * 2)) * vAmp },
          { time: d * 0.5,      x: Math.sin((phase + 0.5) * Math.PI * 2) * amp, y: Math.abs(Math.cos((phase + 0.5) * Math.PI * 2)) * vAmp },
          { time: d * 0.75,     x: Math.sin((phase + 0.75) * Math.PI * 2) * amp, y: Math.abs(Math.cos((phase + 0.75) * Math.PI * 2)) * vAmp },
          { time: d,            x: Math.sin(phase * Math.PI * 2) * amp, y: Math.abs(Math.cos(phase * Math.PI * 2)) * vAmp },
        ]};
      }
    }

    for (const [bname, bone] of bones) {
      if (bone.role === 'effect' || bone.role === 'root') continue;
      if (bone.role === 'ik_target') continue;
      if (bone.role === 'unknown' && bone.length === 0) continue;
      // Skip IK-controlled bones for walk/run when IK is present
      if (hasLegIK && (isWalk || isRun) && ikControlledBones.has(bname)) continue;

      const r = bone.role;
      const isLeft = bname.includes('_l') || bname.includes('_f') || bname.includes('左');
      const sign = isLeft ? 1 : -1;

      if (isIdle) {
        if (r === 'chest' || r === 'spine') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.3, value: 1 },
            { time: d * 0.6, value: 1.5 }, { time: d * 0.85, value: 0.5 }, { time: d, value: 0 },
          ]};
        } else if (r === 'head') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.25, value: -0.8 },
            { time: d * 0.5, value: 0.3 }, { time: d * 0.75, value: 1 }, { time: d, value: 0 },
          ]};
        } else if (r === 'upper_arm') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.35, value: sign * -1.5 },
            { time: d * 0.7, value: sign * -2.5 }, { time: d, value: 0 },
          ]};
        } else if (r === 'hip') {
          timelines[bname] = { translate: [
            { time: 0, x: 0, y: 0 }, { time: d * 0.5, x: 0, y: 1.5 }, { time: d, x: 0, y: 0 },
          ]};
        }
      } else if (isWalk || isRun) {
        const amp = isRun ? 1.8 : 1;
        if (r === 'thigh') {
          timelines[bname] = { rotate: [
            { time: 0, value: sign * 15 * amp }, { time: d * 0.25, value: 0 },
            { time: d * 0.5, value: sign * -15 * amp }, { time: d * 0.75, value: 0 },
            { time: d, value: sign * 15 * amp },
          ]};
        } else if (r === 'shin') {
          timelines[bname] = { rotate: [
            { time: 0, value: isLeft ? -5 : -25 * amp }, { time: d * 0.25, value: -15 * amp },
            { time: d * 0.5, value: isLeft ? -25 * amp : -5 }, { time: d * 0.75, value: -15 * amp },
            { time: d, value: isLeft ? -5 : -25 * amp },
          ]};
        } else if (r === 'upper_arm') {
          timelines[bname] = { rotate: [
            { time: 0, value: sign * -10 * amp }, { time: d * 0.25, value: 0 },
            { time: d * 0.5, value: sign * 10 * amp }, { time: d * 0.75, value: 0 },
            { time: d, value: sign * -10 * amp },
          ]};
        } else if (r === 'forearm') {
          timelines[bname] = { rotate: [
            { time: 0, value: -5 * amp }, { time: d * 0.25, value: -12 * amp },
            { time: d * 0.5, value: -5 * amp }, { time: d * 0.75, value: -12 * amp },
            { time: d, value: -5 * amp },
          ]};
        } else if (r === 'chest' || r === 'spine') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.25, value: 1.5 * amp },
            { time: d * 0.5, value: 0 }, { time: d * 0.75, value: 1.5 * amp }, { time: d, value: 0 },
          ]};
        } else if (r === 'head') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.25, value: -0.5 },
            { time: d * 0.5, value: -1 }, { time: d * 0.75, value: -0.5 }, { time: d, value: 0 },
          ]};
        } else if (r === 'hip') {
          timelines[bname] = { translate: [
            { time: 0, x: 0, y: 0 }, { time: d * 0.25, x: 0, y: 2 * amp },
            { time: d * 0.5, x: 0, y: 0 }, { time: d * 0.75, x: 0, y: 2 * amp }, { time: d, x: 0, y: 0 },
          ]};
        }
      } else if (isAttack) {
        this.generateAttackKeyframes(timelines, bname, r, isLeft, sign, d, wt, comboHit);
      } else if (isHit) {
        if (r === 'chest' || r === 'spine') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.1, value: -10 },
            { time: d * 0.2, value: -14 }, { time: d * 0.4, value: -8 },
            { time: d * 0.7, value: -3 }, { time: d, value: 0 },
          ]};
        } else if (r === 'head') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.08, value: 8 },
            { time: d * 0.15, value: 12 }, { time: d * 0.3, value: -4 }, { time: d, value: 0 },
          ]};
        } else if (r === 'hip') {
          timelines[bname] = { translate: [
            { time: 0, x: 0, y: 0 }, { time: d * 0.1, x: -4, y: -2 },
            { time: d * 0.2, x: -6, y: -3 }, { time: d * 0.5, x: -3, y: -1 }, { time: d, x: 0, y: 0 },
          ]};
        } else if (r === 'upper_arm') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.12, value: sign * 8 },
            { time: d * 0.3, value: sign * 5 }, { time: d, value: 0 },
          ]};
        }
      } else if (isJump) {
        if (r === 'hip') {
          timelines[bname] = { translate: [
            { time: 0, x: 0, y: 0 }, { time: d * 0.12, x: 0, y: -8 },
            { time: d * 0.25, x: 0, y: 10 }, { time: d * 0.4, x: 0, y: 28 },
            { time: d * 0.55, x: 0, y: 30 }, { time: d * 0.7, x: 0, y: 15 },
            { time: d * 0.85, x: 0, y: -5 }, { time: d, x: 0, y: 0 },
          ]};
        } else if (r === 'thigh') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.12, value: 22 },
            { time: d * 0.3, value: -12 }, { time: d * 0.5, value: -8 },
            { time: d * 0.75, value: 18 }, { time: d, value: 0 },
          ]};
        } else if (r === 'shin') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.12, value: -28 },
            { time: d * 0.3, value: 12 }, { time: d * 0.5, value: 8 },
            { time: d * 0.75, value: -22 }, { time: d, value: 0 },
          ]};
        } else if (r === 'upper_arm') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.15, value: sign * -12 },
            { time: d * 0.35, value: sign * 18 }, { time: d * 0.55, value: sign * 15 },
            { time: d * 0.8, value: sign * -8 }, { time: d, value: 0 },
          ]};
        } else if (r === 'chest' || r === 'spine') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.12, value: 4 },
            { time: d * 0.35, value: -6 }, { time: d * 0.6, value: -4 },
            { time: d * 0.8, value: 3 }, { time: d, value: 0 },
          ]};
        }
      } else {
        if (r === 'chest' || r === 'spine') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.3, value: 3 },
            { time: d * 0.6, value: 5 }, { time: d * 0.85, value: 2 }, { time: d, value: 0 },
          ]};
        } else if (r === 'head') {
          timelines[bname] = { rotate: [
            { time: 0, value: 0 }, { time: d * 0.4, value: -2 }, { time: d * 0.7, value: 2 }, { time: d, value: 0 },
          ]};
        }
      }
    }

    return fixLargeRotations({ name, duration, boneTimelines: timelines });
  }

  /**
   * Generate sword combo keyframes based on hit number.
   * Based on reference data from real dz_g.json animations:
   * - atk1: Quick overhead chop (~200° weapon arm arc)
   * - atk2: Side diagonal slash (~250° arc)
   * - atk3: Upward backslash or spinning slash
   * - atk4: Heavy downward slam (~350° full arc)
   * Key principle: ARM does the big arc, weapon bone barely rotates.
   */
  private generateSwordComboKeyframes(
    timelines: EditorAnimation['boneTimelines'],
    bname: string, role: string, isLeft: boolean,
    d: number, comboHit: number,
  ): void {
    if (comboHit === 1 || comboHit > 4) {
      // Hit 1: Quick overhead chop — ~200° clockwise arm arc, fast
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -20 },
          { time: d * 0.05, value: -80 },
          { time: d * 0.1, value: -160 },
          { time: d * 0.15, value: -190 },
          { time: d * 0.25, value: -210 },
          { time: d * 0.35, value: -218 },
          { time: d * 0.55, value: -218 },
          { time: d * 0.75, value: -160 },
          { time: d, value: -20 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.05, value: 48 },
          { time: d * 0.15, value: 36 },
          { time: d * 0.25, value: 13 },
          { time: d * 0.55, value: 13 },
          { time: d, value: 0 },
        ]};
      } else if (role === 'weapon') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.15, value: -25 },
          { time: d * 0.35, value: -35 },
          { time: d * 0.6, value: -20 },
          { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.05, value: 10 },
          { time: d * 0.15, value: 13 },
          { time: d * 0.25, value: -10 },
          { time: d * 0.35, value: -28 },
          { time: d * 0.55, value: -28 },
          { time: d, value: 0 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { rotate: [
          { time: 0, value: -7 },
          { time: d * 0.05, value: 13 },
          { time: d * 0.25, value: -29 },
          { time: d * 0.55, value: -31 },
          { time: d, value: -7 },
        ], translate: [
          { time: 0, x: 24, y: -26 },
          { time: d * 0.05, x: 29, y: -41 },
          { time: d * 0.25, x: 61, y: -88 },
          { time: d * 0.55, x: 61, y: -88 },
          { time: d, x: 61, y: -86 },
        ]};
      } else if (role === 'upper_arm' && isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -9 },
          { time: d * 0.05, value: -80 },
          { time: d * 0.1, value: -160 },
          { time: d * 0.15, value: -212 },
          { time: d * 0.55, value: -212 },
          { time: d * 0.75, value: -160 },
          { time: d, value: -9 },
        ]};
      } else if (role === 'forearm' && isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 81 },
          { time: d * 0.05, value: 34 },
          { time: d * 0.25, value: 19 },
          { time: d * 0.55, value: 34 },
          { time: d, value: 81 },
        ]};
      } else if (role === 'head') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.1, value: -5 },
          { time: d * 0.25, value: 8 },
          { time: d * 0.4, value: 5 },
          { time: d, value: 0 },
        ]};
      }
    } else if (comboHit === 2) {
      // Hit 2: Continuing slash from different angle — diagonal
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -19 },
          { time: d * 0.05, value: -90 },
          { time: d * 0.1, value: -160 },
          { time: d * 0.2, value: -220 },
          { time: d * 0.3, value: -257 },
          { time: d * 0.5, value: -295 },
          { time: d * 0.6, value: -369 },
          { time: d * 0.75, value: -369 },
          { time: d * 0.85, value: -300 },
          { time: d, value: -220 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -2 },
          { time: d * 0.05, value: 48 },
          { time: d * 0.2, value: 13 },
          { time: d * 0.4, value: 30 },
          { time: d * 0.6, value: -21 },
          { time: d * 0.75, value: -28 },
          { time: d, value: -9 },
        ]};
      } else if (role === 'weapon') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.3, value: -23 },
          { time: d * 0.6, value: -35 },
          { time: d, value: -13 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 9 },
          { time: d * 0.1, value: 10 },
          { time: d * 0.3, value: 11 },
          { time: d * 0.5, value: 9 },
          { time: d, value: 9 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { rotate: [
          { time: 0, value: -18 },
          { time: d * 0.15, value: -34 },
          { time: d * 0.4, value: -26 },
          { time: d * 0.6, value: -31 },
          { time: d, value: -15 },
        ]};
      } else if (role === 'upper_arm' && isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -29 },
          { time: d * 0.1, value: 30 },
          { time: d * 0.2, value: 80 },
          { time: d * 0.35, value: 115 },
          { time: d * 0.6, value: 97 },
          { time: d, value: -29 },
        ]};
      } else if (role === 'head') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.15, value: -3 },
          { time: d * 0.4, value: 5 },
          { time: d, value: 0 },
        ]};
      }
    } else if (comboHit === 3) {
      // Hit 3: Rising slash / different trajectory
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -8 },
          { time: d * 0.1, value: 50 },
          { time: d * 0.2, value: 100 },
          { time: d * 0.35, value: 128 },
          { time: d * 0.5, value: 141 },
          { time: d * 0.7, value: 90 },
          { time: d, value: -8 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -10 },
          { time: d * 0.1, value: -28 },
          { time: d * 0.35, value: 9 },
          { time: d * 0.6, value: -10 },
          { time: d, value: -10 },
        ]};
      } else if (role === 'weapon') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.15, value: -35 },
          { time: d * 0.35, value: -71 },
          { time: d * 0.6, value: -35 },
          { time: d, value: -13 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 16 },
          { time: d * 0.15, value: 19 },
          { time: d * 0.35, value: 16 },
          { time: d * 0.6, value: 19 },
          { time: d, value: 16 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { rotate: [
          { time: 0, value: -15 },
          { time: d * 0.15, value: 2 },
          { time: d * 0.4, value: -15 },
          { time: d, value: -15 },
        ]};
      } else if (role === 'upper_arm' && isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -68 },
          { time: d * 0.1, value: -40 },
          { time: d * 0.3, value: -31 },
          { time: d * 0.6, value: -68 },
          { time: d, value: -68 },
        ]};
      } else if (role === 'head') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.15, value: -3 },
          { time: d * 0.35, value: 5 },
          { time: d, value: 0 },
        ]};
      }
    } else if (comboHit === 4) {
      // Hit 4: Heavy downward slam — largest arc ~350°
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 141 },
          { time: d * 0.08, value: 70 },
          { time: d * 0.15, value: 0 },
          { time: d * 0.22, value: -70 },
          { time: d * 0.3, value: -140 },
          { time: d * 0.4, value: -200 },
          { time: d * 0.5, value: -250 },
          { time: d * 0.65, value: -249 },
          { time: d * 0.8, value: -200 },
          { time: d, value: -220 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -9 },
          { time: d * 0.15, value: 30 },
          { time: d * 0.4, value: -21 },
          { time: d * 0.65, value: -28 },
          { time: d, value: -9 },
        ]};
      } else if (role === 'weapon') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.2, value: -13 },
          { time: d * 0.5, value: -49 },
          { time: d * 0.7, value: -30 },
          { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 19 },
          { time: d * 0.15, value: 21 },
          { time: d * 0.35, value: 19 },
          { time: d * 0.5, value: 20 },
          { time: d, value: 19 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { rotate: [
          { time: 0, value: 2 },
          { time: d * 0.2, value: -15 },
          { time: d * 0.5, value: -15 },
          { time: d, value: 2 },
        ]};
      } else if (role === 'upper_arm' && isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: -68 },
          { time: d * 0.1, value: -30 },
          { time: d * 0.2, value: 20 },
          { time: d * 0.3, value: 70 },
          { time: d * 0.4, value: 113 },
          { time: d * 0.5, value: 150 },
          { time: d * 0.6, value: 188 },
          { time: d * 0.7, value: 160 },
          { time: d * 0.85, value: 100 },
          { time: d, value: -68 },
        ]};
      } else if (role === 'head') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 },
          { time: d * 0.2, value: -5 },
          { time: d * 0.4, value: 8 },
          { time: d, value: 0 },
        ]};
      }
    }
  }

  private generateAttackKeyframes(
    timelines: EditorAnimation['boneTimelines'],
    bname: string, role: string, isLeft: boolean, sign: number,
    d: number, wt: WeaponType, comboHit: number = 1,
  ): void {
    if (wt === 'sword' || wt === 'unknown') {
      this.generateSwordComboKeyframes(timelines, bname, role, isLeft, d, comboHit);
    } else if (wt === 'gun') {
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -50 },  // raise to aim
          { time: d * 0.3, value: -48 },   // steady aim
          { time: d * 0.35, value: -38 },  // recoil kick
          { time: d * 0.45, value: -46 },  // re-aim
          { time: d * 0.7, value: -30 },   // lowering
          { time: d, value: 0 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -20 },
          { time: d * 0.35, value: -12 },  // recoil
          { time: d * 0.45, value: -18 }, { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -3 },
          { time: d * 0.35, value: 4 },    // recoil pushback
          { time: d * 0.5, value: 1 }, { time: d, value: 0 },
        ]};
      } else if (role === 'head') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -2 },
          { time: d * 0.35, value: 3 }, { time: d * 0.5, value: 0 }, { time: d, value: 0 },
        ]};
      }
    } else if (wt === 'bow') {
      if (role === 'upper_arm' && !isLeft) {
        // String arm: draw back
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.1, value: -15 },
          { time: d * 0.3, value: -40 },   // full draw
          { time: d * 0.4, value: -42 },   // hold
          { time: d * 0.45, value: -10 },  // release snap
          { time: d * 0.55, value: 5 },    // follow-through
          { time: d, value: 0 },
        ]};
      } else if (role === 'upper_arm' && isLeft) {
        // Bow arm: push forward and hold
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -55 },
          { time: d * 0.3, value: -60 },   // aim
          { time: d * 0.45, value: -58 },  // hold through release
          { time: d * 0.65, value: -40 },  // lower
          { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.2, value: -5 },
          { time: d * 0.4, value: -8 },    // drawn back
          { time: d * 0.5, value: 3 },     // release thrust
          { time: d * 0.7, value: 1 }, { time: d, value: 0 },
        ]};
      }
    } else if (wt === 'staff') {
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -30 },
          { time: d * 0.3, value: -70 },   // raise high
          { time: d * 0.4, value: -65 },   // channel
          { time: d * 0.5, value: -20 },   // thrust forward
          { time: d * 0.6, value: 10 },    // burst spread
          { time: d * 0.8, value: 5 }, { time: d, value: 0 },
        ]};
      } else if (role === 'weapon') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -15 },
          { time: d * 0.3, value: -35 },   // raised
          { time: d * 0.5, value: 25 },    // thrust
          { time: d * 0.65, value: 15 }, { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.2, value: -6 },
          { time: d * 0.4, value: -10 },   // lean back during channel
          { time: d * 0.5, value: 8 },     // snap forward for cast
          { time: d * 0.7, value: 3 }, { time: d, value: 0 },
        ]};
      }
    } else if (wt === 'spear') {
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.15, value: -25 },
          { time: d * 0.25, value: -35 },  // chamber
          { time: d * 0.35, value: -55 },  // thrust (translation-heavy for spear)
          { time: d * 0.45, value: -60 },  // full extension
          { time: d * 0.6, value: -40 },   // retract
          { time: d * 0.8, value: -15 }, { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.2, value: -8 },
          { time: d * 0.35, value: 12 },   // torso drives thrust
          { time: d * 0.5, value: 8 }, { time: d * 0.7, value: 3 }, { time: d, value: 0 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { translate: [
          { time: 0, x: 0, y: 0 }, { time: d * 0.2, x: -5, y: 0 },
          { time: d * 0.35, x: 8, y: 0 },  // lunge forward
          { time: d * 0.5, x: 10, y: 0 },  // peak
          { time: d * 0.7, x: 4, y: 0 }, { time: d, x: 0, y: 0 },
        ]};
      }
    } else if (wt === 'fist') {
      if (role === 'upper_arm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.1, value: 15 },
          { time: d * 0.18, value: -55 },  // fast punch extension
          { time: d * 0.28, value: -65 },  // full extension
          { time: d * 0.4, value: -45 },   // retract
          { time: d * 0.6, value: -20 }, { time: d, value: 0 },
        ]};
      } else if (role === 'forearm' && !isLeft) {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.1, value: -30 },
          { time: d * 0.2, value: -10 },   // extends during punch
          { time: d * 0.35, value: -5 }, { time: d, value: 0 },
        ]};
      } else if (role === 'chest' || role === 'spine') {
        // Hip-driven kinetic chain
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.08, value: -6 },
          { time: d * 0.18, value: 14 },   // torso follows hip rotation
          { time: d * 0.3, value: 10 }, { time: d * 0.6, value: 4 }, { time: d, value: 0 },
        ]};
      } else if (role === 'hip') {
        timelines[bname] = { rotate: [
          { time: 0, value: 0 }, { time: d * 0.06, value: -4 },
          { time: d * 0.15, value: 8 },    // hip rotation initiates
          { time: d * 0.3, value: 5 }, { time: d, value: 0 },
        ]};
      }
    }
  }
}
