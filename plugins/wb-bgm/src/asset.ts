import { EL } from './dom.ts';
import { getLatestVersion, getCosKeyForVersion, isZip, basename, showToast, setViewerPanel } from './utils.ts';
import type { AssetMeta, VersionInfo } from './state.ts';
import { proxyUrl } from './proxyUrl.ts';
import { audioKindOf } from './config.ts';
import { attachToGame, type AudioSelection } from './attach.ts';
import { openGamePicker } from './gameSelect.ts';

/** 当前正在试听的 BGM/音效选择，供「配入游戏」使用。 */
let currentAudioSel: AudioSelection | null = null;

function showAudio(label: string, directUrl: string): void {
  setViewerPanel('viewerAudio');
  EL.audioName().textContent = label;
  const player = EL.audioPlayer() as HTMLAudioElement;
  player.src = directUrl;
  player.load();
}

function showUnsupported(cosKey: string): void {
  currentAudioSel = null;
  setViewerPanel(null);
  EL.placeholder().classList.remove('hidden');
  const p = EL.placeholder().querySelector('p');
  if (p) p.textContent = `暂不支持预览：${basename(cosKey)}`;
}

export async function openAsset(asset: AssetMeta): Promise<void> {
  if (!asset) return;

  const versions = asset.versions || [];
  const latestVer = getLatestVersion(asset) || versions[0];

  if (versions.length > 1) {
    EL.assetVersionTabs().classList.remove('hidden');
    const container = EL.assetVersionTabs();
    container.innerHTML = '<span style="font-size: 13px; font-weight: 600; color: var(--text-2); margin-right: 4px;">【版本】</span>';
    versions.forEach(v => {
      const btn = document.createElement('button');
      btn.className = 'version-tab';
      if (v === latestVer) btn.classList.add('active');
      const verName = v.display_version_name || v.version_name || '未知';
      btn.textContent = verName === '未知' ? verName : `${verName} 版本`;
      btn.onclick = () => {
        container.querySelectorAll('.version-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        openAssetVersion(asset, v);
      };
      container.appendChild(btn);
    });
  } else {
    EL.assetVersionTabs().classList.add('hidden');
    EL.assetVersionTabs().innerHTML = '';
  }

  openAssetVersion(asset, latestVer);
}

function openAssetVersion(asset: AssetMeta, versionObj: VersionInfo | undefined): void {
  const cosKey = getCosKeyForVersion(asset, versionObj ?? null);
  if (!cosKey) return;

  const type = asset?.type;
  if (!versionObj) {
    showToast('该资产暂无可用版本（未发布或版本信息异常）', 'error');
    return;
  }
  const downloadUrl = versionObj.res_url || '';

  // wb-bgm only addresses BGM(3) / SFX(7). Audio assets are served as a direct
  // (non-zip) URL — play them. Anything else falls back to "unsupported".
  if ((type === 3 || type === 7) && !isZip(cosKey)) {
    currentAudioSel = {
      assetId: asset.asset_id || asset.id || '',
      name: asset.display_name || asset.name || basename(cosKey),
      kind: audioKindOf(type),
      version: versionObj.display_version_name || versionObj.version_name || '',
      resUrl: downloadUrl,
      filename: basename(cosKey),
    };
    showAudio(basename(cosKey), proxyUrl(downloadUrl));
    return;
  }

  showUnsupported(cosKey);
}

export function initAudioAttach(): void {
  const btn = EL.attachAudioBtn() as HTMLButtonElement;
  if (btn) btn.addEventListener('click', () => {
    if (!currentAudioSel) { void attachToGame(currentAudioSel, btn, ''); return; }
    void openGamePicker(btn, (slug) => { void attachToGame(currentAudioSel, btn, slug); });
  });
}
