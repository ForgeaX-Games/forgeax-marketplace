export type AssetRole =
  | 'ui-glyph'
  | 'consumable'
  | 'equipment'
  | 'weapon'
  | 'material'
  | 'currency'
  | 'quest'
  | 'key-item';

export type IconStyleId =
  | 'lucide-line'
  | 'pixel-16'
  | 'pixel-32'
  | 'pixel-48'
  | 'pixel-64'
  | 'painted-flat'
  | 'fantasy-painted'
  | 'sci-fi-hud';

export type IconDelivery = 'svg-lucide' | 'png-transparent' | 'png-pixel';

export interface LocalizedName {
  zh: string;
  en: string;
}

export interface ItemGameplay {
  effect?: string;
  value?: number | string;
  duration?: number;
}

export interface ItemRecord {
  id: string;
  slug: string;
  name: LocalizedName;
  description?: Partial<LocalizedName>;
  icon: string;
  iconVariants?: Partial<Record<IconStyleId, string>>;
  asset_role: AssetRole;
  categories: string[];
  tags: string[];
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  stackable: boolean;
  maxStack?: number;
  sellPrice?: number;
  gameplay?: ItemGameplay;
  depicts?: string;
}

export interface ItemsDocumentMeta {
  defaultLocale?: string;
  iconStyle?: IconStyleId | 'mixed';
  iconSize?: number;
  /** 图标规范化管线版本，低于当前值时 list 会从 raw 重跑 */
  iconNormalizeRev?: number;
  updatedAt?: string | number;
}

export interface ItemsDocument {
  version: number;
  meta?: ItemsDocumentMeta;
  items: ItemRecord[];
}

export interface StylePreset {
  id: IconStyleId;
  label: { zh: string; en: string };
  delivery: IconDelivery;
  targetSize: number;
  promptSuffix: string;
}

export interface NormalizeIconResult {
  slug: string;
  source: string;
  outputPath: string;
  sourceSize: [number, number];
  pixelSource: boolean;
  qa: {
    opaqueEdgePixels: number;
    transparentCornerDirtyPixels: number;
    fragmentationRatio: number;
    largestComponentRatio: number;
    opaqueBoundsFillRatio: number;
    passed: boolean;
  };
}

export interface NormalizeBatchResult {
  ok: true;
  batchId: string;
  targetSize: number;
  normalized: NormalizeIconResult[];
  failed: Array<{ slug: string; error: string }>;
  itemsDocument: ItemsDocument;
}

export interface ListItemsResult {
  ok: true;
  slug: string;
  gameRoot: string;
  document: ItemsDocument;
  icons: Array<{
    slug: string;
    path: string;
    previewUrl: string;
  }>;
}

export interface GenerateStylePlanItem {
  slug: string;
  depicts: string;
  style: IconStyleId;
  outputPath: string;
  prompt: string;
}

export interface GenerateStylePlanResult {
  ok: true;
  style: IconStyleId;
  batchId: string;
  plan: GenerateStylePlanItem[];
  note: string;
}

export interface ProposedItem {
  slug: string;
  name: LocalizedName;
  depicts: string;
  prompt: string;
}

export interface SummarizeRequirementsResult {
  ok: true;
  source: 'llm' | 'heuristic';
  style: IconStyleId;
  items: ProposedItem[];
}

export interface GenerateIconsResult {
  ok: true;
  batchId: string;
  generated: Array<{ slug: string; path: string }>;
  failed: Array<{ slug: string; error: string }>;
  imageBackend: 'litellm' | 'plan-only';
}

export interface RunPipelineResult {
  ok: true;
  batchId: string;
  targetSize: number;
  summarize: SummarizeRequirementsResult;
  plan: GenerateStylePlanResult;
  icons?: GenerateIconsResult;
  normalize?: NormalizeBatchResult;
  note: string;
}
