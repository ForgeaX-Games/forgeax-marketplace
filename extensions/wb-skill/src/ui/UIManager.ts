import type { Engine } from '../core/Engine'
import type { SceneManager } from '../core/SceneManager'
import type { CameraStore } from '../core/CameraStore'
import type { PipelineRegistry } from '../core/PipelineRegistry'
import type { PipelineContext } from '../core/types'
import { SceneSelector } from './SceneSelector'
import { PipelinePanel } from './PipelinePanel'
import { PreviewControls } from './PreviewControls'
import './styles.css'

export class UIManager {
  private topbar!: HTMLElement
  private leftPanel!: HTMLElement
  private centerOverlay!: HTMLElement
  private centerToolbar!: HTMLElement
  private rightPanel!: HTMLElement
  private bottomPanel!: HTMLElement
  private gameHud: HTMLElement | null = null
  private rightObserver: MutationObserver | null = null

  private sceneSelector!: SceneSelector
  private pipelinePanel!: PipelinePanel
  private previewControls!: PreviewControls

  constructor(
    private uiRoot: HTMLElement,
    private engine: Engine,
    private sceneManager: SceneManager,
    private cameraStore: CameraStore,
    private registry: PipelineRegistry,
    private context: PipelineContext,
  ) {}

  init(): void {
    this.topbar = document.createElement('div')
    this.topbar.className = 'editor-topbar'
    this.uiRoot.appendChild(this.topbar)

    this.leftPanel = document.createElement('div')
    this.leftPanel.className = 'editor-left'
    this.uiRoot.appendChild(this.leftPanel)

    const centerArea = document.createElement('div')
    centerArea.className = 'editor-center'
    this.uiRoot.appendChild(centerArea)

    this.centerToolbar = document.createElement('div')
    this.centerToolbar.className = 'editor-center-toolbar'
    centerArea.appendChild(this.centerToolbar)

    this.centerOverlay = document.createElement('div')
    this.centerOverlay.className = 'editor-center-overlay'
    centerArea.appendChild(this.centerOverlay)

    this.rightPanel = document.createElement('div')
    this.rightPanel.className = 'editor-right'
    this.uiRoot.appendChild(this.rightPanel)

    this.bottomPanel = document.createElement('div')
    this.bottomPanel.className = 'editor-bottom'
    this.uiRoot.appendChild(this.bottomPanel)

    this.previewControls = new PreviewControls(this.engine, this.cameraStore)

    this.sceneSelector = new SceneSelector(this.topbar, this.sceneManager)
    const manifest = this.sceneManager.getManifest()
    if (manifest) this.sceneSelector.render(manifest)

    const divider = document.createElement('div')
    divider.className = 'topbar-divider'
    this.topbar.appendChild(divider)

    this.pipelinePanel = new PipelinePanel(
      this.topbar,
      this.leftPanel,
      { center: this.centerOverlay, right: this.rightPanel, bottom: this.bottomPanel, toolbar: this.centerToolbar },
      this.registry,
      this.context,
      { engine: this.engine, previewControls: this.previewControls, cameraStore: this.cameraStore, sceneManager: this.sceneManager },
    )
    this.pipelinePanel.render()

    this.gameHud = document.getElementById('game-hud')
    if (this.gameHud) {
      this.syncGameHudRight()
      this.rightObserver = new MutationObserver(() => this.syncGameHudRight())
      this.rightObserver.observe(this.rightPanel, { attributes: true, attributeFilter: ['class'] })
    }
  }

  private syncGameHudRight(): void {
    if (!this.gameHud) return
    const rightVisible = this.rightPanel.classList.contains('visible')
    this.gameHud.classList.toggle('has-right', rightVisible)
  }

  getPreviewControls(): PreviewControls { return this.previewControls }

  dispose(): void {
    this.rightObserver?.disconnect()
    this.pipelinePanel.dispose()
    this.previewControls.dispose()
    this.sceneSelector.dispose()
    this.topbar.remove()
    this.leftPanel.remove()
    this.rightPanel.remove()
    this.bottomPanel.remove()
  }
}
