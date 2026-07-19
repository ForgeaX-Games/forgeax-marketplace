// @source wb-character/src/pipelines/spine/editor/SpineEditor.ts
import { createDefaultState, TAB_META } from './StudioState';
import type { StudioState, StudioTab, TabId } from './StudioState';
import { CharacterDesignTab } from './CharacterDesignTab';
import { ExplosionTab } from './ExplosionTab';
import { AutoBindTab } from './AutoBindTab';
import { AnimWorkshopTab } from './AnimWorkshopTab';
import { GameUploadTab } from './GameUploadTab';
import { studioSave, studioLoad, studioDelete, EDITOR_STATE_KEY } from './StudioStorage';
import { parseSpineJson, computeWorldTransforms, applyIKConstraints } from './SpineDataParser';
import { spineIcon } from './spine-icons';

const CSS_ID = 'spine-editor-css';

export class SpineEditor {
  private root!: HTMLDivElement;
  private visible = false;
  private state: StudioState;
  private tabs: StudioTab[] = [];
  private actBtns: Map<TabId, HTMLButtonElement> = new Map();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;

  private sidePanelEl!: HTMLDivElement;
  private sidePanelBody!: HTMLDivElement;
  private sideHeaderEl!: HTMLDivElement;
  private wsToolbarEl!: HTMLDivElement;
  private wsCenterEl!: HTMLDivElement;
  private wsBottomEl!: HTMLDivElement;
  private rightPanelEl!: HTMLDivElement;
  private gameMountEl!: HTMLDivElement;
  private resizeObserver: ResizeObserver | null = null;
  private currentTabId: TabId = 'design';

  constructor() {
    injectCSS();
    this.state = createDefaultState();
    this.build();
    this.asyncRestore();
    window.addEventListener('vag-studio-close', () => this.hide());
    window.addEventListener('beforeunload', () => this.autoSave());
    window.addEventListener('vag-studio-save', () => this.scheduleAutoSave());
  }

  private async asyncRestore(): Promise<void> {
    try {
      const saved = await studioLoad<any>(EDITOR_STATE_KEY);
      if (saved) {
        if (saved.profession) this.state.profession = saved.profession;
        if (saved.characterImage) this.state.characterImage = saved.characterImage;
        if (saved.explosionImage) this.state.explosionImage = saved.explosionImage;
        if (saved.activeTab) this.state.activeTab = saved.activeTab === 'game' ? 'design' : saved.activeTab;
        if (saved.partRegions) this.state.partRegions = saved.partRegions;
        if (saved.bindingJson) {
          this.state.bindingJson = saved.bindingJson;
          try {
            const skel = parseSpineJson(saved.bindingJson);
            computeWorldTransforms(skel.bones, skel.boneOrder);
            if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik);
            this.state.bindingSkeleton = skel;
          } catch (e) {
            console.warn('[Studio] Failed to rebuild skeleton from saved JSON:', e);
          }
        }
        if (saved.attachmentImages) {
          this.state.attachmentImages = new Map(Object.entries(saved.attachmentImages));
        }
        if (saved.animations) {
          this.state.animations = new Map(Object.entries(saved.animations));
        }
        if (saved.exportPath) this.state.exportPath = saved.exportPath;
        console.log('[Studio] Restored editor state from IndexedDB');
      }
    } catch (e) {
      console.warn('[Studio] Failed to restore state:', e);
    }
    this.ready = true;
  }

  get isOpen(): boolean { return this.visible; }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    this.visible = true;
    this.root.style.display = 'flex';

    if (this.ready) {
      this.switchTab(this.state.activeTab);
    } else {
      const poll = setInterval(() => {
        if (this.ready) {
          clearInterval(poll);
          this.switchTab(this.state.activeTab);
        }
      }, 50);
    }
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = 'none';
    this.tabs.forEach(t => t.deactivate());
    window.dispatchEvent(new Event('resize'));
    this.autoSave();
  }

  private build(): void {
    this.root = document.createElement('div');
    this.root.className = 'se-root';
    this.root.style.display = 'none';
    document.body.appendChild(this.root);

    const stopProp = (e: Event) => e.stopPropagation();
    for (const evt of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'contextmenu'] as const) {
      this.root.addEventListener(evt, stopProp);
    }

    const topBar = this.buildTopBar();
    this.root.appendChild(topBar);

    const main = document.createElement('div');
    main.className = 'se-main';
    this.root.appendChild(main);

    /* ── Activity bar ── */
    const actBar = document.createElement('div');
    actBar.className = 'se-activity-bar';
    main.appendChild(actBar);

    for (const meta of TAB_META) {
      const btn = document.createElement('button');
      btn.className = 'se-act-btn';
      btn.innerHTML = `<span>${spineIcon(meta.id, 'se-icon-svg')}</span><span class="se-act-label">${meta.label}</span>`;
      btn.addEventListener('click', () => this.switchTab(meta.id));
      actBar.appendChild(btn);
      this.actBtns.set(meta.id, btn);
    }

    /* ── Side panel ── */
    this.sidePanelEl = document.createElement('div');
    this.sidePanelEl.className = 'se-side-panel';
    main.appendChild(this.sidePanelEl);

    this.sideHeaderEl = document.createElement('div');
    this.sideHeaderEl.className = 'se-side-header';
    this.sidePanelEl.appendChild(this.sideHeaderEl);

    this.sidePanelBody = document.createElement('div');
    this.sidePanelBody.className = 'se-side-body';
    this.sidePanelEl.appendChild(this.sidePanelBody);

    /* ── Workspace ── */
    const workspace = document.createElement('div');
    workspace.className = 'se-workspace';
    main.appendChild(workspace);

    this.wsToolbarEl = document.createElement('div');
    this.wsToolbarEl.className = 'se-ws-toolbar';
    workspace.appendChild(this.wsToolbarEl);

    this.wsCenterEl = document.createElement('div');
    this.wsCenterEl.className = 'se-ws-center';
    workspace.appendChild(this.wsCenterEl);

    this.wsBottomEl = document.createElement('div');
    this.wsBottomEl.className = 'se-ws-bottom';
    workspace.appendChild(this.wsBottomEl);

    this.gameMountEl = document.createElement('div');
    this.gameMountEl.id = 'se-game-mount';
    this.wsCenterEl.appendChild(this.gameMountEl);

    /* ── Right panel ── */
    this.rightPanelEl = document.createElement('div');
    this.rightPanelEl.className = 'se-right-panel';
    main.appendChild(this.rightPanelEl);

    /* ── Create tabs ── */
    const dummyParent = document.createElement('div');
    dummyParent.style.display = 'none';
    document.body.appendChild(dummyParent);

    const onStateChange = () => this.onStateChange();

    const animTab = new AnimWorkshopTab(dummyParent, onStateChange);
    const uploadTab = new GameUploadTab(dummyParent, onStateChange);
    uploadTab.setAnimWorkshopRef(animTab);

    this.tabs = [
      new CharacterDesignTab(dummyParent, onStateChange),
      new ExplosionTab(dummyParent, onStateChange),
      new AutoBindTab(dummyParent, onStateChange),
      animTab,
      uploadTab,
    ];

    /* ── ResizeObserver ── */
    this.resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    this.resizeObserver.observe(this.wsCenterEl);
  }

  private buildTopBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'se-topbar';

    const title = document.createElement('span');
    title.className = 'se-topbar-title';
    title.textContent = '角色创建工作室';
    bar.appendChild(title);

    const steps = document.createElement('div');
    steps.className = 'se-topbar-steps';

    for (let i = 0; i < TAB_META.length; i++) {
      const meta = TAB_META[i];
      const step = document.createElement('span');
      step.className = 'se-step';
      step.dataset.tabId = meta.id;
      step.innerHTML = `${spineIcon(meta.id, 'se-icon-svg')} ${meta.label}`;
      step.addEventListener('click', () => this.switchTab(meta.id));
      steps.appendChild(step);

      if (i < TAB_META.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'se-step-arrow';
        arrow.textContent = '›';
        steps.appendChild(arrow);
      }
    }

    bar.appendChild(steps);

    const actions = document.createElement('div');
    actions.className = 'se-topbar-actions';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'studio-topbar-btn';
    resetBtn.innerHTML = `${spineIcon('trash', 'se-icon-svg')} 重置`;
    resetBtn.title = '清除所有数据重新开始';
    resetBtn.addEventListener('click', () => {
      if (confirm('确定要清除所有数据并重新开始？')) this.resetAll();
    });
    actions.appendChild(resetBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'studio-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.hide());
    actions.appendChild(closeBtn);

    bar.appendChild(actions);
    return bar;
  }

  private switchTab(id: TabId): void {
    this.state.activeTab = id;
    this.currentTabId = id;

    this.tabs.forEach(t => t.deactivate());

    this.sidePanelBody.innerHTML = '';
    this.wsToolbarEl.innerHTML = '';
    this.wsBottomEl.innerHTML = '';
    this.rightPanelEl.innerHTML = '';
    Array.from(this.wsCenterEl.children).forEach(child => {
      if (child !== this.gameMountEl) child.remove();
    });

    const activeIdx = TAB_META.findIndex(m => m.id === id);

    this.actBtns.forEach((btn, tabId) => {
      const idx = TAB_META.findIndex(m => m.id === tabId);
      btn.classList.toggle('active', tabId === id);
      btn.classList.toggle('completed', idx < activeIdx);
    });

    this.root.querySelectorAll('.se-step').forEach(el => {
      const stepEl = el as HTMLElement;
      const stepId = stepEl.dataset.tabId as TabId;
      const idx = TAB_META.findIndex(m => m.id === stepId);
      stepEl.classList.toggle('active', stepId === id);
      stepEl.classList.toggle('completed', idx < activeIdx);
    });

    this.sidePanelEl.style.display = '';

    const tab = this.tabs.find(t => t.id === id);
    if (tab) {
      tab.activate(this.state);

      this.sideHeaderEl.textContent = TAB_META.find(m => m.id === id)?.label ?? '';
      this.sidePanelBody.appendChild(tab.sidePanel);

      if (tab.centerToolbar) {
        this.wsToolbarEl.appendChild(tab.centerToolbar);
      }

      if (tab.centerView) {
        this.gameMountEl.style.display = 'none';
        this.wsCenterEl.appendChild(tab.centerView);
      } else {
        this.gameMountEl.style.display = '';
      }

      if (tab.bottomPanel) {
        this.wsBottomEl.appendChild(tab.bottomPanel);
      }

      if (tab.rightPanel) {
        this.rightPanelEl.style.display = '';
        this.rightPanelEl.appendChild(tab.rightPanel);
      } else {
        this.rightPanelEl.style.display = 'none';
      }
    }

    window.dispatchEvent(new Event('resize'));
  }

  private onStateChange(): void {
    this.switchTab(this.state.activeTab);
    this.scheduleAutoSave();
  }

  private resetAll(): void {
    localStorage.removeItem('studio-session');
    localStorage.removeItem('se-editor-session');
    studioDelete(EDITOR_STATE_KEY).catch(() => {});
    this.state = createDefaultState();
    this.tabs.forEach(t => t.deactivate());
    this.switchTab('design');
  }

  private scheduleAutoSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.autoSave(), 1500);
  }

  private autoSave(): void {
    const s = this.state;
    const session: any = {
      profession: s.profession,
      characterImage: s.characterImage,
      explosionImage: s.explosionImage,
      activeTab: s.activeTab,
      partRegions: s.partRegions,
      bindingJson: s.bindingJson,
      exportPath: s.exportPath,
      timestamp: Date.now(),
    };
    if (s.attachmentImages.size > 0) {
      session.attachmentImages = Object.fromEntries(s.attachmentImages);
    }
    if (s.animations.size > 0) {
      session.animations = Object.fromEntries(s.animations);
    }
    studioSave(EDITOR_STATE_KEY, session).catch(e => {
      console.warn('Studio auto-save failed:', e);
    });
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.tabs.forEach(t => t.dispose());
    this.root.remove();
  }
}

export function injectCSS(): void {
  const existing = document.getElementById(CSS_ID);
  if (existing) existing.remove();
  const s = document.createElement('style');
  s.id = CSS_ID;
  s.textContent = STUDIO_CSS;
  document.head.appendChild(s);
}

const STUDIO_CSS = `
/* ═══════════════════ Root ═══════════════════ */
.se-root {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  z-index: 300; display: flex; flex-direction: column;
  font-family: 'Rajdhani','Segoe UI',sans-serif; color: var(--color-text-primary);
  background: var(--color-background-canvas);
}

/* ═══════════════════ Top Bar ═══════════════════ */
.se-topbar {
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px; height: 40px;
  background: linear-gradient(180deg, var(--color-background-elevated), var(--color-background-base));
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
}
.se-topbar-title {
  font-family: 'Orbitron',monospace; font-size: 13px; font-weight: 700;
  color: var(--color-brand-primary); letter-spacing: 2px; white-space: nowrap;
}
.se-icon-svg {
  width: 16px; height: 16px;
  display: inline-block; flex: 0 0 auto;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
}
.se-topbar-steps {
  display: flex; align-items: center; gap: 2px; margin: 0 auto;
}
.se-step {
  padding: 3px 10px; font-size: 11px; font-weight: 600;
  color: var(--color-text-tertiary); border-radius: 3px;
  transition: all 0.2s; display: flex; align-items: center; gap: 4px;
  cursor: pointer; user-select: none;
}
.se-step:hover { color: var(--color-text-secondary); }
.se-step.active { color: var(--color-brand-primary); background: var(--color-interaction-selected-brand); }
.se-step.completed { color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-text-tertiary)); }
.se-step-arrow { color: color-mix(in srgb, var(--color-brand-primary) 15%, transparent); font-size: 14px; }
.se-topbar-actions { display: flex; gap: 6px; align-items: center; }

.studio-topbar-btn {
  padding: 4px 12px; font-size: 11px; font-weight: 600;
  background: color-mix(in srgb, var(--color-status-error) 6%, transparent); border: 1px solid color-mix(in srgb, var(--color-status-error) 20%, transparent);
  color: var(--color-status-error); border-radius: 4px; cursor: pointer;
  font-family: inherit; transition: background 0.15s;
  display: inline-flex; align-items: center; gap: 5px;
}
.studio-topbar-btn:hover { background: color-mix(in srgb, var(--color-status-error) 15%, transparent); }
.studio-close-btn {
  cursor: pointer; font-size: 24px; color: var(--color-text-secondary);
  background: none; border: none; transition: color 0.15s;
  line-height: 1;
}
.studio-close-btn:hover { color: var(--color-text-primary); }

/* ═══════════════════ Main area ═══════════════════ */
.se-main {
  flex: 1; display: flex; overflow: hidden;
}

/* ═══════════════════ Activity bar ═══════════════════ */
.se-activity-bar {
  width: 48px; flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--color-background-base);
  border-right: 1px solid var(--color-border-subtle);
  padding: 4px 0; gap: 2px; align-items: center;
}
.se-act-btn {
  width: 40px; height: 40px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px;
  border: none; border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--color-text-tertiary);
  font-size: 16px; transition: all 0.15s; position: relative;
  border-left: 2px solid transparent;
}
.se-act-btn:hover { color: var(--color-brand-primary); background: var(--color-interaction-hover); }
.se-act-btn.active {
  color: var(--color-brand-primary); background: var(--color-interaction-selected-brand);
  border-left-color: var(--color-brand-primary);
}
.se-act-btn.completed { color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-text-tertiary)); }
.se-act-label {
  font-size: 8px; font-weight: 600; letter-spacing: 0.5px;
  line-height: 1; margin-top: 1px;
}
.se-act-btn .se-icon-svg { width: 15px; height: 15px; }
.se-step .se-icon-svg { width: 13px; height: 13px; }

/* ═══════════════════ Side panel ═══════════════════ */
.se-side-panel {
  width: 280px; flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--color-background-base);
  border-right: 1px solid var(--color-border-subtle);
  overflow: hidden;
}
.se-side-header {
  padding: 8px 12px; font-size: 12px; font-weight: 700;
  color: var(--color-brand-primary); letter-spacing: 1px;
  border-bottom: 1px solid var(--color-divider-default);
  flex-shrink: 0;
}
.se-side-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
.se-side-body > * { width: 100%; box-sizing: border-box; }

/* ═══════════════════ Workspace ═══════════════════ */
.se-workspace { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.se-ws-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 10px; background: var(--color-background-elevated);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0; min-height: 32px;
}
.se-ws-toolbar:empty { display: none; }
.se-ws-center {
  flex: 1; position: relative; overflow: hidden;
  display: flex; align-items: stretch;
}
.se-ws-center > * { flex: 1; min-width: 0; min-height: 0; }
.se-ws-bottom {
  flex-shrink: 0; overflow: hidden;
  border-top: 1px solid var(--color-border-subtle);
}
.se-ws-bottom:empty { display: none; }

/* ═══════════════════ Game canvas mount ═══════════════════ */
#se-game-mount {
  width: 100%; height: 100%;
}
#se-game-mount canvas { display: block; width: 100%; height: 100%; }

/* ═══════════════════ Right panel ═══════════════════ */
.se-right-panel {
  width: 280px; flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--color-background-base);
  border-left: 1px solid var(--color-border-subtle);
  overflow-y: auto; overflow-x: hidden;
}
.se-right-panel > * { width: 100%; box-sizing: border-box; }

/* ═══════════════════ Tab 1: Character Design ═══════════════════ */
.sd-section { margin-bottom: 24px; }
.sd-section-title {
  font-size: 14px; font-weight: 700; color: var(--color-brand-primary);
  letter-spacing: 1px; margin-bottom: 12px;
  padding-bottom: 6px; border-bottom: 1px solid var(--color-border-subtle);
}
.sd-prof-grid { display: flex; gap: 12px; }
.sd-prof-card {
  flex: 1; padding: 16px; border-radius: 10px; cursor: pointer;
  background: var(--color-interaction-selected-brand); border: 2px solid color-mix(in srgb, var(--color-brand-primary) 10%, transparent);
  text-align: center; transition: all 0.2s;
}
.sd-prof-card:hover {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
}
.sd-prof-card.active {
  background: var(--color-interaction-selected-brand); border-color: var(--color-brand-primary);
  box-shadow: 0 0 20px color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
}
.sd-prof-icon { font-size: 36px; margin-bottom: 8px; }
.sd-prof-name { font-size: 16px; font-weight: 700; color: var(--color-brand-primary); margin-bottom: 4px; }
.sd-prof-desc { font-size: 12px; color: var(--color-text-secondary); }

.sd-method-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
.sd-method-tab {
  flex: 1; padding: 8px; font-size: 12px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  color: var(--color-text-secondary); border-radius: 6px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.sd-method-tab:hover { background: var(--color-interaction-selected-brand); color: var(--color-text-primary); }
.sd-method-tab.active {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  color: var(--color-brand-primary);
}
.sd-method-panel { padding-top: 8px; }

.sd-prompt {
  width: 100%; min-height: 80px; padding: 10px; font-size: 13px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 6px; font-family: inherit; resize: vertical;
  box-sizing: border-box; margin-bottom: 8px;
}
.sd-prompt::placeholder { color: var(--color-text-tertiary); }
.sd-prompt:focus { border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent); outline: none; }

.sd-gen-btn {
  width: 100%; padding: 10px; font-size: 14px; font-weight: 700;
  background: var(--color-brand-primary);
  border: 1px solid var(--color-brand-primary); color: var(--color-text-on-bright-primary);
  border-radius: 6px; cursor: pointer; font-family: inherit; transition: all 0.15s;
  position: relative; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.sd-btn-icon { width: 15px; height: 15px; flex-shrink: 0; }
.sd-gen-btn:hover:not(:disabled) { background: var(--color-brand-primary-hover); transform: translateY(-1px); }
.sd-gen-btn:active:not(:disabled) { transform: scale(0.97); }
.sd-gen-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sd-gen-btn.btn-loading { pointer-events: none; opacity: 0.7; }
.sd-gen-btn.btn-loading::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-brand-primary) 25%, transparent), transparent);
  animation: btn-shimmer 1.5s infinite;
}
@keyframes btn-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }

.sd-upload-zone {
  padding: 32px; border: 2px dashed color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  border-radius: 10px; text-align: center; cursor: pointer;
  transition: all 0.2s; margin-bottom: 12px;
}
.sd-upload-zone:hover, .sd-upload-zone.dragover {
  border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent); background: var(--color-interaction-selected-brand);
}
.sd-upload-hint { font-size: 14px; color: var(--color-text-secondary); margin-bottom: 4px; }
.sd-upload-sub { font-size: 11px; color: var(--color-text-tertiary); }

.sd-preview-title {
  font-size: 14px; font-weight: 700; color: var(--color-brand-primary); margin-bottom: 8px;
}
.sd-preview {
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: var(--color-background-canvas); border-radius: 10px; border: 1px solid var(--color-border-subtle);
  overflow: hidden;
}
.sd-preview-img {
  max-width: 100%; max-height: 100%; object-fit: contain;
}
.sd-preview-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: var(--color-text-tertiary); font-size: 13px;
}
.sd-preview-empty-icon {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; opacity: 0.35;
}
.sd-preview-empty-icon .spine-icon-svg { width: 40px; height: 40px; }
.sd-preview-tip { font-size: 11px; color: var(--color-text-tertiary); }
.sd-preview-actions { display: flex; gap: 8px; }
.sd-action-btn {
  flex: 1; padding: 10px; font-size: 13px; font-weight: 600;
  background: transparent; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 22%, transparent);
  color: var(--color-text-secondary); border-radius: 6px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.sd-action-btn:hover:not(:disabled) {
  background: var(--color-interaction-hover);
  color: var(--color-brand-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 38%, transparent);
}
.sd-action-btn:active:not(:disabled) { transform: scale(0.97); }
.sd-action-btn:disabled { opacity: 0.38; cursor: not-allowed; }
.sd-btn-ghost {
  width: 100%; flex: unset; padding: 7px 10px; font-size: 12px; font-weight: 500;
  background: transparent; border-color: var(--color-border-subtle); color: var(--color-text-tertiary);
}
.sd-btn-ghost:hover:not(:disabled) {
  background: var(--color-interaction-hover); color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}
.sd-step-btn {
  width: 100%; flex: unset; padding: 8px 10px; font-size: 12px; font-weight: 600;
  background: transparent; color: var(--color-text-secondary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 16%, transparent);
}
.sd-step-btn:not(:disabled):hover {
  background: var(--color-interaction-hover); color: var(--color-brand-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 32%, transparent);
}
.sd-step-btn .sd-btn-icon { opacity: 0.8; }
.sd-action-primary {
  background: color-mix(in srgb, var(--color-status-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-status-success) 40%, transparent); color: var(--color-status-success);
}
.sd-action-primary:hover { background: color-mix(in srgb, var(--color-status-success) 22%, transparent); }

/* Unified bottom-right next-step button */
.studio-next-float {
  position: absolute; bottom: 16px; right: 16px; z-index: 20;
}
.studio-next-btn {
  width: 100%; padding: 10px 16px; font-size: 13px; font-weight: 600;
  letter-spacing: 0.5px; border-radius: 6px; cursor: pointer;
  transition: all 0.2s; font-family: inherit;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 22%, transparent);
  background: transparent; color: var(--color-text-tertiary);
}
.studio-next-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.studio-next-btn:not(:disabled) {
  border-color: var(--color-brand-primary);
  background: var(--color-brand-primary);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 2px 10px rgba(0,0,0,0.22);
}
.studio-next-btn:not(:disabled):hover {
  background: var(--color-brand-primary-hover);
  border-color: var(--color-brand-primary-hover);
  transform: translateY(-1px);
}
.ab-next-float {
  position: static;
  right: auto;
  bottom: auto;
  z-index: auto;
  flex-shrink: 0;
  padding: 10px;
  border-top: 1px solid var(--color-border-subtle);
  background: var(--color-background-base);
}

/* ═══════════════════ Tab 2: Explosion ═══════════════════ */
.expl-sidebar-scroll {
  flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
}
.expl-previews {
  flex: 1; display: flex; align-items: stretch; gap: 0; padding: 16px; min-height: 0;
}
.expl-preview-panel {
  flex: 1; display: flex; flex-direction: column; gap: 8px;
}
.expl-source-box, .expl-result-box {
  flex: 1; display: flex; align-items: center; justify-content: center;
  flex-direction: column;
  background: var(--color-background-canvas); border-radius: 10px; border: 1px solid var(--color-border-subtle);
  overflow: hidden; position: relative; transition: all 0.2s;
}
.expl-source-box.drag-over, .expl-result-box.drag-over {
  background: var(--color-interaction-selected-brand);
  border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--color-brand-primary) 20%, transparent) inset;
}
.expl-preview-img { max-width: 100%; max-height: 100%; object-fit: contain; }
.expl-generated-preview {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  box-sizing: border-box;
}
.expl-generated-main-img {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  object-fit: contain;
  border-radius: 8px;
  background: repeating-conic-gradient(#555 0% 25%, #111 0% 50%) 0 0 / 14px 14px;
}
.expl-candidate-strip {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
.expl-candidate-thumb {
  height: 58px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 18%, transparent);
  border-radius: 7px;
  overflow: hidden;
  cursor: pointer;
  background: repeating-conic-gradient(#2a2a2e 0% 25%, #11131a 0% 50%) 0 0 / 10px 10px;
}
.expl-candidate-thumb.active {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
}
.expl-candidate-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.expl-candidate-grid {
  width: 100%;
  height: 100%;
  flex: 1 1 auto;
  min-height: 280px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: stretch;
  gap: 10px;
  padding: 10px;
  box-sizing: border-box;
  overflow: auto;
}
.expl-candidate-card {
  position: relative;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 18%, transparent);
  border-radius: 10px;
  overflow: hidden;
  background: repeating-conic-gradient(#2a2a2e 0% 25%, #11131a 0% 50%) 0 0 / 12px 12px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
}
.expl-candidate-card:hover {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 20%, transparent), 0 0 18px color-mix(in srgb, var(--color-brand-primary) 16%, transparent);
  transform: translateY(-1px);
}
.expl-candidate-img {
  width: 100%;
  height: 100%;
  min-height: 180px;
  object-fit: contain;
  display: block;
}
.expl-candidate-card-error::after {
  content: '候选图加载失败';
  color: var(--color-status-danger);
  font-size: 12px;
  font-weight: 600;
}
.expl-candidate-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: var(--color-brand-primary);
  font-size: 11px;
  font-weight: 700;
}
.expl-candidate-hint {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.66);
  color: var(--color-text-secondary);
  font-size: 10px;
}
.expl-arrow-col {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 60px; flex-shrink: 0;
}
.expl-arrow { font-size: 32px; color: color-mix(in srgb, var(--color-brand-primary) 30%, transparent); }
.expl-arrow-label { font-size: 10px; color: var(--color-text-tertiary); white-space: nowrap; }
.expl-upload-row { display: flex; gap: 8px; }
.expl-info-col {
  display: none;
}
.expl-tmpl-block {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.expl-tmpl-preview {
  flex-shrink: 0;
  background: var(--color-background-canvas);
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  overflow: auto;
  max-height: min(520px, 52vh);
}
.expl-tmpl-img {
  display: block;
  width: 100%;
  height: auto;
  object-fit: contain;
  image-rendering: pixelated;
}
.expl-tmpl-info { font-size: 10px; color: var(--color-text-tertiary); text-align: center; }
.expl-tmpl-info code { color: var(--color-brand-primary); }
.expl-tmpl-warn { color: var(--color-status-warning); font-weight: 600; }
.expl-parts-list { display: flex; flex-direction: column; gap: 2px; max-height: 200px; overflow-y: auto; }
.expl-part-item {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 6px; font-size: 11px; border-radius: 3px;
  background: var(--color-divider-subtle);
}
.expl-part-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: color-mix(in srgb, var(--color-brand-primary) 30%, transparent); flex-shrink: 0;
}
.expl-part-name { flex: 1; color: var(--color-text-secondary); }
.expl-part-size { font-size: 9px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; }
.expl-divider { height: 1px; background: var(--color-divider-default); margin: 4px 0; }
.expl-steps-info { display: flex; flex-direction: column; gap: 4px; }
.expl-step-item {
  display: flex; align-items: center; gap: 8px; font-size: 11px;
  color: var(--color-text-secondary); padding: 3px 0;
}
.expl-step-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%; font-size: 10px; font-weight: 700;
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); flex-shrink: 0;
}
.expl-btn-step {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%; font-size: 9px; font-weight: 700;
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); margin-right: 4px;
}
.expl-actions { display: flex; flex-direction: column; gap: 10px; }
.expl-actions-primary { display: flex; flex-direction: column; gap: 6px; }
.expl-actions-primary .cd-progress {
  margin-top: 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 24%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-brand-primary) 7%, var(--color-background-canvas));
}
.expl-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.expl-progress-step {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-brand-primary);
  letter-spacing: 0.2px;
}
.expl-progress-percent {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-secondary);
  font-family: 'Orbitron', monospace;
}
.expl-actions-primary .cd-progress-bar {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-brand-primary) 14%, var(--color-background-elevated));
  overflow: hidden;
}
.expl-actions-primary .cd-progress-fill {
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--color-brand-primary), color-mix(in srgb, var(--color-brand-primary) 72%, white));
  box-shadow: 0 0 10px color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  transition: width 0.28s ease;
}
.expl-actions-primary .cd-progress-text {
  margin-top: 7px;
  font-size: 11px;
  line-height: 1.35;
  color: var(--color-text-secondary);
  text-align: left;
}
.expl-actions-steps {
  display: flex; flex-direction: column; gap: 5px;
  padding: 8px; border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-background-canvas);
}
.expl-actions-steps-label {
  font-size: 10px; font-weight: 600; color: var(--color-text-tertiary);
  letter-spacing: 0.4px; margin-bottom: 2px;
}
.expl-annotate-btn {
  min-height: 40px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.3px;
  border-color: color-mix(in srgb, var(--color-brand-primary) 42%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--color-brand-primary) 18%, var(--color-background-elevated)), var(--color-background-canvas));
  color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 10%, transparent), 0 0 14px color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
}
.expl-annotate-btn:not(:disabled):hover {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 24%, transparent), 0 0 18px color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  transform: translateY(-1px);
}
.expl-annotate-btn:disabled {
  opacity: 0.46;
  cursor: not-allowed;
  box-shadow: none;
}
.expl-annotate-hint {
  padding: 5px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-status-warning) 8%, transparent);
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.35;
}
.expl-annotate-hint.ready {
  background: color-mix(in srgb, var(--color-brand-primary) 8%, transparent);
  color: var(--color-text-secondary);
}
.expl-section-row { display: flex; align-items: center; gap: 6px; }
.expl-section-row .sd-section-icon { width: 14px; height: 14px; flex-shrink: 0; }
.expl-gender-toggle { margin-left: auto; display: flex; gap: 2px; }
.expl-gender-btn {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-family: inherit;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
  background: transparent; color: var(--color-text-tertiary); transition: all 0.15s;
}
.expl-gender-btn.expl-gender-active {
  border-color: color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary);
}
.expl-gender-icon { width: 11px; height: 11px; }
.expl-refresh-btn { font-size: 10px; padding: 2px 8px; margin-left: auto; flex: 0 0 auto; }
.expl-arrow-icon { width: 28px; height: 28px; opacity: 0.35; }
.expl-scale-info {
  font-size: 10px; color: var(--color-text-tertiary); padding: 0 4px;
  font-family: 'Orbitron',monospace; min-height: 14px;
}
.expl-rmbg-options {
  display: flex; flex-direction: column; gap: 6px; padding: 8px;
  background: var(--color-background-canvas); border-radius: 6px; margin-top: 4px;
  border: 1px solid var(--color-border-subtle);
}
.expl-rmbg-title { font-size: 11px; color: var(--color-text-secondary); font-weight: 600; }
.expl-rmbg-hint { font-size: 10px; color: var(--color-text-tertiary); line-height: 1.4; }
/* ── Annotate layout ── */
.expl-annotate-layout {
  display: flex; width: 100%; height: 100%;
}
.expl-annotate-sidebar {
  width: 240px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px;
  padding: 8px; overflow-y: auto;
  border-right: 1px solid var(--color-border-subtle); background: var(--color-background-base);
}
.expl-mode-row { display: flex; gap: 4px; margin-bottom: 4px; }
.expl-mode-btn {
  flex: 1; padding: 5px 0; font-size: 11px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  color: var(--color-text-secondary); border-radius: 4px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.expl-mode-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.expl-mode-btn.active {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
  color: var(--color-brand-primary);
}
.expl-annotate-list {
  display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto;
}
.expl-annot-item {
  display: flex; align-items: center; gap: 5px; padding: 4px 6px;
  border-radius: 4px; cursor: pointer; transition: all 0.12s;
  border: 1px solid transparent;
}
.expl-annot-item:hover { background: var(--color-interaction-selected-brand); }
.expl-annot-item.annot-active {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}
.expl-annot-item.annot-swap {
  background: var(--color-interaction-selected-brand); border-color: var(--color-brand-primary-light);
}
.expl-annot-item.annot-empty { opacity: 0.45; }
.expl-annot-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.expl-annot-name { flex: 1; font-size: 11px; color: var(--color-text-primary); font-weight: 600; }
.expl-annot-size { font-size: 9px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; }
.expl-annot-btn {
  min-width: 24px; height: 24px; padding: 2px 6px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
  color: var(--color-text-secondary); cursor: pointer; font-family: inherit;
  transition: all 0.12s ease;
}
.expl-annot-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.expl-annot-btn.swap-target {
  background: var(--color-interaction-selected-brand); border-color: var(--color-brand-primary-light); color: var(--color-brand-primary-light);
}
.expl-annot-delete {
  color: var(--color-status-warning);
  border-color: color-mix(in srgb, var(--color-status-warning) 52%, transparent);
  background: color-mix(in srgb, var(--color-status-warning) 14%, var(--color-background-elevated));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-status-warning) 10%, transparent);
}
.expl-annot-delete:hover {
  color: var(--color-status-warning);
  border-color: color-mix(in srgb, var(--color-status-warning) 85%, transparent);
  background: color-mix(in srgb, var(--color-status-warning) 22%, var(--color-background-elevated));
  transform: translateY(-1px);
  box-shadow: 0 0 10px color-mix(in srgb, var(--color-status-warning) 22%, transparent);
}
.expl-retry-icon { width: 14px; height: 14px; stroke-width: 2.3; }
.expl-annot-cancel { text-align: center; padding: 4px 0; }
.expl-annotate-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--color-divider-default);
}
.expl-reannotate-btn {
  border-color: color-mix(in srgb, var(--color-status-warning) 48%, transparent);
  background: linear-gradient(180deg, color-mix(in srgb, var(--color-status-warning) 16%, var(--color-background-elevated)), var(--color-background-canvas));
  color: var(--color-status-warning);
  font-weight: 800;
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-status-warning) 12%, transparent);
}
.expl-reannotate-btn:hover {
  border-color: color-mix(in srgb, var(--color-status-warning) 82%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--color-status-warning) 20%, transparent);
}
.expl-annotate-canvas-wrap {
  flex: 1; position: relative; overflow: hidden; background: var(--color-background-base);
}
.expl-annotate-canvas {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
}

/* ── Final crop grid ── */
.expl-crop-grid {
  display: flex; flex-wrap: wrap; gap: 8px; padding: 10px;
  justify-content: center; align-content: flex-start;
  overflow-y: auto; max-height: 100%;
}
.expl-crop-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px; background: var(--color-background-canvas); border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  min-width: 60px;
}
.expl-crop-thumb { max-width: 60px; max-height: 60px; object-fit: contain; image-rendering: pixelated; }
.expl-crop-label { font-size: 10px; font-weight: 600; }
.expl-crop-btn {
  font-size: 10px; padding: 3px 8px; border-radius: 3px;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
  color: var(--color-text-secondary); cursor: pointer; font-family: inherit;
  transition: all 0.15s;
}
.expl-crop-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }

/* Toast */
.sd-toast {
  position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(80px);
  background: var(--color-background-canvas); color: var(--color-brand-primary); padding: 14px 32px; border-radius: 10px;
  font-size: 15px; font-weight: 600; pointer-events: none; opacity: 0; transition: all 0.35s;
  z-index: 10000; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  box-shadow: 0 8px 32px rgba(0,0,0,0.6), 0 0 20px color-mix(in srgb, var(--color-brand-primary) 10%, transparent);
  letter-spacing: 0.5px; max-width: 500px; text-align: center;
}
.sd-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.sd-preview-tip { font-size: 11px; color: var(--color-text-tertiary); margin-top: 4px; }
.sd-gen-row { display: flex; gap: 8px; }
.sd-gen-hint { font-size: 10px; color: var(--color-text-tertiary); margin-top: 4px; line-height: 1.4; }
.sd-state-bar {
  display: flex; gap: 16px; padding: 8px 0;
  font-size: 12px; color: var(--color-text-secondary);
}
.sd-state-bar b { color: var(--color-brand-primary); }

/* ═══════════════════ Tab 3: AutoBind (Rigging Editor) ═══════════════════ */
.ab-auto-sidebar {
  flex: 1; display: flex; flex-direction: column; overflow-y: auto;
}
.ab-mode-bar {
  display: flex; gap: 4px;
  padding: 8px 10px; background: var(--color-background-elevated);
  border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
}
.ab-mode-btn {
  flex: 1; padding: 5px 10px; font-size: 11px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
  color: var(--color-text-secondary); border-radius: 4px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.ab-mode-btn.active {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
  color: var(--color-brand-primary);
}

.ab-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; background: var(--color-background-elevated);
  border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
}
.ab-toolbar-sep { width: 1px; height: 16px; background: var(--color-divider-default); }
.ab-toolbar-hint { font-size: 10px; color: var(--color-text-tertiary); }
.ab-status { font-size: 11px; color: var(--color-text-secondary); font-family: 'Orbitron',monospace; }

.ab-preview-wrap {
  flex: 1; position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.ab-preview-canvas { display: block; width: 100%; height: 100%; }
.ab-edit-mode-bar {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 2px; z-index: 10;
  background: var(--color-background-floating); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 25%, transparent);
  border-radius: 6px; padding: 3px; backdrop-filter: blur(6px);
}
.ab-edit-mode-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 5px 14px; font-size: 12px; font-weight: 600;
  border: none; border-radius: 4px; cursor: pointer;
  background: transparent; color: var(--color-text-secondary);
  transition: all 0.15s; white-space: nowrap;
}
.ab-edit-mode-btn:hover { color: var(--color-brand-primary); background: var(--color-interaction-hover); }
.ab-edit-mode-btn.active {
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary);
  box-shadow: 0 0 8px color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
}
.ab-preview-empty {
  position: absolute; display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: var(--color-text-tertiary); font-size: 13px; pointer-events: none;
}
.ab-preview-empty-icon {
  display: flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; opacity: 0.35;
}
.ab-preview-empty-icon .spine-icon-svg { width: 40px; height: 40px; }
.ab-preview-empty-sub { font-size: 11px; color: var(--color-text-disabled); }

.ab-sidebar-section {
  padding: 10px; border-bottom: 1px solid var(--color-border-subtle);
}
.ab-sidebar-title {
  font-size: 11px; font-weight: 700; color: var(--color-brand-primary);
  letter-spacing: 1px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
}
.ab-part-count { font-size: 10px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; }
.ab-sidebar-actions { display: flex; flex-direction: column; gap: 6px; }
.ab-manual-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.ab-manual-help {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-secondary);
}
.ab-manual-help.muted {
  color: var(--color-text-tertiary);
}
.ab-sidebar-btn {
  width: 100%; padding: 7px 10px; font-size: 12px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 25%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.ab-sidebar-btn:hover:not(:disabled) { background: var(--color-interaction-selected-brand); }
.ab-sidebar-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.ab-btn-primary {
  background: var(--color-brand-primary);
  border-color: var(--color-brand-primary); color: var(--color-text-on-bright-primary);
}
.ab-btn-primary:hover:not(:disabled) { background: var(--color-brand-primary-hover); }
.ab-btn-success {
  background: color-mix(in srgb, var(--color-status-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-status-success) 40%, transparent); color: var(--color-status-success);
}
.ab-btn-success:hover:not(:disabled) { background: color-mix(in srgb, var(--color-status-success) 22%, transparent); }
.ab-btn-sm { padding: 4px 8px; font-size: 10px; flex: 1; }
.ab-bottom-actions { margin-top: auto; border-top: 1px solid var(--color-divider-default); border-bottom: none; }
.ab-auto-status {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-brand-primary) 6%, transparent);
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.35;
}

.ab-parts-list { display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto; }
.ab-part-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 4px; cursor: pointer;
  border: 1px solid transparent; transition: all 0.12s;
}
.ab-part-row:hover { background: var(--color-interaction-selected-brand); }
.ab-part-row.selected {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
}
.ab-part-row.swap-source {
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent); border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}
.ab-part-row.empty { opacity: 0.35; }
.ab-part-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.ab-part-label { font-size: 11px; color: var(--color-text-primary); flex: 1; }
.ab-part-adj-info {
  font-size: 9px; color: var(--color-text-tertiary);
  font-family: 'Orbitron',monospace; flex-shrink: 0;
}
.ab-part-btns { display: flex; gap: 3px; flex-shrink: 0; }
.ab-part-action {
  padding: 2px 6px; font-size: 10px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--color-border-default); background: var(--color-interaction-hover);
  color: var(--color-text-tertiary); font-family: inherit; transition: all 0.12s;
}
.ab-part-action:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ab-part-action.swap-target {
  border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent); color: var(--color-brand-primary-light);
  background: color-mix(in srgb, var(--color-brand-primary) 10%, transparent); animation: ab-swap-pulse 0.8s infinite alternate;
}
@keyframes ab-swap-pulse {
  from { box-shadow: 0 0 0 color-mix(in srgb, var(--color-brand-primary) 0%, transparent); }
  to { box-shadow: 0 0 6px color-mix(in srgb, var(--color-brand-primary) 30%, transparent); }
}

.ab-advanced-section { border-bottom: none; }
.ab-advanced-toggle {
  font-size: 11px; font-weight: 600; color: var(--color-text-secondary);
  cursor: pointer; display: flex; align-items: center; gap: 6px;
  padding: 4px 0; transition: color 0.15s;
}
.ab-advanced-toggle:hover { color: var(--color-brand-primary); }
.ab-advanced-arrow { font-size: 8px; transition: transform 0.2s; }
.ab-advanced-panel {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 0 0; margin-top: 6px;
}
.ab-adv-row {
  display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--color-text-secondary);
}
.ab-adv-row label { width: 50px; flex-shrink: 0; }
.ab-adv-input {
  flex: 1; padding: 3px 6px; font-size: 11px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: 'Orbitron',monospace;
  box-sizing: border-box;
}
.ab-adv-input:focus { border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent); outline: none; }
.ab-adv-actions { display: flex; gap: 6px; margin-top: 4px; }

.ab-layer-hint {
  font-size: 10px; font-weight: 400; color: var(--color-text-tertiary); margin-left: 4px;
}
.ab-layer-list {
  display: flex; flex-direction: column; gap: 1px;
  max-height: 220px; overflow-y: auto;
  padding-bottom: 4px;
}
.ab-layer-row {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 8px; border-radius: 4px; cursor: grab;
  border: 1px solid transparent;
  background: var(--color-background-elevated); transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  font-size: 11px; color: var(--color-text-secondary);
}
.ab-layer-row:hover { background: var(--color-background-floating); }
.ab-layer-row.selected { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.ab-layer-row.dragging {
  opacity: 0.45;
  cursor: grabbing;
}
.ab-layer-row.drop-target {
  border-color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent);
}
.ab-layer-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
}
.ab-layer-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ab-layer-idx {
  font-size: 9px; font-family: 'Orbitron',monospace;
  color: var(--color-text-tertiary); min-width: 16px; text-align: right;
}
.ab-layer-grip {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  color: var(--color-text-tertiary);
  letter-spacing: -2px;
  cursor: grab;
  opacity: 0.75;
}
.ab-layer-row:hover .ab-layer-grip {
  color: var(--color-brand-primary);
  opacity: 1;
}
.ab-layer-btns { display: flex; gap: 2px; flex-shrink: 0; }
.ab-layer-btn {
  width: 20px; height: 18px; border: none; border-radius: 2px;
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary);
  font-size: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; padding: 0;
}
.ab-layer-btn:hover:not(:disabled) { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.ab-layer-btn:disabled { opacity: 0.25; cursor: default; }

.ab-manual-panel { flex: 1; position: relative; overflow: hidden; }

/* ═══════════════════ Tab 4: AnimWorkshop ═══════════════════ */
.aw-side { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.aw-side-right { display: flex; height: 100%; overflow: hidden; padding: 0; }
.aw-right-collapse-rail {
  width: 18px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 8px 2px;
  border-right: 1px solid var(--color-border-subtle);
  background: color-mix(in srgb, var(--color-background-elevated) 56%, transparent);
  box-sizing: border-box;
}
.aw-right-collapse-btn {
  width: 14px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-brand-primary) 10%, transparent);
  color: var(--color-brand-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0.75;
  transition: opacity 0.15s, background 0.15s;
}
.aw-right-collapse-btn:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-brand-primary) 18%, transparent);
}
.aw-collapse-svg {
  width: 11px;
  height: 11px;
  transition: transform 0.15s;
}
.aw-right-collapse-btn.collapsed .aw-collapse-svg {
  transform: rotate(180deg);
}
.aw-right-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.aw-side-right.collapsed .aw-right-content {
  display: none;
}
.aw-side-right.collapsed .aw-right-collapse-rail {
  width: 20px;
  border-right: none;
}
.aw-right-section {
  border-bottom: 1px solid var(--color-border-subtle);
  background: color-mix(in srgb, var(--color-background-base) 96%, transparent);
}
.aw-toolbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 6px 12px; background: var(--color-background-elevated);
  border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
}
.aw-info {
  margin-left: auto; font-size: 11px;
  color: var(--color-text-secondary); font-family: 'Orbitron',monospace;
}
.aw-canvas { flex: 1; cursor: crosshair; display: block; min-height: 0; }
.aw-tl-resize-handle {
  height: 4px; cursor: ns-resize; flex-shrink: 0;
  background: var(--color-divider-default);
  border-top: 1px solid var(--color-border-subtle);
  transition: background 0.15s;
}
.aw-tl-resize-handle:hover, .aw-tl-resize-handle.dragging { background: color-mix(in srgb, var(--color-brand-primary) 25%, transparent); }
.aw-timeline-area { flex: 1; min-height: 0; background: var(--color-background-base); overflow: hidden; }

/* Anim source bar in left sidebar */
.aw-anim-source-bar {
  padding: 10px 12px; border-bottom: 1px solid var(--color-divider-default);
}
.aw-source-title {
  font-size: 11px; color: var(--color-text-secondary); text-transform: uppercase;
  letter-spacing: 1px; margin-bottom: 8px;
}
.aw-source-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.aw-source-btn {
  flex: 1 1 110px; padding: 6px 4px; font-size: 11px; font-weight: 500;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 15%, transparent);
  color: var(--color-text-secondary); border-radius: 4px; cursor: pointer;
  transition: all 0.15s; font-family: inherit; text-align: center;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.aw-footer-next {
  padding: 8px 12px; margin-top: auto; flex-shrink: 0;
  border-top: 1px solid var(--color-border-subtle);
}
.aw-source-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.aw-source-ai { border-color: color-mix(in srgb, var(--color-brand-primary) 25%, transparent); color: var(--color-brand-primary); }
.aw-source-ai:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary-light); }
.aw-source-active { background: var(--color-interaction-selected-brand) !important; border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent) !important; color: var(--color-brand-primary) !important; }

/* Anim list */
.aw-anims-wrap {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.aw-anim-list-area { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; }
.aw-anim-empty {
  padding: 24px 16px; text-align: center;
  font-size: 12px; color: var(--color-text-tertiary);
}
.aw-anim-item {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; cursor: pointer;
  border-left: 3px solid transparent;
  transition: all 0.12s;
}
.aw-anim-item:hover { background: var(--color-interaction-selected-brand); }
.aw-anim-item.active {
  background: var(--color-interaction-selected-brand); border-left-color: var(--color-brand-primary);
}
.aw-anim-item-info { flex: 1; min-width: 0; }
.aw-anim-item-name {
  font-size: 12px; color: var(--color-text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
}
.aw-anim-item-dur { font-size: 10px; color: var(--color-text-tertiary); }
.aw-anim-item-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
.aw-anim-item:hover .aw-anim-item-actions { opacity: 1; }
.aw-anim-act-btn {
  width: 22px; height: 22px; border: none; border-radius: 3px;
  background: var(--color-interaction-selected-brand); color: var(--color-text-secondary);
  font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.aw-anim-act-svg { width: 13px; height: 13px; }
.aw-anim-act-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.aw-anim-act-del:hover { background: color-mix(in srgb, var(--color-status-error) 20%, transparent); color: var(--color-status-error); }

/* Import dialog overlay */
.aw-import-overlay {
  position: absolute; inset: 0; z-index: 100;
  background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
}
.aw-import-dialog {
  background: var(--color-background-elevated); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  border-radius: 10px; padding: 20px; width: 380px; max-height: 500px;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
}
.aw-import-title { font-size: 16px; font-weight: 600; color: var(--color-brand-primary); }
.aw-import-hint { font-size: 12px; color: var(--color-text-secondary); }
.aw-import-list {
  max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
}
.aw-import-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-radius: 4px; cursor: pointer;
  font-size: 13px; color: var(--color-text-primary);
  background: var(--color-interaction-selected-brand);
}
.aw-import-item:hover { background: var(--color-interaction-selected-brand); }
.aw-import-item input[type="checkbox"] { accent-color: var(--color-brand-primary); }
.aw-import-actions { display: flex; gap: 8px; align-items: center; }
.aw-import-btn {
  padding: 6px 14px; font-size: 12px; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  background: var(--color-interaction-selected-brand); color: var(--color-text-secondary);
  border-radius: 4px; cursor: pointer; font-family: inherit;
}
.aw-import-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.aw-import-confirm {
  background: color-mix(in srgb, var(--color-status-success) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-status-success) 30%, transparent); color: var(--color-status-success);
}
.aw-import-confirm:hover { background: color-mix(in srgb, var(--color-status-success) 22%, transparent); }
.aw-import-cancel { border-color: color-mix(in srgb, var(--color-status-error) 20%, transparent); color: var(--color-status-error); }
.aw-import-cancel:hover { background: color-mix(in srgb, var(--color-status-error) 12%, transparent); }

/* ═══════════════════ Tab 5: Upload ═══════════════════ */
.gu-header { text-align: center; }
.gu-title {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  font-size: 18px; font-weight: 700; color: var(--color-brand-primary); margin-bottom: 4px;
}
.gu-title-icon { width: 20px; height: 20px; }
.gu-check-svg { width: 14px; height: 14px; flex-shrink: 0; }
.gu-check-svg.done { stroke: var(--color-status-success); }
.gu-play-btn {
  background: color-mix(in srgb, var(--color-status-success) 18%, transparent) !important;
  border-color: color-mix(in srgb, var(--color-status-success) 40%, transparent) !important;
  color: var(--color-status-success) !important;
}
.gu-subtitle { font-size: 13px; color: var(--color-text-secondary); }
.gu-checklist { display: flex; flex-direction: column; gap: 8px; }
.gu-check-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 8px;
  background: var(--color-interaction-selected-brand); border: 1px solid var(--color-border-subtle);
  font-size: 13px;
}
.gu-check-item.done { border-color: color-mix(in srgb, var(--color-status-success) 20%, transparent); }
.gu-check-icon { font-size: 16px; }
.gu-check-text { flex: 1; color: var(--color-text-secondary); }
.gu-check-status { font-size: 11px; color: var(--color-text-tertiary); }
.gu-check-item.done .gu-check-status { color: var(--color-status-success); }
.gu-export-section { margin-top: 8px; }
.gu-config { display: flex; flex-direction: column; gap: 8px; }
.gu-config-row {
  display: flex; align-items: center; gap: 12px; font-size: 13px;
  color: var(--color-text-secondary);
}
.gu-config-row span { width: 80px; flex-shrink: 0; }
.gu-input {
  flex: 1; padding: 6px 10px; font-size: 12px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 4px; font-family: inherit; box-sizing: border-box;
}
.gu-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.gu-actions .sd-gen-btn, .gu-actions .sd-action-btn { flex: 1; min-width: 150px; }
.gu-check-detail {
  font-size: 11px; color: var(--color-text-secondary); margin-left: auto;
  font-family: 'Orbitron',monospace;
}
.gu-log {
  max-height: 120px; overflow-y: auto; padding: 8px;
  background: var(--color-background-canvas); border-radius: 6px;
  font-family: monospace; font-size: 11px; color: var(--color-text-secondary);
}
.gu-log-line { padding: 2px 0; }

/* ═══════════════════ Shared component styles (from old editor) ═══════════════════ */

/* Toolbar buttons */
.se-tb-btn {
  padding: 4px 14px; font-size: 12px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer;
  font-family: inherit; transition: background 0.15s;
  min-height: 28px;
  line-height: 1;
}
.se-tb-btn:hover { background: var(--color-interaction-selected-brand); }
.se-tb-ai-btn { color: var(--color-status-success); border-color: color-mix(in srgb, var(--color-status-success) 35%, transparent); background: color-mix(in srgb, var(--color-status-success) 8%, transparent); }
.se-tb-ai-btn:hover { background: color-mix(in srgb, var(--color-status-success) 20%, transparent); }
.se-tb-sep { color: var(--color-text-tertiary); }
.se-tb-check { font-size: 12px; color: var(--color-text-secondary); cursor: pointer; display: flex; align-items: center; gap: 3px; }
.se-tb-check input { accent-color: var(--color-brand-primary); }
.se-tb-undo, .se-tb-redo { font-size: 16px; padding: 2px 8px; min-width: 28px; }
.se-tb-zoom-btn { font-size: 16px; padding: 2px 8px; min-width: 28px; }
.se-tb-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.se-tb-svg,
.tl-icon-svg,
.se-ai-anim-svg {
  width: 14px;
  height: 14px;
  stroke-width: 2;
}
.se-ai-btn-row .sd-btn-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.se-ai-gen-btn,
.se-ai-import-btn {
  line-height: 1.2;
}
.se-tb-zoom-label {
  font-family: 'Orbitron', monospace; font-size: 11px; color: var(--color-brand-primary);
  min-width: 48px; text-align: center; display: inline-block;
}
.se-tb-save-btn {
  color: var(--color-status-warning);
  border-color: color-mix(in srgb, var(--color-status-warning) 35%, transparent);
  background: color-mix(in srgb, var(--color-status-warning) 8%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  vertical-align: middle;
}
.se-tb-save-btn .sd-btn-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: block;
}
.se-tb-save-btn span {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.se-tb-save-btn:hover { background: color-mix(in srgb, var(--color-status-warning) 20%, transparent); }

/* Left panel structure */
.se-left-tabs {
  display: flex; flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-background-elevated);
}
.se-left-tab {
  flex: 1; padding: 8px 4px; font-size: 12px; font-weight: 700;
  background: none; border: none; border-bottom: 2px solid transparent;
  color: var(--color-text-secondary); cursor: pointer; font-family: inherit;
  transition: all 0.15s; white-space: nowrap;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
}
.se-left-tab:hover { color: var(--color-brand-primary); background: var(--color-interaction-hover); }
.se-left-tab.active { color: var(--color-brand-primary); border-bottom-color: var(--color-brand-primary); background: var(--color-interaction-selected-brand); }
.se-left-tab-content { flex: 1; overflow-y: auto; }

/* Right panel */

/* Canvas */
.se-canvas { width: 100%; height: 100%; cursor: crosshair; display: block; }

/* Panel headers */
.se-panel-header {
  font-family: 'Orbitron',monospace; font-size: 11px; font-weight: 700;
  color: var(--color-brand-primary); letter-spacing: 2px; padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-subtle); text-transform: uppercase;
}

/* Bone Tree */
.se-bone-tree { display: flex; flex-direction: column; height: 100%; }
.se-search {
  margin: 6px 8px; padding: 5px 8px; font-size: 12px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: inherit;
}
.se-search::placeholder { color: var(--color-text-tertiary); }
.se-tree-body { flex: 1; overflow-y: auto; padding: 4px 0; }
.se-tree-row {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; cursor: pointer; font-size: 12px; transition: background 0.1s;
}
.se-tree-row:hover { background: var(--color-interaction-selected-brand); }
.se-tree-row.selected { background: var(--color-interaction-selected-brand); }
.se-tree-toggle { width: 14px; font-size: 9px; color: var(--color-text-secondary); text-align: center; flex-shrink: 0; }
.se-tree-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.se-tree-label { color: var(--color-text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.se-tree-role { font-size: 9px; color: var(--color-text-tertiary); flex-shrink: 0; }

/* Property Panel */
.se-prop-panel { padding: 0; }
.se-prop-body { padding: 8px 12px; font-size: 12px; }
.se-prop-empty { color: var(--color-text-tertiary); text-align: center; padding: 24px 0; }
.se-prop-section { margin-bottom: 12px; }
.se-prop-title { font-size: 15px; font-weight: 700; color: var(--color-brand-primary); margin-bottom: 2px; }
.se-prop-role { font-size: 11px; font-weight: 600; margin-bottom: 8px; }
.se-prop-subtitle { font-size: 10px; font-weight: 700; color: var(--color-brand-primary); letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; padding-bottom: 3px; border-bottom: 1px solid var(--color-divider-default); }
.se-prop-row { display: flex; justify-content: space-between; padding: 2px 0; }
.se-prop-label { color: var(--color-text-secondary); }
.se-prop-value { color: var(--color-text-primary); font-family: 'Orbitron',monospace; font-size: 11px; }
.se-prop-ik { padding: 4px 0; border-left: 2px solid #a855f7; padding-left: 8px; margin: 4px 0; }

/* Timeline */
.se-timeline { display: flex; flex-direction: column; height: 100%; }
.tl-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 8px; background: var(--color-background-elevated);
  border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
}
.tl-toolbar-left, .tl-toolbar-right { display: flex; align-items: center; gap: 3px; }
.tl-btn {
  width: 26px; height: 24px; font-size: 12px;
  border: none; border-radius: 3px; cursor: pointer;
  background: var(--color-interaction-selected-brand); color: var(--color-text-secondary);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.12s; padding: 0;
}
.tl-btn:hover { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.tl-btn.active { background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); }
.tl-sep { width: 1px; height: 16px; background: var(--color-divider-default); margin: 0 4px; }
.tl-select {
  padding: 2px 6px; font-size: 11px; max-width: 140px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px;
}
.tl-time {
  font-family: 'Orbitron',monospace; font-size: 10px; color: var(--color-brand-primary);
  min-width: 120px; text-align: center; margin: 0 4px;
}
.tl-canvas-wrap {
  flex: 1; display: flex; min-height: 0; overflow: hidden;
}
.tl-label-area {
  width: 120px; flex-shrink: 0; overflow: hidden;
}
.tl-label-canvas { display: block; }
.tl-track-area { flex: 1; overflow: hidden; }
.tl-track-area {
  position: relative;
  padding-right: 10px;
}
.tl-track-canvas { display: block; cursor: default; }
.tl-v-scroll {
  position: absolute;
  top: 28px;
  right: 4px;
  bottom: 6px;
  width: 6px;
  height: calc(100% - 34px);
  margin: 0;
  padding: 0;
  border-radius: 999px;
  background: rgba(212, 255, 72, 0.06);
  opacity: 0.55;
  transition: opacity 0.15s, background 0.15s;
  cursor: pointer;
}
.tl-v-scroll:hover {
  opacity: 0.9;
  background: rgba(212, 255, 72, 0.1);
}
.tl-v-scroll-thumb {
  position: absolute;
  left: 1px;
  top: 0;
  width: 4px;
  min-height: 18px;
  border-radius: 999px;
  background: rgba(212, 255, 72, 0.22);
  transition: background 0.15s;
}
.tl-v-scroll:hover .tl-v-scroll-thumb,
.tl-v-scroll-thumb:hover {
  background: rgba(212, 255, 72, 0.38);
}

/* Timeline legacy compat */
.se-tl-btn {
  width: 28px; height: 28px; font-size: 14px;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 25%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.se-tl-btn:hover { background: var(--color-interaction-selected-brand); }
.se-tl-select {
  padding: 3px 8px; font-size: 12px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: inherit; max-width: 180px;
}
.se-tl-time { font-family: 'Orbitron',monospace; font-size: 11px; color: var(--color-brand-primary); min-width: 110px; }
.se-tl-scrubber { flex: 1; accent-color: var(--color-brand-primary); }
.se-tl-tracks { max-height: 140px; overflow-y: auto; padding: 4px 12px; }
.se-tl-empty { color: var(--color-text-tertiary); text-align: center; padding: 12px; font-size: 12px; }
.se-tl-track { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.se-tl-track-label { width: 100px; font-size: 10px; color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
.se-tl-track-bar { flex: 1; height: 16px; background: var(--color-background-canvas); border-radius: 2px; position: relative; cursor: crosshair; }
.se-tl-keyframe {
  position: absolute; top: 3px; width: 10px; height: 10px;
  background: var(--color-brand-primary); border-radius: 2px; transform: translateX(-5px) rotate(45deg);
  cursor: grab; transition: background 0.12s;
}
.se-tl-keyframe:hover { background: var(--color-brand-primary-light); }

/* AI Panel */
.se-ai-container { border-top: 1px solid color-mix(in srgb, var(--color-status-success) 15%, transparent); margin-top: 0; }
.se-ai-concept-section { padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, var(--color-status-success) 10%, transparent); background: color-mix(in srgb, var(--color-status-success) 2%, transparent); }
.se-ai-concept-row { display: flex; align-items: center; gap: 8px; }
.se-ai-concept-input {
  flex: 1; padding: 6px 10px; font-size: 13px; font-weight: 600;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-status-success) 25%, transparent);
  color: var(--color-status-success); border-radius: 4px; font-family: inherit; box-sizing: border-box;
}
.se-ai-concept-input::placeholder { color: color-mix(in srgb, var(--color-status-success) 30%, transparent); font-weight: 400; }
.se-ai-concept-input:focus { border-color: color-mix(in srgb, var(--color-status-success) 50%, transparent); outline: none; }
.se-ai-weapon-badge {
  padding: 3px 8px; font-size: 10px; font-weight: 700;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  color: var(--color-brand-primary); border-radius: 12px; white-space: nowrap; flex-shrink: 0;
}
.se-ai-concept-hint { font-size: 10px; color: var(--color-text-tertiary); padding: 4px 0 0; line-height: 1.4; }
.se-ai-panel { padding: 0; }
.se-ai-presets { display: flex; flex-wrap: wrap; gap: 4px; padding: 8px 12px; }
.se-ai-preset-wrapper { display: inline-flex; align-items: stretch; gap: 0; line-height: 1; }
.se-ai-preset-btn {
  min-height: 28px; padding: 0 10px; font-size: 11px;
  background: color-mix(in srgb, var(--color-status-success) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-status-success) 25%, transparent);
  color: var(--color-status-success); border-radius: 3px; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
}
.se-ai-preset-btn.has-ref { border-radius: 3px 0 0 3px; border-right: none; }
.se-ai-preset-btn:hover { background: color-mix(in srgb, var(--color-status-success) 18%, transparent); }
.se-ai-quick-gen-btn {
  width: 30px; min-height: 28px; padding: 0; font-size: 11px;
  background: color-mix(in srgb, var(--color-status-warning) 15%, transparent); border: 1px solid color-mix(in srgb, var(--color-status-warning) 40%, transparent);
  color: var(--color-status-warning); border-radius: 0 3px 3px 0; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center;
}
.se-ai-quick-gen-btn:hover { background: color-mix(in srgb, var(--color-status-warning) 35%, transparent); }
.se-ai-recommend-svg { width: 14px; height: 14px; }
.se-ai-label { font-size: 11px; color: var(--color-text-secondary); padding: 4px 12px 2px; }
.se-ai-prompt {
  width: calc(100% - 24px); margin: 0 12px; padding: 6px 8px; font-size: 12px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-status-success) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: inherit; resize: vertical;
}
.se-ai-gen-btn {
  width: 100%; min-width: 0; padding: 6px 10px; font-size: 12px; font-weight: 700;
  background: color-mix(in srgb, var(--color-status-success) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-status-success) 40%, transparent); color: var(--color-status-success);
  border-radius: 4px; cursor: pointer; font-family: inherit; transition: background 0.15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  white-space: nowrap;
}
.se-ai-gen-btn:hover { background: color-mix(in srgb, var(--color-status-success) 30%, transparent); }
.se-ai-status { padding: 4px 12px; font-size: 11px; color: var(--color-text-tertiary); }
.se-ai-status.active { color: var(--color-brand-primary); }
.se-ai-status.success { color: var(--color-status-success); }
.se-ai-progress {
  display: none;
  height: 4px;
  margin: 0 12px 8px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-brand-primary) 10%, var(--color-background-canvas));
}
.se-ai-progress.active { display: block; }
.se-ai-progress-bar {
  width: 38%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, transparent, var(--color-brand-primary), transparent);
  animation: se-ai-progress-sweep 1.05s ease-in-out infinite;
}
@keyframes se-ai-progress-sweep {
  from { transform: translateX(-120%); }
  to { transform: translateX(280%); }
}
.se-ai-result { padding: 0 12px 8px; }
.se-ai-apply-btn {
  margin: 6px 0; padding: 6px 14px; font-size: 12px; font-weight: 700;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer; width: 100%; font-family: inherit;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.se-ai-apply-btn:hover { background: var(--color-interaction-selected-brand); }
.se-ai-prompt-preview, .se-ai-json-preview {
  max-height: 120px; overflow: auto; padding: 6px 8px;
  background: var(--color-background-canvas); border: 1px solid var(--color-border-default);
  border-radius: 3px; font-size: 10px; color: var(--color-text-secondary);
  font-family: monospace; white-space: pre-wrap; margin: 4px 0;
}
.se-ai-llm-config { padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, var(--color-status-success) 10%, transparent); }
.se-ai-input {
  display: block; width: calc(100% - 0px); margin: 4px 0; padding: 4px 8px; font-size: 11px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-status-success) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: inherit; box-sizing: border-box;
}
.se-ai-input option { background: var(--color-background-base); color: var(--color-text-primary); }
.se-ai-mode-desc { font-size: 10px; color: var(--color-text-secondary); padding: 2px 0 4px; line-height: 1.4; }
.se-ai-custom-api { padding-top: 4px; }
.se-ai-sec-note { font-size: 10px; color: var(--color-status-warning); padding: 4px 0; line-height: 1.4; }
.se-ai-btn-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 4px 12px 8px; }
.se-ai-import-btn {
  width: 100%; min-width: 0; padding: 6px 10px; font-size: 12px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer; font-family: inherit; transition: background 0.15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  white-space: nowrap;
}
.se-ai-import-btn:hover { background: var(--color-interaction-selected-brand); }
.se-ai-name-input {
  display: block; width: calc(100% - 24px); margin: 0 12px; padding: 5px 8px; font-size: 12px;
  background: var(--color-background-canvas); border: 1px solid color-mix(in srgb, var(--color-status-success) 20%, transparent);
  color: var(--color-text-primary); border-radius: 3px; font-family: inherit; box-sizing: border-box;
}
.se-ai-anim-list { border-top: 1px solid color-mix(in srgb, var(--color-status-success) 10%, transparent); margin-top: 8px; }
.se-ai-anim-list-header { font-size: 11px; font-weight: 700; color: var(--color-text-secondary); padding: 8px 12px 4px; letter-spacing: 1px; }
.se-ai-anim-item {
  display: flex; align-items: center; gap: 8px; padding: 5px 12px;
  cursor: pointer; transition: background 0.1s; font-size: 12px;
}
.se-ai-anim-item:hover { background: color-mix(in srgb, var(--color-status-success) 6%, transparent); }
.se-ai-anim-name { color: var(--color-status-success); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.se-ai-anim-dur { font-size: 10px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; flex-shrink: 0; }
.se-ai-anim-btn {
  width: 22px; height: 22px; padding: 0; font-size: 10px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--color-border-default); background: var(--color-interaction-hover);
  color: var(--color-text-tertiary); font-family: inherit; transition: background 0.12s; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
}
.se-ai-anim-btn:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.se-ai-anim-del { border-color: color-mix(in srgb, var(--color-status-error) 25%, transparent); color: var(--color-status-error); }
.se-ai-anim-del:hover { background: color-mix(in srgb, var(--color-status-error) 15%, transparent); }
.se-ai-anim-empty { font-size: 11px; color: var(--color-text-tertiary); padding: 8px 12px; text-align: center; }

/* Template Library */
.se-tmpl-container { overflow-y: auto; flex: 1; }
.se-tmpl-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid var(--color-border-subtle);
}
.se-tmpl-title { font-size: 14px; font-weight: 700; color: var(--color-brand-primary); font-family: 'Orbitron', monospace; }
.se-tmpl-import-btn {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer;
  background: var(--color-brand-primary); border: 1px solid var(--color-brand-primary);
  color: var(--color-text-on-bright-primary); transition: background 0.15s;
}
.se-tmpl-import-btn:hover { background: var(--color-brand-primary-hover); }
.se-tmpl-grid { padding: 8px; display: flex; flex-direction: column; gap: 10px; }
.se-tmpl-card {
  display: flex; gap: 12px; padding: 12px; cursor: pointer; position: relative;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 10%, transparent);
  border-radius: 8px; transition: all 0.2s;
}
.se-tmpl-card:hover {
  background: var(--color-interaction-selected-brand); border-color: color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.se-tmpl-featured { border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent) !important; background: var(--color-interaction-selected-brand) !important; }
.se-tmpl-thumb {
  font-size: 28px; display: flex; align-items: center; justify-content: center;
  width: 80px; min-height: 60px; flex-shrink: 0;
  background: var(--color-background-canvas); border-radius: 6px; overflow: hidden;
}
.se-tmpl-thumb-img { width: 100%; height: auto; max-height: 80px; object-fit: contain; image-rendering: pixelated; }
.se-tmpl-thumb-emoji { font-size: 32px; }
.se-tmpl-info { flex: 1; min-width: 0; }
.se-tmpl-name { font-size: 13px; font-weight: 700; color: var(--color-brand-primary); margin-bottom: 3px; }
.se-tmpl-desc { font-size: 11px; color: var(--color-text-secondary); margin-bottom: 4px; line-height: 1.4; }
.se-tmpl-meta { font-size: 10px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; }

/* Binding Panel */
.se-binding-container {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--color-background-base); z-index: 10;
}
.bp-root { display: flex; flex-direction: column; height: 100%; }
.bp-header {
  height: 44px; background: var(--color-background-elevated); border-bottom: 1px solid var(--color-border-subtle);
  display: flex; align-items: center; gap: 16px; padding: 0 16px; flex-shrink: 0;
}
.bp-title { font-weight: 700; font-size: 15px; color: var(--color-brand-primary); }
.bp-help { font-size: 11px; color: var(--color-text-tertiary); margin-right: auto; }
.bp-upload {
  padding: 6px 18px; border: none; border-radius: 4px; cursor: pointer;
  background: var(--color-brand-primary); color: var(--color-text-on-bright-primary); font-weight: 700; font-size: 13px;
}
.bp-upload:hover { background: var(--color-brand-primary-hover); }
.bp-body { flex: 1; display: flex; overflow: hidden; }
.bp-sidebar { width: 220px; background: var(--color-background-elevated); overflow-y: auto; flex-shrink: 0; border-right: 1px solid var(--color-border-subtle); }
.bp-tip { padding: 12px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; border-bottom: 1px solid var(--color-border-subtle); }
.bp-tip b { color: var(--color-text-primary); }
.bp-part {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
  border-left: 3px solid transparent; transition: background 0.1s;
}
.bp-part:hover { background: var(--color-background-floating); }
.bp-part.active { background: var(--color-background-floating); border-left-color: var(--color-brand-primary); }
.bp-part.done { opacity: 1; }
.bp-part.skipped { opacity: 0.4; cursor: default; }
.bp-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.bp-part-name { font-size: 13px; color: var(--color-text-primary); flex: 1; }
.bp-part-status { font-size: 12px; flex-shrink: 0; }
.bp-thumb { width: 28px; height: 28px; object-fit: contain; border-radius: 3px; border: 1px solid var(--color-border-default); flex-shrink: 0; }
.bp-canvas-wrap { flex: 1; position: relative; overflow: hidden; }
.bp-canvas { display: block; width: 100%; height: 100%; }
.bp-toast {
  position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(60px);
  background: rgba(0,0,0,0.85); color: var(--color-text-primary); padding: 10px 24px; border-radius: 6px;
  font-size: 14px; pointer-events: none; opacity: 0; transition: all 0.3s;
}
.bp-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.bp-undo-btn {
  padding: 5px 14px; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 30%, transparent); border-radius: 4px;
  background: var(--color-interaction-selected-brand); color: var(--color-brand-primary); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit;
}
.bp-undo-btn:hover { background: var(--color-interaction-selected-brand); }
.bp-part-btns { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.bp-part-btn {
  padding: 2px 8px; font-size: 10px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--color-border-default); background: var(--color-interaction-hover);
  color: var(--color-text-secondary); font-family: inherit; transition: background 0.12s;
}
.bp-part-btn:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.bp-part-del-btn { border-color: color-mix(in srgb, var(--color-status-error) 30%, transparent); color: var(--color-status-error); }
.bp-part-del-btn:hover { background: color-mix(in srgb, var(--color-status-error) 20%, transparent); }
.bp-part-redo-btn { border-color: color-mix(in srgb, var(--color-brand-primary) 30%, transparent); color: var(--color-brand-primary); }
.bp-part-redo-btn:hover { background: var(--color-interaction-selected-brand); }
.bp-ctx-menu {
  position: absolute; z-index: 100; min-width: 120px;
  background: var(--color-background-floating); border: 1px solid var(--color-border-default); border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5); overflow: hidden;
}
.bp-ctx-label { padding: 6px 12px; font-size: 11px; font-weight: 700; color: var(--color-brand-primary); border-bottom: 1px solid var(--color-border-subtle); background: var(--color-interaction-selected-brand); }
.bp-ctx-item { padding: 8px 12px; font-size: 12px; color: var(--color-text-primary); cursor: pointer; transition: background 0.1s; }
.bp-ctx-item:hover { background: var(--color-interaction-hover); }
.bp-ctx-danger { color: var(--color-status-error); }
.bp-ctx-danger:hover { background: color-mix(in srgb, var(--color-status-error) 15%, transparent); }
.bp-action-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px; flex-shrink: 0;
  background: var(--color-background-elevated); border-top: 1px solid var(--color-border-subtle);
}
.bp-action-info { font-size: 12px; color: var(--color-text-secondary); margin-right: auto; }
.bp-action-btn {
  padding: 6px 16px; font-size: 12px; font-weight: 600;
  background: var(--color-interaction-selected-brand); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 25%, transparent);
  color: var(--color-brand-primary); border-radius: 4px; cursor: pointer; font-family: inherit; transition: background 0.15s;
}
.bp-action-btn:hover { background: var(--color-interaction-selected-brand); }
.bp-action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.bp-action-primary {
  background: color-mix(in srgb, var(--color-status-success) 15%, transparent);
  border-color: color-mix(in srgb, var(--color-status-success) 40%, transparent); color: var(--color-status-success);
}
.bp-action-primary:hover { background: color-mix(in srgb, var(--color-status-success) 25%, transparent); }
.bp-offset-info { font-size: 9px; color: var(--color-text-tertiary); font-family: 'Orbitron',monospace; margin-left: auto; flex-shrink: 0; }
.bp-part-skip-btn { border-color: var(--color-border-default); color: var(--color-text-tertiary); }
.bp-part-skip-btn:hover { background: var(--color-interaction-hover); color: var(--color-text-secondary); }

/* ═══════════════════ Spine 左侧 step nav（拆分部件 / 自动绑骨 / 动作工坊 / 导出） ═══════════════════
 * 之前 mount() 把 .spine-step-nav 加到 leftPanel 但从未给它定义样式，
 * 4 个按钮渲染成裸 button 堆，视觉上几乎看不见。补上：grid 平铺 + 边框 +
 * active/completed 高亮，复用 STUDIO_CSS 已有的色板（品牌色 = var(--color-brand-primary)）。
 */
.spine-step-nav {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 10px 12px;
  background: var(--color-divider-subtle);
  border-bottom: 1px solid var(--color-divider-default);
}
.spine-step-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 6px;
  background: var(--color-interaction-hover);
  border: 1px solid var(--color-divider-default);
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: 12px; font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.spine-step-btn:hover {
  background: var(--color-interaction-selected-brand);
  border-color: color-mix(in srgb, var(--color-brand-primary) 30%, transparent);
  color: var(--color-text-primary);
}
.spine-step-btn.active {
  background: var(--color-interaction-selected-brand);
  border-color: color-mix(in srgb, var(--color-brand-primary) 60%, transparent);
  color: var(--color-brand-primary);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 25%, transparent) inset;
}
.spine-step-btn.completed {
  /* 已完成态：用品牌色降调，区别于 active（当前），也区别于 status-success（操作成功反馈） */
  border-color: color-mix(in srgb, var(--color-brand-primary) 22%, transparent);
  color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-text-tertiary));
  background: color-mix(in srgb, var(--color-brand-primary) 4%, transparent);
}
.spine-step-btn .step-icon { font-size: 14px; line-height: 1; }
.spine-left-body { padding: 4px 0; }
`;
