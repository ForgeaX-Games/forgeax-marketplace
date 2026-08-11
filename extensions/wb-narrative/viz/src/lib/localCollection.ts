/**
 * 浏览器本地集合——一层可整体替换的持久化端口。
 *
 * 项目库与自定义专属团队在后端都还不存在：后端只有「一次生成落一个目录」的 entry 概念，
 * 没有用户自建的库，也没有跨任务的资产引用。所以这两样先落 localStorage。
 *
 * 读写一律用异步签名，且只经由这里。等后端补上 projects 接口时，换掉本函数的实现
 * （fetch 替 localStorage）即可，调用方一行不用改——这是先做前端而不把自己焊死的代价最小的做法。
 *
 * 跨 iframe：viz 被平台嵌成左右两个同源 iframe。storage 事件只在**其它**文档里触发，
 * 所以本地写完要自己再广播一次，否则写的那一侧反而看不到自己的变更。
 */

export interface Persisted {
  id: string;
}

export interface Collection<T extends Persisted> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  put(item: T): Promise<T>;
  remove(id: string): Promise<void>;
  /** 本框架内写入与其它 iframe 写入都会触发。 */
  subscribe(listener: (items: T[]) => void): () => void;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createLocalCollection<T extends Persisted>(storageKey: string): Collection<T> {
  const listeners = new Set<(items: T[]) => void>();

  const read = (): T[] => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  };

  const emit = (items: T[]): void => {
    for (const listener of listeners) listener(items);
  };

  const write = (items: T[]): void => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      /* 配额满或隐私模式：本轮不落盘，但界面照常更新 */
    }
    emit(items);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key !== storageKey) return;
      emit(read());
    });
  }

  return {
    async list() {
      return read();
    },
    async get(id) {
      return read().find((x) => x.id === id) ?? null;
    },
    async put(item) {
      const items = read();
      const at = items.findIndex((x) => x.id === item.id);
      if (at >= 0) items[at] = item;
      else items.push(item);
      write(items);
      return item;
    },
    async remove(id) {
      write(read().filter((x) => x.id !== id));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
