// @source wb-character/src/pipelines/spine/editor/StudioState.ts
import type { RawSpineJson, EditorSkeleton, EditorAnimation } from './types';

export type Profession = 'melee' | 'ranged';

export interface PartRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageData?: string;
}

export interface StudioState {
  profession: Profession;
  characterDescription: string;
  characterImage: string | null;
  explosionImage: string | null;
  partRegions: PartRegion[];
  bindingJson: RawSpineJson | null;
  bindingSkeleton: EditorSkeleton | null;
  attachmentImages: Map<string, string>;
  animations: Map<string, EditorAnimation>;
  exportPath: string | null;
  activeTab: TabId;
  bindingVersion: number;
}

export type TabId = 'game' | 'design' | 'explosion' | 'bind' | 'anim' | 'upload';

export const TAB_META: { id: TabId; label: string; icon: string }[] = [
  { id: 'explosion', label: '拆分部件', icon: 'explosion' },
  { id: 'bind',      label: '自动绑骨', icon: 'bind' },
  { id: 'anim',      label: '动作工坊', icon: 'anim' },
  { id: 'upload',    label: '导出',     icon: 'upload' },
];

export function createDefaultState(): StudioState {
  return {
    profession: 'melee',
    characterDescription: '',
    characterImage: null,
    explosionImage: null,
    partRegions: [],
    bindingJson: null,
    bindingSkeleton: null,
    attachmentImages: new Map(),
    animations: new Map(),
    exportPath: null,
    activeTab: 'explosion',
    bindingVersion: 0,
  };
}

export interface StudioTab {
  readonly id: TabId;
  readonly container: HTMLElement;
  readonly sidePanel: HTMLElement;
  readonly centerView: HTMLElement | null;
  readonly centerToolbar: HTMLElement | null;
  readonly bottomPanel: HTMLElement | null;
  readonly rightPanel: HTMLElement | null;
  activate(state: StudioState): void;
  deactivate(): void;
  dispose(): void;
}
