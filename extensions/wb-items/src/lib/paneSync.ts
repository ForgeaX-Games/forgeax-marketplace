/** split-pane 下 left/center 各跑一份 React，生成完成后需广播刷新图标库。 */
const CHANNEL = 'forgeax-plugin.@forgeax-extension/wb-items.refresh';

export function broadcastItemsRefresh(reason = 'items-changed'): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: 'items-refresh', at: Date.now(), reason });
    bc.close();
  } catch {
    /* ignore */
  }
}

export function installItemsRefreshListener(onRefresh: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const bc = new BroadcastChannel(CHANNEL);
  bc.onmessage = (ev: MessageEvent) => {
    if (ev.data?.type === 'items-refresh') onRefresh();
  };
  return () => bc.close();
}
