import { attachToGame, type AttachedAudioResult, type AudioSelection } from './attach.ts';
import { openGamePicker } from './gameSelect.ts';
import { showToast } from './utils.ts';

type CustomAudioKind = 'bgm' | 'sfx';

export interface CustomAudioAsset {
  assetId: string;
  kind: CustomAudioKind;
  originalName: string;
  relativePath: string;
  extension: '.ogg' | '.mp3' | '.wav';
  mimeType: 'audio/ogg' | 'audio/mpeg' | 'audio/wav';
  bytes: number;
  sha256: string;
  version: string;
  source: 'custom';
  previewUrl: string;
  createdAt: string;
}

interface ToolEnvelope<T> {
  ok?: boolean;
  result?: T;
  error?: string;
}

interface CustomAudioUiOptions {
  onChanged?: () => void;
  onBind?: (
    asset: CustomAudioAsset,
    slug: string,
    attached: AttachedAudioResult,
  ) => void;
}

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};

async function callCustomAudioTool<T>(toolId: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/tools/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, args, caller: { kind: 'user' } }),
  });
  const envelope = await response.json().catch(() => ({})) as ToolEnvelope<T>;
  if (!response.ok || !envelope.ok || envelope.result === undefined) {
    throw new Error(envelope.error || `${toolId} 调用失败（HTTP ${response.status}）`);
  }
  return envelope.result;
}

function mimeForFile(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'ogg') return 'audio/ogg';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  return 'application/octet-stream';
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function selection(asset: CustomAudioAsset): AudioSelection {
  return {
    assetId: asset.assetId,
    name: asset.originalName,
    kind: asset.kind,
    version: asset.version,
    resUrl: asset.previewUrl,
    filename: asset.originalName,
  };
}

export function initCustomAudioUi(options: CustomAudioUiOptions = {}): {
  refresh: () => Promise<void>;
} {
  let assets: CustomAudioAsset[] = [];
  let selected: CustomAudioAsset | null = null;
  let filter: CustomAudioKind | 'all' = 'all';
  let pendingImportKind: CustomAudioKind = 'bgm';

  const renderPreview = (): void => {
    const empty = byId('customAudioPreviewEmpty');
    const preview = byId('customAudioPreview');
    empty.classList.toggle('hidden', Boolean(selected));
    preview.classList.toggle('hidden', !selected);
    const player = byId<HTMLAudioElement>('customAudioPlayer');
    if (!selected) {
      player.pause();
      player.removeAttribute('src');
      player.load();
      return;
    }
    byId('customAudioPreviewTitle').textContent = selected.originalName;
    byId('customAudioPreviewMeta').textContent = selected.assetId;
    byId('customAudioFileName').textContent = selected.originalName;
    byId('customAudioFormat').textContent = selected.extension.slice(1).toUpperCase();
    byId('customAudioKind').textContent = selected.kind === 'bgm' ? 'BGM' : '音效';
    byId('customAudioDuration').textContent = '读取中';
    byId('changeCustomAudioKindBtn').textContent = selected.kind === 'bgm' ? '更改为音效' : '更改为 BGM';
    player.src = selected.previewUrl;
    player.load();
  };

  const renderList = (): void => {
    const visible = assets.filter((asset) => filter === 'all' || asset.kind === filter);
    byId('customAudioCount').textContent = `${visible.length} 项`;
    byId('customAudioEmpty').classList.toggle('hidden', visible.length > 0);
    const list = byId('customAudioList');
    list.innerHTML = '';
    for (const asset of visible) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `custom-audio-row${selected?.assetId === asset.assetId ? ' is-selected' : ''}`;
      const icon = document.createElement('span');
      icon.className = 'custom-audio-kind-badge';
      icon.textContent = asset.kind === 'bgm' ? 'BGM' : '音效';
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = asset.originalName;
      const meta = document.createElement('small');
      meta.textContent = `${asset.extension.slice(1).toUpperCase()} · ${(asset.bytes / 1024).toFixed(1)} KB`;
      text.append(title, meta);
      row.append(icon, text);
      row.addEventListener('click', () => {
        selected = asset;
        renderList();
        renderPreview();
      });
      list.appendChild(row);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const result = await callCustomAudioTool<{ assets: CustomAudioAsset[] }>(
        'list-custom-audio',
        {},
      );
      assets = result.assets;
      if (selected) selected = assets.find((asset) => asset.assetId === selected?.assetId) ?? null;
      renderList();
      renderPreview();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  const importFiles = async (files: FileList | null): Promise<void> => {
    const accepted = [...(files ?? [])].filter((file) => /\.(ogg|mp3|wav)$/i.test(file.name));
    if (!accepted.length) {
      showToast('请选择 OGG、MP3 或 WAV 文件', 'warning');
      return;
    }
    const status = byId('customAudioImportStatus');
    let cursor = 0;
    let succeeded = 0;
    const failures: string[] = [];
    const worker = async (): Promise<void> => {
      while (cursor < accepted.length) {
        const file = accepted[cursor++]!;
        status.textContent = `正在导入 ${succeeded + failures.length + 1}/${accepted.length}：${file.name}`;
        try {
          await callCustomAudioTool('import-custom-audio', {
            kind: pendingImportKind,
            fileName: file.name,
            mimeType: mimeForFile(file),
            base64: await fileBase64(file),
          });
          succeeded += 1;
        } catch (error) {
          failures.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, accepted.length) }, () => worker()));
    status.textContent = `导入完成：成功 ${succeeded}，失败 ${failures.length}`;
    if (failures.length) showToast(failures.slice(0, 3).join('；'), 'warning');
    else showToast(`已导入 ${succeeded} 个${pendingImportKind === 'bgm' ? ' BGM' : '音效'}`, 'success');
    await refresh();
    options.onChanged?.();
  };

  const choose = (kind: CustomAudioKind, folder: boolean): void => {
    pendingImportKind = kind;
    const input = byId<HTMLInputElement>(folder ? 'customAudioFolderInput' : 'customAudioFileInput');
    input.value = '';
    input.click();
  };

  byId('importCustomBgmBtn').addEventListener('click', () => choose('bgm', false));
  byId('importCustomSfxBtn').addEventListener('click', () => choose('sfx', false));
  byId('importCustomBgmFolderBtn').addEventListener('click', () => choose('bgm', true));
  byId('importCustomSfxFolderBtn').addEventListener('click', () => choose('sfx', true));
  byId<HTMLInputElement>('customAudioFileInput').addEventListener('change', (event) => {
    void importFiles((event.target as HTMLInputElement).files);
  });
  byId<HTMLInputElement>('customAudioFolderInput').addEventListener('change', (event) => {
    void importFiles((event.target as HTMLInputElement).files);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-custom-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.customKind;
      filter = value === 'bgm' || value === 'sfx' ? value : 'all';
      document.querySelectorAll<HTMLButtonElement>('[data-custom-kind]').forEach((candidate) => {
        candidate.classList.toggle('is-selected', candidate === button);
      });
      renderList();
    });
  });
  byId<HTMLAudioElement>('customAudioPlayer').addEventListener('loadedmetadata', (event) => {
    const duration = (event.target as HTMLAudioElement).duration;
    byId('customAudioDuration').textContent = Number.isFinite(duration)
      ? `${duration.toFixed(1)} 秒`
      : '未知';
  });
  byId('deleteCustomAudioBtn').addEventListener('click', () => {
    if (!selected || !window.confirm(`删除“${selected.originalName}”的自定义资产副本？`)) return;
    void callCustomAudioTool('delete-custom-audio', { assetId: selected.assetId })
      .then(async () => {
        selected = null;
        await refresh();
        options.onChanged?.();
        showToast('自定义音频已删除', 'success');
      })
      .catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'));
  });
  byId('changeCustomAudioKindBtn').addEventListener('click', () => {
    if (!selected) return;
    const kind: CustomAudioKind = selected.kind === 'bgm' ? 'sfx' : 'bgm';
    void callCustomAudioTool<{ asset: CustomAudioAsset }>('change-custom-audio-kind', {
      assetId: selected.assetId,
      kind,
    }).then(async (result) => {
      selected = result.asset;
      await refresh();
      options.onChanged?.();
      showToast(`已改为${kind === 'bgm' ? ' BGM' : '音效'}`, 'success');
    }).catch((error) => showToast(error instanceof Error ? error.message : String(error), 'error'));
  });

  const attach = (bindAfter: boolean): void => {
    if (!selected) return;
    const asset = selected;
    const button = byId<HTMLButtonElement>(bindAfter ? 'bindCustomAudioBtn' : 'attachCustomAudioBtn');
    void openGamePicker(button, async (slug) => {
      const attached = await attachToGame(selection(asset), button, slug);
      if (attached && bindAfter) options.onBind?.(asset, slug, attached);
    });
  };
  byId('attachCustomAudioBtn').addEventListener('click', () => attach(false));
  byId('bindCustomAudioBtn').addEventListener('click', () => attach(true));

  renderList();
  renderPreview();
  return { refresh };
}
