import type { SceneManifest } from '../core/types'
import type { SceneManager } from '../core/SceneManager'
import { t, onLocaleChange } from '../i18n'

export class SceneSelector {
  private select: HTMLSelectElement | null = null
  private labelEl: HTMLSpanElement | null = null
  private localeUnsub: (() => void) | null = null

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
    label.textContent = t('scene.label')
    label.style.color = 'var(--text-secondary)'
    this.labelEl = label

    this.container.appendChild(label)
    this.container.appendChild(this.select)

    this.localeUnsub = onLocaleChange(() => {
      if (this.labelEl) this.labelEl.textContent = t('scene.label')
    })
  }

  dispose(): void {
    this.localeUnsub?.()
    this.select?.remove()
    this.labelEl?.remove()
  }
}
