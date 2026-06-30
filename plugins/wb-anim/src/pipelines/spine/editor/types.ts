// @source wb-character/src/pipelines/spine/editor/types.ts
export interface RawSpineJson {
  skeleton: { hash: string; spine: string; x?: number; y?: number; width: number; height: number };
  bones: RawBone[];
  slots: RawSlot[];
  ik?: RawIK[];
  skins: RawSkin[];
  animations: Record<string, RawAnimation>;
}

export interface RawBone {
  name: string;
  parent?: string;
  length?: number;
  rotation?: number;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  shearX?: number;
  shearY?: number;
  transform?: string; // Spine 4.0+ uses transform
  inherit?: string; // Older Spine uses inherit
  color?: string;
}

export interface RawSlot {
  name: string;
  bone: string;
  attachment?: string;
  color?: string;
  blend?: string;
}

export interface RawIK {
  name: string;
  order?: number;
  bones: string[];
  target: string;
  bendPositive?: boolean;
  mix?: number;
}

export interface RawSkin {
  name: string;
  attachments?: Record<string, Record<string, RawAttachment>>;
}

export interface RawAttachment {
  name?: string;
  type?: string;
  skin?: string;
  parent?: string;
  x?: number;
  y?: number;
  rotation?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  /** Mesh: normalized UV coords [u0,v0, u1,v1, ...] */
  uvs?: number[];
  /** Mesh: triangle vertex indices [i0,i1,i2, ...] */
  triangles?: number[];
  /** Mesh: vertex positions — simple: [x,y,...] or weighted: [boneCount,boneIdx,x,y,weight,...] */
  vertices?: number[];
  hull?: number;
  /** Override image name for atlas lookup */
  path?: string;
  edges?: number[];
}

export interface RawAnimation {
  bones?: Record<string, RawBoneTimeline>;
  slots?: Record<string, Record<string, RawKeyframe[]>>;
  deform?: Record<string, Record<string, Record<string, RawKeyframe[]>>>;
}

export interface RawBoneTimeline {
  rotate?: RawKeyframe[];
  translate?: RawKeyframe[];
  scale?: RawKeyframe[];
  shear?: RawKeyframe[];
}

export interface RawKeyframe {
  time?: number;
  value?: number;
  angle?: number;
  x?: number;
  y?: number;
  curve?: string | number[];
}

export interface EditorBone {
  name: string;
  parent: string | null;
  children: string[];
  localX: number;
  localY: number;
  localRotation: number;
  length: number;
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  transform: string;
  role: string;
  worldX: number;
  worldY: number;
  worldRotation: number;
  /** 2x2 world transform matrix (includes all ancestor rotation+scale) */
  worldA: number;
  worldB: number;
  worldC: number;
  worldD: number;
  /** Setup pose values — never modified by animation playback */
  setupX: number;
  setupY: number;
  setupRotation: number;
}

export interface EditorSlot {
  name: string;
  boneName: string;
  attachmentName: string | null;
}

export interface EditorIK {
  name: string;
  boneNames: string[];
  targetName: string;
  bendPositive: boolean;
  mix: number;
}

export interface EditorAnimation {
  name: string;
  duration: number;
  boneTimelines: Record<string, {
    rotate?: { time: number; value: number }[];
    translate?: { time: number; x: number; y: number }[];
    scale?: { time: number; x: number; y: number }[];
    shear?: { time: number; x: number; y: number }[];
  }>;
}

export interface EditorSkeleton {
  bones: Map<string, EditorBone>;
  boneOrder: string[];
  rootBones: string[];
  slots: EditorSlot[];
  ik: EditorIK[];
  animations: Map<string, EditorAnimation>;
  skinAttachments: Map<string, Map<string, RawAttachment>>;
}

export interface BindingResult {
  partId: string;
  slotName: string;
  boneName: string;
  imageData: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type EditorMode = 'browse' | 'edit' | 'animate';

export interface EditorState {
  mode: EditorMode;
  selectedBone: string | null;
  hoveredBone: string | null;
  currentAnimation: string | null;
  animationTime: number;
  playing: boolean;
  zoom: number;
  panX: number;
  panY: number;
  showBones: boolean;
  showSlots: boolean;
  showIK: boolean;
  showAttachments: boolean;
}
