import type { AssetMeta, VersionInfo } from './state.ts';
import { EL, $ } from './dom.ts';
import { getTypeMeta, getLatestVersion, getCosKeyForVersion, isZip, basename } from './utils.ts';
import { proxyUrl } from './proxyUrl.ts';
import { audioKindOf } from './config.ts';
import { attachToGame, type AudioSelection } from './attach.ts';
import { openGamePicker } from './gameSelect.ts';

function setModalViewer(name: string | null): void {
  EL.modalViewerAudio().classList.add('hidden');
  EL.modalPreviewPlaceholder().classList.add('hidden');
  if (name) $(name)?.classList.remove('hidden');
}

function showModalAudio(url: string): void {
  setModalViewer('modalViewerAudio');
  const player = EL.modalAudioPlayer() as HTMLAudioElement;
  player.src = url;
  player.load();
}

function loadModalPreview(asset: AssetMeta, versionObj: VersionInfo | null | undefined, cosKey: string): void {
  (EL.modalAudioPlayer() as HTMLAudioElement).pause();

  if (!cosKey) { setModalViewer('modalPreviewPlaceholder'); EL.modalPlaceholderText().textContent = '无效的资产路径'; return; }
  const type = asset?.type;
  if (!versionObj) { setModalViewer('modalPreviewPlaceholder'); EL.modalPlaceholderText().textContent = '该资产暂无可用版本'; return; }
  const downloadUrl = versionObj.res_url || '';

  // Audio-only: play BGM(3)/SFX(7) direct URLs; everything else is unsupported.
  if ((type === 3 || type === 7) && !isZip(cosKey)) { showModalAudio(proxyUrl(downloadUrl)); return; }
  setModalViewer('modalPreviewPlaceholder');
  EL.modalPlaceholderText().textContent = '暂不支持预览该文件类型';
}

function wireModalAttach(asset: AssetMeta, versionObj: VersionInfo | null | undefined): void {
  const btn = EL.modalAttachBtn() as HTMLButtonElement;
  const type = asset?.type;
  const resUrl = versionObj?.res_url || '';
  const cosKey = getCosKeyForVersion(asset, versionObj ?? null) || '';
  if ((type === 3 || type === 7) && resUrl) {
    const sel: AudioSelection = {
      assetId: asset.asset_id || asset.id || '',
      name: asset.display_name || asset.name || basename(cosKey),
      kind: audioKindOf(type),
      version: versionObj?.display_version_name || versionObj?.version_name || '',
      resUrl,
      filename: basename(cosKey),
    };
    btn.classList.remove('hidden');
    btn.onclick = () => { void openGamePicker(btn, (slug) => { void attachToGame(sel, btn, slug); }); };
  } else {
    btn.classList.add('hidden');
    btn.onclick = null;
  }
}

function switchModalVersion(asset: AssetMeta, versionObj: VersionInfo | null | undefined): void {
  const verStr = versionObj?.display_version_name || versionObj?.version_name || asset.current_version || '未知';
  EL.infoVersion().textContent = verStr === '未知' ? verStr : `${verStr} 版本`;

  const formatTime = (t: number | string | undefined): string => {
    if (!t) return '-';
    if (typeof t === 'number') return new Date(t < 1e12 ? t * 1000 : t).toLocaleString();
    return String(t);
  };
  EL.infoCreateTime().textContent = formatTime(versionObj?.create_time || asset.create_time);
  EL.infoUpdateTime().textContent = formatTime(versionObj?.update_time || asset.update_time);

  // "配入游戏" — only for audio(3)/音效(7) with a downloadable version.
  wireModalAttach(asset, versionObj);

  EL.infoPath().textContent = getCosKeyForVersion(asset, versionObj ?? null) || '-';
  loadModalPreview(asset, versionObj, getCosKeyForVersion(asset, versionObj ?? null));
}

export function openModal(asset: AssetMeta, cosKey: string): void {
  const tm = getTypeMeta(asset.type);
  EL.modalTitle().textContent = asset.name || '资产详情';
  EL.infoName().textContent = asset.name || '-';
  EL.infoId().textContent = asset.id || '-';
  EL.infoType().textContent = tm.label;
  const stateMap: Record<number, string> = { 1: '上线', 5: '导入成功', 9: '下线', 10: '删除' };
  EL.infoState().textContent = stateMap[asset.state ?? -1] || `未知 (${asset.state || '-'})`;
  EL.infoDescription().textContent = asset.description || '暂无描述';
  EL.infoPath().textContent = cosKey || '-';

  if (asset.ai_meta) { EL.infoAiMetaRow().classList.remove('hidden'); EL.infoAiMeta().textContent = typeof asset.ai_meta === 'object' ? JSON.stringify(asset.ai_meta, null, 2) : String(asset.ai_meta); }
  else EL.infoAiMetaRow().classList.add('hidden');
  if (asset.extra) { EL.infoExtraRow().classList.remove('hidden'); EL.infoExtra().textContent = typeof asset.extra === 'object' ? JSON.stringify(asset.extra, null, 2) : String(asset.extra); }
  else EL.infoExtraRow().classList.add('hidden');

  const versions = asset.versions || [];
  const latestVer = getLatestVersion(asset) || versions[0];
  if (versions.length > 1) {
    EL.modalVersionTabs().classList.remove('hidden');
    const container = EL.modalVersionTabs();
    container.innerHTML = '';
    versions.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'version-tab';
      if (v === latestVer) btn.classList.add('active');
      const verName = v.display_version_name || v.version_name || '未知';
      btn.textContent = verName === '未知' ? verName : `${verName} 版本`;
      btn.onclick = () => { container.querySelectorAll('.version-tab').forEach(b => b.classList.remove('active')); btn.classList.add('active'); switchModalVersion(asset, v); };
      container.appendChild(btn);
    });
  } else { EL.modalVersionTabs().classList.add('hidden'); EL.modalVersionTabs().innerHTML = ''; }

  const tags = [...(asset.custom_tags || []), ...(asset.gen_tags || [])];
  if (tags.length) { EL.infoTagsRow().classList.remove('hidden'); EL.infoTags().innerHTML = tags.map(t => `<span class="info-tag">${t}</span>`).join(''); }
  else EL.infoTagsRow().classList.add('hidden');

  EL.modalOverlay().classList.remove('hidden');
  switchModalVersion(asset, latestVer);
}

function closeModal(): void {
  EL.modalOverlay().classList.add('hidden');
  (EL.modalAudioPlayer() as HTMLAudioElement).pause();
}

export function initModal(): void {
  EL.modalCloseBtn().addEventListener('click', closeModal);
  EL.modalOverlay().addEventListener('click', (e) => { if (e.target === EL.modalOverlay()) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !EL.modalOverlay().classList.contains('hidden')) closeModal(); });
}
