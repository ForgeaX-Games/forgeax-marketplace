import './style.css';

import { S, assetCache } from './state.ts';
import type { AssetMeta } from './state.ts';
import { EL } from './dom.ts';
import { on } from './events.ts';
import { showToast, setViewerPanel } from './utils.ts';
import { loadFileTree } from './tree.ts';
import { loadFilterView } from './filter.ts';
import { showSearchResults } from './search.ts';
import { openAsset, initAudioAttach } from './asset.ts';
import { openModal, initModal } from './modal.ts';
import { PlatformBridge } from './platform/Bridge.ts';

// ==================== Platform Bridge ====================

const bridge = new PlatformBridge();

// ==================== 事件总线 Wiring ====================

on('asset-select', (asset: AssetMeta) => openAsset(asset));
on('modal-open', (asset: AssetMeta, cosKey: string) => openModal(asset, cosKey));

// ==================== Tab 切换 ====================

function initTabs(): void {
  EL.tabsBar().addEventListener('click', (e: Event) => {
    const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLElement | null;
    if (!btn) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const typeRaw = btn.dataset.type;
    if (typeRaw === '') {
      S.viewMode   = 'filemanager';
      S.activeType = null;
      S.search     = '';
      (EL.searchInput() as HTMLInputElement).value = '';
      EL.leftPanel().classList.remove('hidden');
      EL.fileTreeView().classList.remove('hidden');
      EL.panelTitle().textContent = '文件管理器';
      EL.assetVersionTabs().classList.add('hidden');
      setViewerPanel('viewerPlaceholder');
      if (!S.fileTree) loadFileTree();
    } else {
      S.viewMode   = 'filter';
      S.activeType = parseInt(typeRaw!);
      S.search     = '';
      S.page       = 1;
      (EL.searchInput() as HTMLInputElement).value = '';
      EL.leftPanel().classList.add('hidden');
      setViewerPanel('filterView');
      loadFilterView(S.activeType, 1);
    }
  });
}

// ==================== 搜索 ====================

function initSearch(): void {
  const run = () => {
    const searchText = (EL.searchInput() as HTMLInputElement).value.trim();
    if (!searchText) {
      showToast('请输入搜索关键词', 'warning');
      return;
    }
    S.search = searchText;
    S.page = 1;
    showSearchResults(searchText);
  };
  const btn = document.getElementById('searchBtn');
  if (btn) btn.addEventListener('click', run);
  EL.searchInput().addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') run();
  });

  EL.closeSearchBtn().addEventListener('click', () => {
    EL.leftPanel().classList.remove('hidden');
    setViewerPanel(null);
    EL.placeholder().classList.remove('hidden');
    (EL.searchInput() as HTMLInputElement).value = '';
    S.search = '';
  });
}

// ==================== 刷新 ====================

function initRefresh(): void {
  EL.refreshBtn().addEventListener('click', () => {
    const btn = EL.refreshBtn();
    btn.classList.add('spin');
    (btn as HTMLButtonElement).disabled = true;

    assetCache.data = null;
    assetCache.ts = 0;
    S.fileTree = null;
    showToast('缓存已清除，正在重新加载...', 'success');

    const done = () => {
      btn.classList.remove('spin');
      (btn as HTMLButtonElement).disabled = false;
    };

    if (S.viewMode === 'filemanager') {
      loadFileTree(true).then(done);
    } else if (S.activeType) {
      loadFilterView(S.activeType, 1).then(done);
    } else {
      done();
    }
  });
}

// ==================== Platform Bridge Wiring ====================

bridge.onMessage((msg) => {
  switch (msg.type) {
    case 'refresh':
      assetCache.data = null;
      assetCache.ts = 0;
      loadFileTree(true);
      break;
    case 'search':
      if (msg.query) {
        S.search = msg.query;
        showSearchResults(msg.query);
      }
      break;
  }
});

// ==================== 初始化 ====================

function init(): void {
  initTabs();
  initSearch();
  initRefresh();
  initModal();
  initAudioAttach();
  loadFileTree().then(() => {
    bridge.sendReady();
    bridge.sendStateChange({ status: 'idle' });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
