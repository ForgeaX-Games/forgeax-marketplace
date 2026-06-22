import type { AssetMeta } from './state.ts';

export interface EventMap {
  'asset-select': [asset: AssetMeta];
  'modal-open': [asset: AssetMeta, cosKey: string];
}

type EventName = keyof EventMap;

const handlers: { [K in EventName]?: Array<(...args: EventMap[K]) => void> } = {};

export function on<K extends EventName>(event: K, fn: (...args: EventMap[K]) => void): void {
  (handlers[event] ||= []).push(fn as never);
}

export function emit<K extends EventName>(event: K, ...args: EventMap[K]): void {
  const list = handlers[event];
  if (list) {
    for (const fn of list) {
      (fn as (...a: unknown[]) => void)(...args);
    }
  }
}
