export interface TreeNode {
  _type: 'root' | 'folder' | 'asset';
  _asset: AssetMeta | null;
  _cosKey: string | null;
  _name?: string;
  children: Record<string, TreeNode>;
}

export interface VersionInfo {
  version_name?: string;
  display_version_name?: string;
  res_url?: string;
  thumbnail_url?: string;
  state?: number;
  create_time?: number | string;
  update_time?: number | string;
}

export interface AssetMeta {
  id?: string;
  asset_id?: string;
  name?: string;
  display_name?: string;
  type?: number;
  state?: number;
  description?: string;
  current_version?: string;
  versions?: VersionInfo[];
  custom_tags?: string[];
  gen_tags?: string[];
  ai_meta?: unknown;
  extra?: unknown;
  create_time?: number | string;
  update_time?: number | string;
  score?: number;
}

export interface AppState {
  depotName: string;
  viewMode: 'filemanager' | 'filter';
  activeType: number | null;
  search: string;
  page: number;
  pageSize: number;
  total: number;
  fileTree: TreeNode | null;
}

export const S: AppState = {
  depotName:   'aw',
  viewMode:    'filemanager',
  activeType:  null,
  search:      '',
  page:        1,
  pageSize:    20,
  total:       0,
  fileTree:    null,
};

export interface AssetCacheState {
  data: AssetMeta[] | null;
  ts: number;
  TTL: number;
}

export const assetCache: AssetCacheState = {
  data: null,
  ts: 0,
  TTL: 120000,
};
