export interface LibraryQuery {
  kind?: 'bgm' | 'sfx';
  query?: string;
  page: number;
  pageSize: number;
}

export interface AssetMetaLike {
  id?: string;
  asset_id?: string;
  name?: string;
  display_name?: string;
  type?: number;
  state?: number;
  description?: string;
  current_version?: string;
  versions?: Array<{
    version_name?: string;
    display_version_name?: string;
    res_url?: string;
    state?: number;
    create_time?: number | string;
    update_time?: number | string;
  }>;
  custom_tags?: string[];
  gen_tags?: string[];
}

export interface ResolvedLibraryAsset {
  assetId: string;
  kind: 'bgm' | 'sfx';
  absolutePath: string;
  previewUrl: string;
  fileName: string;
  version: string;
}

export interface AudioLibraryProvider {
  findAssets(query: LibraryQuery): Promise<{ assets: AssetMetaLike[]; total: number }>;
  resolveAsset(assetId: string): Promise<ResolvedLibraryAsset | null>;
}
