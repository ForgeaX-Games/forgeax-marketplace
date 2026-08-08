import type { AssetMeta } from './state.ts';
import type {
  CreativeReference,
  CreativeRequest,
} from './creativeWorkbench.ts';

export const HUMAN_SEARCH_SCHEMA = 'human-audio-search/1' as const;

export type HumanAudioMode = 'sfx' | 'bgm';
export type PlayerWorkbenchMode = HumanAudioMode | 'voice' | 'generate' | 'custom' | 'bindings';
export type IntensityId = 'light' | 'medium' | 'heavy';
export type AudioNameSource = 'supplier' | 'rule' | 'original';

export interface HumanSfxIntent {
  schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
  kind: 'sfx';
  cue: string;
  directoryCategory?: string;
  directorySubcategory?: string;
  sourceId?: string;
  materialId?: string;
  intensity?: IntensityId;
  requireIntensityVariants?: boolean;
  preferredStyleIds: string[];
  hardExcludeIds: string[];
  avoidStyleIds: string[];
  queryText?: string;
  projectId: string;
  topK: number;
}

export interface HumanBgmIntent {
  schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
  kind: 'bgm';
  queryText: string;
  scene?: string;
  moodIds: string[];
  energy?: string;
  world?: string;
  projectId: string;
  topK: number;
}

export type HumanSearchIntent = HumanSfxIntent | HumanBgmIntent;

export interface HumanVariant {
  assetId: string;
  name: string;
  version: string;
  resUrl: string;
  filename: string;
  asset: AssetMeta;
}

export interface HumanFamilyResult {
  familyId: string;
  displayName: string;
  nameSource: AudioNameSource;
  description: string;
  cue: string;
  source: string[];
  targetMaterial: string[];
  intensity: string[];
  styleTags: string[];
  containsTags: string[];
  variants: HumanVariant[];
  matchLevel: 'exact' | 'relaxed' | 'partial';
  matchedFields: string[];
  relaxedFields: string[];
  unknownFields: string[];
  hardConstraintsVerified: boolean;
  score: number;
  reviewStatus: string;
  directoryCategory?: string;
  directorySubcategory?: string;
  bgmTags?: {
    scene?: string;
    mood: string[];
    energy?: string;
    world?: string;
    sources: {
      scene?: 'filename';
      mood: Array<'filename' | 'clap'>;
      energy?: 'filename' | 'clap';
      world?: 'filename';
    };
  };
}

export interface HumanSearchResult {
  requestId: string;
  intent: HumanSearchIntent;
  candidates: HumanFamilyResult[];
  totalFamilies: number;
  warnings: string[];
}

export type AudioWorkbenchMessage =
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'view.mode';
      requestId: string;
      projectId: string;
      mode: PlayerWorkbenchMode;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'search.request';
      requestId: string;
      projectId: string;
      payload: HumanSearchIntent;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'search.status';
      requestId: string;
      projectId: string;
      status: 'loading' | 'done' | 'error';
      count?: number;
      error?: string;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'creative.request';
      requestId: string;
      projectId: string;
      payload: CreativeRequest;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'creative.reset';
      requestId: string;
      projectId: string;
      mode: 'voice' | 'generate';
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'creative.status';
      requestId: string;
      projectId: string;
      status: 'loading' | 'done' | 'error';
      count?: number;
      error?: string;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'creative.open';
      requestId: string;
      projectId: string;
      reference: CreativeReference;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'bindings.state';
      requestId: string;
      projectId: string;
      slug: string;
      revisionLabel: string;
      bindingCount: number;
      busy: boolean;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'bindings.state.request' | 'bindings.scan';
      requestId: string;
      projectId: string;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'bindings.select';
      requestId: string;
      projectId: string;
      slug: string;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'custom.changed';
      requestId: string;
      projectId: string;
    }
  | {
      schemaVersion: typeof HUMAN_SEARCH_SCHEMA;
      type: 'custom.bind';
      requestId: string;
      projectId: string;
      slug: string;
      asset: { assetId: string; originalName: string };
      file: string;
    };
