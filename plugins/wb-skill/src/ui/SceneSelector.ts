import type { SceneManifest } from '../core/types'
import type { SceneManager } from '../core/SceneManager'

export class SceneSelector {
  private select: HTMLSelectElement | null = null

  constructor(
    private container: HTMLElement,
    private sceneManager: SceneManager,
  ) {}

  render(manifest: SceneManifest): void {
    this.select = document.createElement('select')
    for (const scene of manifest.scenes) {
      const opt = document.createElement('option')
      opt.value = scene.id
      opt.textContent = scene.name
      this.select.appendChild(opt)
    }

    const current = this.sceneManager.getCurrentSceneId()
    if (current) this.select.value = current

    this.select.addEventListener('change', () => {
      this.sceneManager.loadScene(this.select!.value).catch(console.error)
    })

    const label = document.createElement('span')
    label.textContent = '场景'
    label.style.color = 'var(--text-secondary)'

    this.container.appendChild(label)
    this.container.appendChild(this.select)
  }

  dispose(): void {
    this.select?.remove()
  }
}
