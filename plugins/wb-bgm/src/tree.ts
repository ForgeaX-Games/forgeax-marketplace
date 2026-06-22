import { S } from './state.ts';
import type { TreeNode, AssetMeta } from './state.ts';
import { EL } from './dom.ts';
import { fetchAllAssetsStream } from './api.ts';
import { getCosKey, getTypeMeta, isZip, simpleHash, showToast } from './utils.ts';
import { emit } from './events.ts';

let _abortCurrentStream: (() => void) | null = null;

function renderTreeNode(name: string, node: TreeNode, depth: number): HTMLElement {
  if (node._type === 'folder') {
    const wrap = document.createElement('div');
    const item = document.createElement('div');
    item.className = 'tree-item tree-folder';
    item.style.paddingLeft = `${depth * 14 + 8}px`;
    item.innerHTML = `<span class="tree-arrow">▶</span><span class="tree-icon">📁</span><span class="tree-name">${name}</span>`;

    const children = document.createElement('div');
    children.className = 'tree-children hidden';
    let isRendered = false;

    item.addEventListener('click', e => {
      e.stopPropagation();
      if (!isRendered) {
        Object.keys(node.children).sort().forEach(k => {
          children.appendChild(renderTreeNode(k, node.children[k], depth + 1));
        });
        isRendered = true;
      }
      const open = !children.classList.contains('hidden');
      children.classList.toggle('hidden');
      (item.querySelector('.tree-arrow') as HTMLElement).textContent = open ? '▶' : '▼';
    });

    wrap.appendChild(item);
    wrap.appendChild(children);
    return wrap;
  }

  const asset = node._asset;
  const cosKey = node._cosKey || '';
  const tm = getTypeMeta(asset?.type);
  const zip = isZip(cosKey);
  const hashId = simpleHash(cosKey);

  const item = document.createElement('div');
  item.className = 'tree-item tree-asset';
  item.style.paddingLeft = `${depth * 14 + 8}px`;
  item.dataset.cosKey = cosKey;
  item.innerHTML = `
    <span class="tree-arrow" style="visibility:hidden">▶</span>
    <span class="tree-icon">${zip ? tm.icon : '🖼️'}</span>
    <span class="tree-name" title="${cosKey}">${name}</span>
    <span class="tree-type-badge">${tm.label}</span>
    <span class="tree-cached-dot hidden" id="cd-${hashId}">●</span>
  `;

  item.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.tree-asset.selected').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    if (cosKey) emit('asset-select', asset as AssetMeta);
  });

  return item;
}

function mergeAssetsIntoTree(root: TreeNode, newAssets: AssetMeta[]): Set<string> {
  const newTopKeys = new Set<string>();
  for (const asset of newAssets) {
    const cosKey = getCosKey(asset);
    if (!cosKey) continue;
    const parts = cosKey.replace(/\\/g, '/').split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    parts[parts.length - 1] = last.replace(/\.zip$/i, '');

    if (parts.length > 0) newTopKeys.add(parts[0]);

    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!node.children[p]) {
        node.children[p] = {
          _type: i === parts.length - 1 ? 'asset' : 'folder',
          _asset: null,
          _cosKey: null,
          _name: p,
          children: {},
        };
      }
      if (i === parts.length - 1) {
        node.children[p]._asset = asset;
        node.children[p]._cosKey = cosKey;
        node.children[p]._type = 'asset';
      }
      node = node.children[p];
    }
  }
  return newTopKeys;
}

export function loadFileTree(forceRefresh = false): Promise<void> {
  const t0 = performance.now();

  if (_abortCurrentStream) { _abortCurrentStream(); _abortCurrentStream = null; }

  const loadingEl = EL.treeLoading();
  const loadingText = document.getElementById('treeLoadingText');
  const container = EL.treeContainer();

  loadingEl.classList.remove('hidden');
  container.classList.add('hidden');
  EL.treeEmpty().classList.add('hidden');

  S.fileTree = { _type: 'root', children: {} } as TreeNode;
  container.innerHTML = '';
  let totalAssetCount = 0;
  const renderedTopNodes: Record<string, HTMLElement> = {};

  return new Promise((resolve) => {
    _abortCurrentStream = fetchAllAssetsStream({
      forceRefresh,

      onChunk(chunkAssets, progress, totalTypes) {
        if (!chunkAssets.length) return;
        totalAssetCount += chunkAssets.length;

        if (loadingText) {
          loadingText.textContent = `正在加载资产数据 (${progress}/${totalTypes})... 已收到 ${totalAssetCount} 条`;
        }

        const affectedTopKeys = mergeAssetsIntoTree(S.fileTree!, chunkAssets);
        const fragment = document.createDocumentFragment();
        const sortedKeys = Object.keys(S.fileTree!.children).sort();

        for (const key of sortedKeys) {
          if (!affectedTopKeys.has(key)) continue;
          const newNode = renderTreeNode(key, S.fileTree!.children[key], 0);
          if (renderedTopNodes[key]) {
            container.replaceChild(newNode, renderedTopNodes[key]);
          } else {
            const nextKey = sortedKeys[sortedKeys.indexOf(key) + 1];
            const refNode = nextKey ? renderedTopNodes[nextKey] : null;
            if (refNode) {
              container.insertBefore(newNode, refNode);
            } else {
              fragment.appendChild(newNode);
            }
          }
          renderedTopNodes[key] = newNode;
        }

        if (fragment.childNodes.length) container.appendChild(fragment);

        container.classList.remove('hidden');
        EL.panelCount().textContent = String(totalAssetCount);
      },

      onDone(allAssets) {
        _abortCurrentStream = null;
        loadingEl.classList.add('hidden');
        if (loadingText) loadingText.textContent = '正在从服务端加载资产数据...';

        if (!allAssets.length) {
          EL.treeEmpty().classList.remove('hidden');
          EL.panelCount().textContent = '0';
        } else {
          EL.panelCount().textContent = String(allAssets.length);
        }

        console.log(`[FileTree] 流式加载完成: ${allAssets.length} 条, 总耗时 ${(performance.now() - t0).toFixed(0)}ms`);
        resolve();
      },

      onError(err) {
        _abortCurrentStream = null;
        loadingEl.classList.add('hidden');
        if (loadingText) loadingText.textContent = '正在从服务端加载资产数据...';
        EL.treeEmpty().classList.remove('hidden');
        console.error('[FileTree] 加载失败:', err);
        showToast(`加载文件树失败: ${err.message}`, 'error');
        resolve();
      },
    });
  });
}
