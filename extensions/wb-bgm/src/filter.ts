import { S } from './state.ts';
import type { AssetMeta } from './state.ts';
import { EL } from './dom.ts';
import { fetchPage } from './api.ts';
import { getCosKey, getTypeMeta, getLatestVersion } from './utils.ts';
import { emit } from './events.ts';

interface FindAssetPageResult {
  asset_meta_info_list?: AssetMeta[];
  total?: number;
}

export async function loadFilterView(type: number, page = 1): Promise<void> {
  EL.assetVersionTabs().classList.add('hidden');
  S.page = page;
  EL.assetGrid().innerHTML   = '';
  EL.filterLoading().classList.remove('hidden');
  EL.filterEmpty().classList.add('hidden');
  EL.filterError().classList.add('hidden');
  EL.pagination().classList.add('hidden');

  try {
    const d    = (await fetchPage(type, page, S.pageSize, S.search)) as FindAssetPageResult;
    const list = d.asset_meta_info_list || [];
    S.total    = d.total || list.length;

    EL.filterLoading().classList.add('hidden');
    EL.panelCount().textContent = String(S.total);

    if (!list.length) {
      EL.filterEmpty().classList.remove('hidden');
      return;
    }
    renderAssetGrid(list);
    renderPagination(type);
  } catch (e) {
    EL.filterLoading().classList.add('hidden');
    EL.filterErrorMsg().textContent = e instanceof Error ? e.message : String(e);
    EL.filterError().classList.remove('hidden');
    EL.filterRetry().onclick = () => { void loadFilterView(type, page); };
  }
}

function renderAssetGrid(assets: AssetMeta[]): void {
  const grid = EL.assetGrid();
  grid.innerHTML = '';
  assets.forEach(asset => {
    const cosKey = getCosKey(asset);
    const tm     = getTypeMeta(asset.type);

    const latestVer = getLatestVersion(asset);
    let thumbUrl = latestVer?.thumbnail_url || '';
    if (!thumbUrl && (asset.type === 2)) {
      thumbUrl = latestVer?.res_url || '';
    }


    const card = document.createElement('div');
    card.className   = 'asset-card';
    card.dataset.cosKey = cosKey;

    const tags = [...(asset.custom_tags || []), ...(asset.gen_tags || [])].slice(0, 3);
    card.innerHTML = `
      <div class="asset-thumb">${thumbUrl
        ? `<img src="${thumbUrl}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${tm.icon}'">`
        : tm.icon
      }</div>
      <div class="asset-info">
        <div class="asset-name" title="${asset.name || ''}">${asset.name || '—'}</div>
        <div class="asset-sub">${asset.description || ''}</div>
        ${tags.length ? `<div class="asset-tags">${tags.map(t => `<span class="asset-tag">${t}</span>`).join('')}</div>` : ''}
      </div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.asset-card.selected').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      emit('modal-open', asset, cosKey);
    });
    grid.appendChild(card);
  });
}

export function renderPageSizeSelector(container: HTMLElement, onChangeCallback: () => void): void {
  const sizeSelectWrapper = document.createElement('div');
  sizeSelectWrapper.className = 'page-size-wrapper';
  sizeSelectWrapper.style.display = 'inline-block';
  sizeSelectWrapper.style.marginLeft = '15px';
  sizeSelectWrapper.style.verticalAlign = 'middle';
  sizeSelectWrapper.innerHTML = `
    <select class="page-size-select" style="padding:4px 8px;border-radius:4px;background:var(--bg-3);color:var(--text-1);border:1px solid var(--border);outline:none;font-size:13px;cursor:pointer;">
      <option value="20" ${S.pageSize === 20 ? 'selected' : ''}>20 条/页</option>
      <option value="50" ${S.pageSize === 50 ? 'selected' : ''}>50 条/页</option>
      <option value="100" ${S.pageSize === 100 ? 'selected' : ''}>100 条/页</option>
    </select>
  `;
  const select = sizeSelectWrapper.querySelector('select');
  if (select) {
    select.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      S.pageSize = parseInt(t.value, 10);
      onChangeCallback();
    });
  }
  container.appendChild(sizeSelectWrapper);
}

function renderPagination(type: number): void {
  const total = Math.ceil(S.total / S.pageSize);
  const pg = EL.pagination();
  pg.innerHTML = '';
  if (S.total <= 20) {
    pg.classList.add('hidden');
    return;
  }
  pg.classList.remove('hidden');

  const addBtn = (label: string, page: number, disabled = false, active = false): void => {
    const b = document.createElement('button');
    b.className = `page-btn${active ? ' active' : ''}`;
    b.textContent = label;
    if (disabled) b.disabled = true;
    else b.onclick = () => { void loadFilterView(type, page); };
    pg.appendChild(b);
  };

  addBtn('‹', S.page - 1, S.page === 1);
  const start = Math.max(1, S.page - 2);
  const end   = Math.min(total, S.page + 2);
  if (start > 1) { addBtn('1', 1); if (start > 2) pg.insertAdjacentHTML('beforeend', '<span style="padding:0 4px;color:var(--text-3)">…</span>'); }
  for (let i = start; i <= end; i++) addBtn(String(i), i, false, i === S.page);
  if (end < total) { if (end < total - 1) pg.insertAdjacentHTML('beforeend', '<span style="padding:0 4px;color:var(--text-3)">…</span>'); addBtn(String(total), total); }
  addBtn('›', S.page + 1, S.page === total);

  renderPageSizeSelector(pg, () => { void loadFilterView(type, 1); });
}
