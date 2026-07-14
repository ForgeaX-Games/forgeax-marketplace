import { S } from './state.ts';
import type { AssetMeta } from './state.ts';
import { EL } from './dom.ts';
import { apiBackend } from './api.ts';
import { getCosKey, getTypeMeta, getLatestVersion, showToast } from './utils.ts';
import { renderPageSizeSelector } from './filter.ts';
import { emit } from './events.ts';

interface FindAssetMetaSearchResult {
  asset_meta_info_list?: AssetMeta[];
  total?: number;
}

export async function showSearchResults(searchText: string, page = 1): Promise<void> {
  EL.assetVersionTabs().classList.add('hidden');
  EL.leftPanel().classList.add('hidden');

  // 显示搜索结果面板 — 手动切换
  EL.placeholder().classList.add('hidden');
  EL.viewerAudio().classList.add('hidden');
  EL.filterView().classList.add('hidden');
  EL.searchResults().classList.remove('hidden');

  EL.searchLoading().classList.remove('hidden');
  EL.searchResultsGrid().innerHTML = '';
  EL.searchEmpty().classList.add('hidden');
  EL.searchPagination().classList.add('hidden');

  // wb-bgm 只接入 BGM(3)/音效(7),且仅按标签(tag)走 FindAssetMeta 检索。
  const assetType = Number((EL.searchType() as HTMLSelectElement).value) || 3;
  const typeLabel = assetType === 7 ? '音效' : 'BGM';

  EL.searchResultTitle().textContent = `搜索结果(标签·${typeLabel}): "${searchText}"`;

  try {
    let list: AssetMeta[] = [];
    let total = 0;

    const query = { depot_name: S.depotName, tag: searchText, asset_type: assetType };
    const result = (await apiBackend('FindAssetMeta', {
      query,
      pagination: { page_num: page, page_size: S.pageSize, is_need_total_num: true },
    })) as FindAssetMetaSearchResult;
    list = result.asset_meta_info_list || [];
    total = result.total || 0;

    EL.searchLoading().classList.add('hidden');

    if (!list.length) {
      EL.searchEmpty().classList.remove('hidden');
      return;
    }

    const grid = EL.searchResultsGrid();
    list.forEach(asset => {
      const tm = getTypeMeta(asset.type);
      const cosKey = getCosKey(asset);

      const latestVer = getLatestVersion(asset);
      let thumbUrl = latestVer?.thumbnail_url || '';
      if (!thumbUrl && (asset.type === 2)) {
        thumbUrl = latestVer?.res_url || '';
      }

      const card = document.createElement('div');
      card.className = 'asset-card';

      const scoreHtml = asset.score !== undefined ?
        `<span class="similarity-score" title="score: ${asset.score}">${asset.score}</span>` : '';

      card.innerHTML = `
        <div class="asset-thumb">${thumbUrl
          ? `<img src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='${tm.icon}'">`
          : tm.icon
        }
          <div class="asset-type-badge">${tm.icon} ${tm.label}</div>
          ${scoreHtml}
        </div>
        <div class="asset-info">
          <div class="asset-name" title="${asset.name}">${asset.name}</div>
          <div class="asset-desc" title="${asset.description || ''}">${asset.description || '无描述'}</div>
        </div>
      `;
      card.onclick = () => emit('modal-open', asset, cosKey);
      grid.appendChild(card);
    });

    if (total > S.pageSize) {
      renderSearchPagination(searchText, page, total);
    }
  } catch (e) {
    EL.searchLoading().classList.add('hidden');
    showToast(`搜索出错: ${e instanceof Error ? e.message : String(e)}`, 'error');
    console.error('[Search] 错误:', e);
  }
}

function renderSearchPagination(searchText: string, currentPage: number, total: number): void {
  const pageSize = S.pageSize;
  const totalPages = Math.ceil(total / pageSize);
  const pg = EL.searchPagination();
  pg.innerHTML = '';
  if (total <= 20) {
    pg.classList.add('hidden');
    return;
  }

  pg.classList.remove('hidden');

  const addBtn = (label: string, page: number, active = false, disabled = false): void => {
    const b = document.createElement('button');
    b.className = `page-btn${active ? ' active' : ''}`;
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.onclick = () => { void showSearchResults(searchText, page); };
    pg.appendChild(b);
  };

  addBtn('«', currentPage - 1, false, currentPage === 1);
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
      addBtn(String(i), i, i === currentPage);
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      const span = document.createElement('span');
      span.textContent = '...';
      span.className = 'page-ellipsis';
      pg.appendChild(span);
    }
  }
  addBtn('»', currentPage + 1, false, currentPage === totalPages);

  renderPageSizeSelector(pg, () => { void showSearchResults(searchText, 1); });
}
