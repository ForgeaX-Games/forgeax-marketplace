import { ASSET_TYPES } from './config.ts';
import type { AssetTypeInfo } from './config.ts';
import type { AssetMeta, VersionInfo } from './state.ts';
import { EL } from './dom.ts';

export function getLatestVersion(asset: AssetMeta | null | undefined): VersionInfo | null {
  const versions = asset?.versions;
  if (!versions?.length) return null;

  if (asset!.current_version) {
    const matched = versions.find(v => v.version_name === asset!.current_version);
    if (matched) return matched;
  }

  const published = versions.find(v => v.state === 1);
  if (published) return published;

  return versions[0];
}

export function getCosKeyForVersion(asset: AssetMeta, versionObj: VersionInfo | null): string {
  const n = asset.name || '';
  if (n && !n.startsWith('http')) return n;

  const rv = versionObj?.res_url || '';
  if (rv.startsWith('http')) {
    try { return new URL(rv).pathname.slice(1); } catch { /* ignore */ }
  }
  return rv || n;
}

export function getCosKey(asset: AssetMeta): string {
  return getCosKeyForVersion(asset, getLatestVersion(asset));
}

export function getTypeMeta(type: number | undefined): AssetTypeInfo {
  return ASSET_TYPES.find(t => t.type === type) || { type: type ?? 0, label: `类型${type}`, icon: '📄' };
}

export function isZip(cosKey: string | undefined): boolean {
  return /\.zip$/i.test(cosKey || '');
}

export function basename(path: string | undefined, ext = ''): string {
  const n = (path || '').replace(/\\/g, '/').split('/').pop() || '';
  return ext ? n.replace(new RegExp(ext.replace('.', '\\.') + '$', 'i'), '') : n;
}

export function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
  return Math.abs(h).toString(16).padStart(8, '0');
}

export function showToast(msg: string, type = ''): void {
  const t = EL.toast() as HTMLElement & { _tid?: ReturnType<typeof setTimeout> };
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.add('hidden'), 3500);
}

export function setViewerPanel(name: string | null): void {
  EL.placeholder().classList.add('hidden');
  EL.viewerAudio().classList.add('hidden');
  EL.searchResults().classList.add('hidden');
  EL.filterView().classList.add('hidden');

  if (name) document.getElementById(name)?.classList.remove('hidden');
}
