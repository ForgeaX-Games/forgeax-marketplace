import type { IEventBus } from './types'

type Handler = (...args: unknown[]) => void

export class EventBus implements IEventBus {
  private listeners = new Map<string, Set<Handler>>()

  on(event: string, handler: Handler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  off(event: string, handler: Handler): void {
    this.listeners.get(event)?.delete(handler)
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    for (const h of handlers) {
      try { h(...args) } catch (e) { console.error(`[EventBus] ${event}:`, e) }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
