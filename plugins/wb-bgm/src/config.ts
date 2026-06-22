export interface AssetTypeInfo {
  type: number;
  label: string;
  icon: string;
}

// wb-bgm 接入约束：只接入 BGM(3) 与 音效(7)，其余资产类型不暴露。
export const ASSET_TYPES: AssetTypeInfo[] = [
  { type: 3,  label: 'BGM',            icon: '🎵' },
  { type: 7,  label: '音效',           icon: '🔊' },
];

/** type → 'bgm' | 'sfx'（写入游戏 audio/manifest.json 时的 kind） */
export function audioKindOf(type: number | undefined): 'bgm' | 'sfx' {
  return type === 7 ? 'sfx' : 'bgm';
}
