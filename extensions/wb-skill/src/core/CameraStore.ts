// @source wb-character/src/core/CameraStore.ts
import type { CameraPreset } from './types'

const STORAGE_KEY = 'character-editor:camera-presets'

const DEFAULT_PRESET: CameraPreset = {
  name: 'default',
  position: [0, 5, 10],
  target: [0, 0, 0],
  fov: 60,
}

export class CameraStore {
  private presets = new Map<string, CameraPreset>()
  private loaded = false

  async init(): Promise<void> {
    if (this.loaded) return
    this.presets.set(DEFAULT_PRESET.name, DEFAULT_PRESET)

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const local: CameraPreset[] = JSON.parse(stored)
        for (const p of local) this.presets.set(p.name, p)
      }
    } catch { /* localStorage unavailable */ }

    this.loaded = true
  }

  get(name: string): CameraPreset | undefined {
    return this.presets.get(name)
  }

  getDefault(): CameraPreset | undefined {
    return this.presets.get('default') ?? this.presets.values().next().value
  }

  getAll(): CameraPreset[] {
    return [...this.presets.values()]
  }

  save(preset: CameraPreset): void {
    this.presets.set(preset.name, preset)
    this.persist()
  }

  remove(name: string): void {
    this.presets.delete(name)
    this.persist()
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.presets.values()]))
    } catch { /* localStorage unavailable */ }
  }

  exportJSON(): string {
    return JSON.stringify([...this.presets.values()], null, 2)
  }
}
