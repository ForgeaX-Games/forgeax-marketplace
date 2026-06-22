// @source wb-character/src/pipelines/spine/editor/AnimWorkshopTab.ts
import type { StudioState, StudioTab, TabId } from './StudioState';
import type { EditorSkeleton, EditorState, RawAnimation, RawBoneTimeline } from './types';
import { SpineRenderer } from './SpineRenderer';
import { BoneTreePanel } from './BoneTreePanel';
import { PropertyPanel } from './PropertyPanel';
import { AnimationTimeline } from './AnimationTimeline';
import { AIAnimPanel } from './AIAnimPanel';
import { TemplateLibrary, cropAtlasRegions } from './TemplateLibrary';
import type { SkeletonTemplate } from './TemplateLibrary';
import { parseSpineJson } from './SpineDataParser';
import { spineIcon, spineBtnLabel } from './spine-icons';

interface BoneSnapshot {
  bones: Map<string, {
    localX: number; localY: number; localRotation: number;
    setupX: number; setupY: number; setupRotation: number;
  }>;
}

export class AnimWorkshopTab implements StudioTab {
  readonly id: TabId = 'anim';
  readonly container: HTMLDivElement;
  readonly sidePanel: HTMLDivElement;
  readonly centerView: HTMLDivElement;
  readonly centerToolbar: HTMLDivElement;
  readonly bottomPanel: HTMLDivElement;
  readonly rightPanel: HTMLDivElement;

  private state: StudioState | null = null;
  private onStateChange: (() => void) | null = null;
  private canvas!: HTMLCanvasElement;
  private renderer!: SpineRenderer;
  private boneTree!: BoneTreePanel;
  private propPanel!: PropertyPanel;
  private timeline!: AnimationTimeline;
  private aiPanel!: AIAnimPanel;
  private templateLib!: TemplateLibrary;
  private skeleton: EditorSkeleton | null = null;
  private animFrame = 0;
  private lastTime = 0;
  private zoomLabel!: HTMLSpanElement;
  private attachmentDataUrls = new Map<string, string>();
  private workshopBc: BroadcastChannel | null = null;
  private workshopBcSelfId = Math.random().toString(36).slice(2, 10);
  private rightCollapsed = false;

  private undoStack: BoneSnapshot[] = [];
  private redoStack: BoneSnapshot[] = [];
  private pendingSnapshot: BoneSnapshot | null = null;
  private loadedBindingVersion = -1;

  private editorState: EditorState = {
    mode: 'edit',
    selectedBone: null,
    hoveredBone: null,
    currentAnimation: null,
    animationTime: 0,
    playing: false,
    zoom: 1.5,
    panX: 0,
    panY: 0,
    showBones: true,
    showSlots: false,
    showIK: true,
    showAttachments: false,
  };

  private activeSubTab: 'anims' | 'templates' | 'bones' = 'anims';

  constructor(parent: HTMLElement, onStateChange: () => void) {
    this.onStateChange = onStateChange;
    this.container = document.createElement('div');
    this.container.className = 'studio-tab-content';
    parent.appendChild(this.container);

    this.sidePanel = document.createElement('div');
    this.sidePanel.className = 'aw-side';
    this.sidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    this.centerView = document.createElement('div');
    this.centerView.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;position:relative;';

    this.centerToolbar = document.createElement('div');
    this.centerToolbar.className = 'aw-toolbar';

    this.bottomPanel = document.createElement('div');
    this.bottomPanel.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;';

    this.rightPanel = document.createElement('div');
    this.rightPanel.className = 'aw-side-right';
    this.rightPanel.style.cssText = 'display:flex;height:100%;overflow:hidden;';

    this.buildUI();
    this.wireEvents();
    this.setupWorkshopSync();
    this.setupCanvasInteraction();
    this.setupKeyboard();
    this.setupTimelineResize();
  }

  private q(selector: string): HTMLElement | null {
    return this.sidePanel.querySelector(selector)
      ?? this.centerView.querySelector(selector)
      ?? this.centerToolbar.querySelector(selector)
      ?? this.bottomPanel.querySelector(selector)
      ?? this.rightPanel.querySelector(selector)
      ?? null;
  }

  private setupWorkshopSync(): void {
    try {
      this.workshopBc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-anim.spine-workshop');
    } catch {
      this.workshopBc = null;
      return;
    }
    this.workshopBc.onmessage = (e: MessageEvent) => {
      const data = e.data as {
        type?: string;
        from?: string;
        name?: string;
        play?: boolean;
        visible?: boolean;
      } | null;
      if (!data || data.from === this.workshopBcSelfId) return;
      if (data.type === 'select-animation' && data.name) {
        this.applyAnimationSelection(data.name, !!data.play, false);
      }
      if (data.type === 'set-ai-panel' && typeof data.visible === 'boolean') {
        this.setAIPanelVisible(data.visible, false);
      }
    };
  }

  private broadcastWorkshop(message: Record<string, unknown>): void {
    if (!this.workshopBc) return;
    try {
      this.workshopBc.postMessage({ ...message, from: this.workshopBcSelfId });
    } catch (e) {
      console.warn('[Spine] broadcast workshop command failed:', e);
    }
  }

  private buildUI(): void {
    this.sidePanel.innerHTML = `
      <div class="se-left-tabs">
        <button class="se-left-tab active" data-tab="anims">${spineBtnLabel('anim', '动作库')}</button>
        <button class="se-left-tab" data-tab="bones">${spineBtnLabel('bone', '骨骼树')}</button>
        <button class="se-left-tab" data-tab="templates">${spineBtnLabel('folder', '模板')}</button>
      </div>
      <div class="aw-anims-wrap se-left-tab-content" id="aw-anims-wrap" style="display:flex">
        <div class="aw-anim-source-bar">
          <div class="aw-source-title">动作来源</div>
          <div class="aw-source-btns">
            <button class="aw-source-btn" id="aw-import-json">${spineBtnLabel('folder', '导入JSON动作包')}</button>
            <button class="aw-source-btn aw-source-ai" id="aw-ai-gen-btn">${spineBtnLabel('bot', 'AI 生成动画')}</button>
          </div>
        </div>
        <div class="aw-anim-list-area" id="aw-anim-list-area">
          <div class="aw-anim-empty">暂无动作，请导入JSON或使用AI生成</div>
        </div>
      </div>
      <div class="aw-bone-wrap se-left-tab-content" id="aw-bone-wrap" style="display:none"></div>
      <div class="aw-template-wrap se-left-tab-content" id="aw-template-wrap" style="display:none"></div>
      <div class="aw-footer-next">
        <button class="studio-next-btn" id="aw-next-step" style="width:100%;">确认 → 上传游戏</button>
      </div>
    `;

    this.centerToolbar.innerHTML = `
      <label class="se-tb-check"><input type="checkbox" id="aw-show-bones" checked> 骨骼</label>
      <label class="se-tb-check"><input type="checkbox" id="aw-show-ik" checked> IK</label>
      <span class="se-tb-sep">|</span>
      <button class="se-tb-btn se-tb-icon-btn se-tb-undo" id="aw-undo" title="撤回">${spineIcon('undo', 'spine-icon-svg se-tb-svg')}</button>
      <button class="se-tb-btn se-tb-icon-btn se-tb-redo" id="aw-redo" title="重做">${spineIcon('redo', 'spine-icon-svg se-tb-svg')}</button>
      <span class="se-tb-sep">|</span>
      <button class="se-tb-btn se-tb-icon-btn se-tb-zoom-btn" id="aw-zoom-out" title="缩小">${spineIcon('zoomOut', 'spine-icon-svg se-tb-svg')}</button>
      <span class="se-tb-zoom-label" id="aw-zoom-label">150%</span>
      <button class="se-tb-btn se-tb-icon-btn se-tb-zoom-btn" id="aw-zoom-in" title="放大">${spineIcon('zoomIn', 'spine-icon-svg se-tb-svg')}</button>
      <span class="se-tb-sep">|</span>
      <button class="se-tb-btn se-tb-save-btn" id="aw-save-tmpl">${spineBtnLabel('save', '存模板')}</button>
      <span class="aw-info" id="aw-info"></span>
    `;

    const canvas = document.createElement('canvas');
    canvas.className = 'se-canvas aw-canvas';
    canvas.id = 'aw-canvas';
    this.centerView.appendChild(canvas);

    this.bottomPanel.innerHTML = `
      <div class="aw-tl-resize-handle" id="aw-tl-resize"></div>
      <div class="aw-timeline-area" id="aw-timeline-area"></div>
    `;

    this.rightPanel.innerHTML = `
      <div class="aw-right-collapse-rail">
        <button class="aw-right-collapse-btn" id="aw-right-collapse" type="button" title="折叠右侧栏">${spineIcon('arrow', 'spine-icon-svg aw-collapse-svg')}</button>
      </div>
      <div class="aw-right-content">
        <div id="aw-prop-wrap" class="aw-right-section"></div>
        <div id="aw-ai-wrap" class="se-ai-container aw-right-section" style="display:none"></div>
      </div>
    `;

    this.canvas = canvas;
    this.renderer = new SpineRenderer(this.canvas, this.editorState);

    const boneWrap = this.sidePanel.querySelector('#aw-bone-wrap') as HTMLElement;
    this.boneTree = new BoneTreePanel(boneWrap);

    const propWrap = this.rightPanel.querySelector('#aw-prop-wrap') as HTMLElement;
    this.propPanel = new PropertyPanel(propWrap);

    const tlArea = this.bottomPanel.querySelector('#aw-timeline-area') as HTMLElement;
    this.timeline = new AnimationTimeline(tlArea);

    const aiWrap = this.rightPanel.querySelector('#aw-ai-wrap') as HTMLElement;
    this.aiPanel = new AIAnimPanel(aiWrap);

    const tmplWrap = this.sidePanel.querySelector('#aw-template-wrap') as HTMLElement;
    this.templateLib = new TemplateLibrary(tmplWrap);

    this.zoomLabel = this.q('#aw-zoom-label') as HTMLSpanElement;

    this.sidePanel.querySelectorAll('.se-left-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = (tab as HTMLElement).dataset.tab as 'anims' | 'templates' | 'bones';
        this.switchSubTab(t);
      });
    });

    this.q('#aw-show-bones')?.addEventListener('change', (e) => {
      this.editorState.showBones = (e.target as HTMLInputElement).checked;
    });
    this.q('#aw-show-ik')?.addEventListener('change', (e) => {
      this.editorState.showIK = (e.target as HTMLInputElement).checked;
    });

    this.q('#aw-undo')?.addEventListener('click', () => this.undo());
    this.q('#aw-redo')?.addEventListener('click', () => this.redo());
    this.q('#aw-zoom-in')?.addEventListener('click', () => {
      this.editorState.zoom = Math.min(200, this.editorState.zoom * 1.2);
      this.updateZoomLabel();
    });
    this.q('#aw-zoom-out')?.addEventListener('click', () => {
      this.editorState.zoom = Math.max(0.01, this.editorState.zoom / 1.2);
      this.updateZoomLabel();
    });
    this.q('#aw-import-json')?.addEventListener('click', () => this.promptLoadJson());
    this.q('#aw-ai-gen-btn')?.addEventListener('click', () => this.toggleAIPanel(true));
    this.q('#aw-save-tmpl')?.addEventListener('click', () => this.saveAsTemplate());
    this.q('#aw-right-collapse')?.addEventListener('click', () => this.setRightCollapsed(!this.rightCollapsed));
    this.q('#aw-next-step')?.addEventListener('click', () => {
      this.syncAnimationsToState();
      if (this.state) {
        this.state.activeTab = 'upload';
        this.onStateChange?.();
      }
    });
  }

  private setRightCollapsed(collapsed: boolean): void {
    this.rightCollapsed = collapsed;
    this.rightPanel.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('aw-right-collapsed', collapsed);
    const host = this.rightPanel.parentElement;
    host?.classList.toggle('aw-right-collapsed', collapsed);
    const btn = this.q('#aw-right-collapse') as HTMLButtonElement | null;
    if (btn) {
      btn.title = collapsed ? '展开右侧栏' : '折叠右侧栏';
      btn.classList.toggle('collapsed', collapsed);
    }
    window.dispatchEvent(new Event('resize'));
  }

  private wireEvents(): void {
    this.boneTree.onSelectBone = (name) => {
      this.editorState.selectedBone = name;
      this.timeline.setSelectedBone(name);
      if (name) this.propPanel.showBone(name);
      else this.propPanel.showNone();
    };

    this.renderer.onBoneClick = (name) => {
      this.editorState.selectedBone = name;
      this.boneTree.setSelected(name);
      if (name) this.propPanel.showBone(name);
      else this.propPanel.showNone();
    };

    this.renderer.onBoneHover = (name) => {
      this.editorState.hoveredBone = name;
    };

    this.renderer.onBoneEdited = (name, prop, value) => {
      this.propPanel.showBone(name);
      const bone = this.skeleton?.bones.get(name);
      if (!bone) return;

      if (this.editorState.currentAnimation && !this.editorState.playing) {
        if (prop === 'rotation') {
          const delta = (value as number) - bone.setupRotation;
          this.timeline.addOrUpdateKeyframe(name, prop, delta);
        } else if (prop === 'position') {
          const v = value as { x: number; y: number };
          this.timeline.addOrUpdateKeyframe(name, prop, { x: v.x - bone.setupX, y: v.y - bone.setupY });
        }
      } else if (!this.editorState.currentAnimation) {
        if (prop === 'rotation') bone.setupRotation = value as number;
        else if (prop === 'position') {
          const v = value as { x: number; y: number };
          bone.setupX = v.x;
          bone.setupY = v.y;
        }
      }
    };

    this.renderer.onDragStart = () => {
      this.pendingSnapshot = this.takeSnapshot();
    };

    this.renderer.onDragEnd = () => {
      if (this.pendingSnapshot) {
        this.undoStack.push(this.pendingSnapshot);
        this.redoStack.length = 0;
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.pendingSnapshot = null;
      }
    };

    this.timeline.onChange = (animName, time, playing) => {
      if (animName !== this.editorState.currentAnimation) {
        this.renderer.resetAnimationOffsets();
      }
      this.editorState.currentAnimation = animName;
      this.editorState.animationTime = time;
      this.editorState.playing = playing;
    };

    this.templateLib.onTemplateSelectAsync = async (tmpl: SkeletonTemplate) => {
      if (!tmpl.skeleton) return;
      this.loadSkeleton(tmpl.skeleton, tmpl.name);
      if (tmpl.spritesheetUrl && tmpl.atlasText) {
        try {
          const images = await cropAtlasRegions(tmpl.spritesheetUrl, tmpl.atlasText);
          this.renderer.setAttachmentImages(images);
          this.attachmentDataUrls = this.imagesToDataUrls(images);
        } catch (e) {
          console.warn('Failed to load spritesheet:', e);
        }
      }
    };

    this.aiPanel.onAnimationGenerated = (anim) => {
      if (!this.skeleton) return;
      this.skeleton.animations.set(anim.name, anim);
      this.timeline.setSkeleton(this.skeleton);
      this.renderer.resetAnimationOffsets();
      this.timeline.selectAnimation(anim.name);
      this.aiPanel.refreshAnimList();
      this.syncAnimationsToState();
      this.onStateChange?.();
      this.refreshAnimListUI();
    };

    this.aiPanel.onAnimationDeleted = (animName) => {
      if (!this.skeleton) return;
      this.skeleton.animations.delete(animName);
      this.timeline.setSkeleton(this.skeleton);
      this.aiPanel.refreshAnimList();
      this.syncAnimationsToState();
      this.onStateChange?.();
      this.refreshAnimListUI();
    };

    this.aiPanel.onAnimationSelected = (animName) => {
      this.applyAnimationSelection(animName, false, true);
    };
  }

  private setupCanvasInteraction(): void {
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let panStart = { x: 0, y: 0 };

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        dragging = true;
        dragStart = { x: e.clientX, y: e.clientY };
        panStart = { x: this.editorState.panX, y: this.editorState.panY };
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
      }
    });

    this.centerView.addEventListener('mousemove', (e) => {
      if (dragging) {
        this.editorState.panX = panStart.x + (e.clientX - dragStart.x);
        this.editorState.panY = panStart.y + (e.clientY - dragStart.y);
      }
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        this.canvas.style.cursor = 'crosshair';
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dpr = window.devicePixelRatio || 1;
      const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
      const cx = W / 2 + this.editorState.panX;
      const cy = H / 2 + this.editorState.panY;
      const worldX = (mx - cx) / this.editorState.zoom;
      const worldY = (my - cy) / this.editorState.zoom;
      const oldZoom = this.editorState.zoom;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.editorState.zoom = Math.max(0.01, Math.min(200, oldZoom * factor));
      this.editorState.panX += worldX * (oldZoom - this.editorState.zoom);
      this.editorState.panY += worldY * (oldZoom - this.editorState.zoom);
      this.updateZoomLabel();
    }, { passive: false });
  }

  private setupKeyboard(): void {
    this.centerView.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) this.redo(); else this.undo();
          return;
        }
        if (e.key === 'y' || e.key === 'Y') {
          e.preventDefault();
          this.redo();
          return;
        }
      }
    });
    this.centerView.setAttribute('tabindex', '0');
  }

  private setupTimelineResize(): void {
    const handle = this.bottomPanel.querySelector('#aw-tl-resize') as HTMLElement;
    const tlArea = this.bottomPanel.querySelector('#aw-timeline-area') as HTMLElement;
    if (!handle || !tlArea) return;

    let startY = 0, startH = 0;
    const applyHeight = (height: number) => {
      const next = Math.max(120, Math.min(420, height));
      document.documentElement.style.setProperty('--aw-timeline-height', `${next}px`);
      tlArea.style.height = 'auto';
    };
    applyHeight(220);
    const onMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      applyHeight(startH + delta);
      window.dispatchEvent(new Event('resize'));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('dragging');
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = this.bottomPanel.parentElement?.getBoundingClientRect().height || tlArea.getBoundingClientRect().height || 220;
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  private switchSubTab(tab: 'anims' | 'templates' | 'bones'): void {
    this.activeSubTab = tab as any;
    const animsWrap = this.sidePanel.querySelector('#aw-anims-wrap') as HTMLElement;
    const tmplWrap = this.sidePanel.querySelector('#aw-template-wrap') as HTMLElement;
    const boneWrap = this.sidePanel.querySelector('#aw-bone-wrap') as HTMLElement;
    animsWrap.style.display = tab === 'anims' ? 'flex' : 'none';
    tmplWrap.style.display = tab === 'templates' ? 'block' : 'none';
    boneWrap.style.display = tab === 'bones' ? 'block' : 'none';
    this.sidePanel.querySelectorAll('.se-left-tab').forEach(t => {
      t.classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
    });
  }

  private toggleAIPanel(broadcast = true): void {
    const wrap = this.rightPanel.querySelector('#aw-ai-wrap') as HTMLElement;
    const nextVisible = wrap.style.display === 'none';
    this.setAIPanelVisible(nextVisible, broadcast);
  }

  private setAIPanelVisible(visible: boolean, broadcast = true): void {
    const wrap = this.rightPanel.querySelector('#aw-ai-wrap') as HTMLElement;
    if (!wrap) return;
    wrap.style.display = visible ? 'block' : 'none';
    const btn = this.q('#aw-ai-gen-btn') as HTMLElement;
    if (btn) btn.classList.toggle('aw-source-active', visible);
    if (visible) this.aiPanel.refreshAnimList();
    if (broadcast) this.broadcastWorkshop({ type: 'set-ai-panel', visible });
  }

  private applyAnimationSelection(name: string, play = false, broadcast = true): void {
    if (!this.skeleton?.animations.has(name)) return;
    this.timeline.selectAnimation(name);
    this.renderer.resetAnimationOffsets();
    if (play && !this.timeline.playing) {
      this.timeline.togglePlay();
    }
    this.refreshAnimListUI();
    if (broadcast) this.broadcastWorkshop({ type: 'select-animation', name, play });
  }

  refreshAnimListUI(): void {
    const area = this.q('#aw-anim-list-area') as HTMLElement;
    if (!area || !this.skeleton) return;
    area.innerHTML = '';

    if (this.skeleton.animations.size === 0) {
      area.innerHTML = '<div class="aw-anim-empty">暂无动作，请导入JSON或使用AI生成</div>';
      return;
    }

    for (const [name, anim] of this.skeleton.animations) {
      const item = document.createElement('div');
      item.className = 'aw-anim-item';
      if (this.editorState.currentAnimation === name) item.classList.add('active');

      const info = document.createElement('div');
      info.className = 'aw-anim-item-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'aw-anim-item-name';
      nameEl.textContent = name;
      info.appendChild(nameEl);

      const dur = document.createElement('span');
      dur.className = 'aw-anim-item-dur';
      const totalTime = Object.values(anim.boneTimelines).reduce((max, tl) => {
        const maxT = [...(tl.rotate || []), ...(tl.translate || []), ...(tl.scale || []), ...(tl.shear || [])];
        return Math.max(max, ...maxT.map(k => k.time ?? (k as any).time ?? 0));
      }, 0);
      dur.textContent = `${totalTime.toFixed(2)}s`;
      info.appendChild(dur);

      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'aw-anim-item-actions';

      const playBtn = document.createElement('button');
      playBtn.className = 'aw-anim-act-btn';
      playBtn.innerHTML = spineIcon('play', 'spine-icon-svg aw-anim-act-svg');
      playBtn.title = '播放';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.applyAnimationSelection(name, true, true);
      });
      actions.appendChild(playBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'aw-anim-act-btn aw-anim-act-del';
      delBtn.innerHTML = spineIcon('trash', 'spine-icon-svg aw-anim-act-svg');
      delBtn.title = '删除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`删除动作 "${name}"？`)) {
          this.skeleton!.animations.delete(name);
          this.timeline.setSkeleton(this.skeleton!);
          this.aiPanel.refreshAnimList();
          this.syncAnimationsToState();
          this.onStateChange?.();
          this.refreshAnimListUI();
        }
      });
      actions.appendChild(delBtn);

      item.appendChild(actions);

      item.addEventListener('click', () => {
        this.applyAnimationSelection(name, false, true);
      });

      area.appendChild(item);
    }
  }

  loadSkeleton(json: any, name: string): void {
    this.skeleton = parseSpineJson(json);
    this.renderer.setSkeleton(this.skeleton);
    this.renderer.clearAttachmentImages();
    this.boneTree.setSkeleton(this.skeleton);
    this.propPanel.setSkeleton(this.skeleton);
    this.timeline.setSkeleton(this.skeleton);
    this.aiPanel.setSkeleton(this.skeleton);
    this.aiPanel.refreshAnimList();
    this.refreshAnimListUI();
    this.switchSubTab('anims');

    const info = this.q('#aw-info') as HTMLElement;
    if (info) {
      info.textContent = `${name} | ${this.skeleton.boneOrder.length} 骨骼 | ${this.skeleton.animations.size} 动画`;
    }
  }

  loadAttachmentImages(cropImages: Map<string, string>): void {
    const imgMap = new Map<string, HTMLImageElement>();
    let loaded = 0;
    const total = cropImages.size;
    for (const [partId, dataUrl] of cropImages) {
      const img = new Image();
      img.onload = () => { loaded++; if (loaded === total) this.renderer.setAttachmentImages(imgMap); };
      img.onerror = () => { loaded++; if (loaded === total) this.renderer.setAttachmentImages(imgMap); };
      img.src = dataUrl;
      imgMap.set(partId, img);
    }
  }

  private updateZoomLabel(): void {
    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(this.editorState.zoom * 100)}%`;
    }
  }

  private takeSnapshot(): BoneSnapshot {
    const map = new Map<string, any>();
    if (this.skeleton) {
      for (const [name, bone] of this.skeleton.bones) {
        map.set(name, {
          localX: bone.localX, localY: bone.localY, localRotation: bone.localRotation,
          setupX: bone.setupX, setupY: bone.setupY, setupRotation: bone.setupRotation,
        });
      }
    }
    return { bones: map };
  }

  private applySnapshot(snap: BoneSnapshot): void {
    if (!this.skeleton) return;
    for (const [name, data] of snap.bones) {
      const bone = this.skeleton.bones.get(name);
      if (bone) {
        bone.localX = data.localX; bone.localY = data.localY; bone.localRotation = data.localRotation;
        bone.setupX = data.setupX; bone.setupY = data.setupY; bone.setupRotation = data.setupRotation;
      }
    }
    if (this.editorState.selectedBone) this.propPanel.showBone(this.editorState.selectedBone);
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this.takeSnapshot());
    this.applySnapshot(this.undoStack.pop()!);
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(this.takeSnapshot());
    this.applySnapshot(this.redoStack.pop()!);
  }

  private async promptLoadJson(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const json = JSON.parse(await file.text());
      if (!this.skeleton) {
        this.loadSkeleton(json, file.name.replace('.json', ''));
        this.refreshAnimListUI();
        return;
      }
      if (json.animations && typeof json.animations === 'object') {
        const names = Object.keys(json.animations);
        if (names.length === 0) {
          this.loadSkeleton(json, file.name.replace('.json', ''));
          this.refreshAnimListUI();
          return;
        }
        this.showAnimImportDialog(json, names);
      } else {
        this.loadSkeleton(json, file.name.replace('.json', ''));
        this.refreshAnimListUI();
      }
    });
    input.click();
  }

  private showAnimImportDialog(json: any, animNames: string[]): void {
    const overlay = document.createElement('div');
    overlay.className = 'aw-import-overlay';
    overlay.innerHTML = `
      <div class="aw-import-dialog">
        <div class="aw-import-title">选择要导入的动作</div>
        <div class="aw-import-hint">JSON包含 ${animNames.length} 个动作，选择需要加载的：</div>
        <div class="aw-import-list" id="aw-import-list"></div>
        <div class="aw-import-actions">
          <button class="aw-import-btn" id="aw-import-all">全选</button>
          <button class="aw-import-btn" id="aw-import-none">全不选</button>
          <span style="flex:1"></span>
          <button class="aw-import-btn aw-import-cancel" id="aw-import-cancel">取消</button>
          <button class="aw-import-btn aw-import-confirm" id="aw-import-ok">导入选中</button>
        </div>
      </div>
    `;
    this.centerView.appendChild(overlay);

    const list = overlay.querySelector('#aw-import-list')!;
    const checks: { name: string; cb: HTMLInputElement }[] = [];
    for (const name of animNames) {
      const row = document.createElement('label');
      row.className = 'aw-import-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true;
      row.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = name;
      row.appendChild(span);
      list.appendChild(row);
      checks.push({ name, cb });
    }

    overlay.querySelector('#aw-import-all')?.addEventListener('click', () => checks.forEach(c => c.cb.checked = true));
    overlay.querySelector('#aw-import-none')?.addEventListener('click', () => checks.forEach(c => c.cb.checked = false));
    overlay.querySelector('#aw-import-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#aw-import-ok')?.addEventListener('click', () => {
      const selected = checks.filter(c => c.cb.checked).map(c => c.name);
      if (selected.length === 0) { overlay.remove(); return; }

      const parsed = parseSpineJson(json);
      for (const animName of selected) {
        const anim = parsed.animations.get(animName);
        if (anim) {
          this.skeleton!.animations.set(animName, anim);
        }
      }
      this.timeline.setSkeleton(this.skeleton!);
      this.aiPanel.refreshAnimList();
      this.syncAnimationsToState();
      this.onStateChange?.();
      this.refreshAnimListUI();
      overlay.remove();
    });
  }

  private saveAsTemplate(): void {
    if (!this.skeleton) return;
    const name = prompt('模板名称:', '自定义角色');
    if (!name) return;
    const json = this.exportSkeletonJson();
    this.templateLib.addSavedTemplate({
      id: `saved-${Date.now()}`, name,
      description: `${this.skeleton.boneOrder.length} 根骨骼`,
      category: 'imported', thumbnail: '💾', skeleton: json,
    });
  }

  exportSkeletonJson(): any {
    const skel = this.skeleton!;
    const bones: any[] = [];
    for (const name of skel.boneOrder) {
      const b = skel.bones.get(name)!;
      const entry: any = { name };
      if (b.parent) entry.parent = b.parent;
      if (b.length) entry.length = b.length;
      if (b.setupRotation) entry.rotation = b.setupRotation;
      if (b.setupX) entry.x = b.setupX;
      if (b.setupY) entry.y = b.setupY;
      if (b.scaleX !== 1) entry.scaleX = b.scaleX;
      if (b.scaleY !== 1) entry.scaleY = b.scaleY;
      bones.push(entry);
    }
    const slots = skel.slots.map(s => ({ name: s.name, bone: s.boneName, ...(s.attachmentName ? { attachment: s.attachmentName } : {}) }));
    const ik = skel.ik.map((k, i) => ({
      name: k.name,
      ...(i > 0 ? { order: i } : {}),
      bones: [...k.boneNames],
      target: k.targetName,
      bendPositive: k.bendPositive,
      ...(k.mix !== 1 ? { mix: k.mix } : {}),
    }));
    const animations: Record<string, any> = {};
    for (const [animName, anim] of skel.animations) {
      const bonesTl: Record<string, any> = {};
      for (const [bn, tl] of Object.entries(anim.boneTimelines)) {
        bonesTl[bn] = {};
        if (tl.rotate) bonesTl[bn].rotate = tl.rotate.map(k => ({ time: k.time, value: k.value }));
        if (tl.translate) bonesTl[bn].translate = tl.translate.map(k => ({ time: k.time, x: k.x, y: k.y }));
      }
      animations[animName] = { bones: bonesTl };
    }

    const skinAttachments: Record<string, Record<string, any>> = {};
    for (const [slotName, atts] of skel.skinAttachments) {
      skinAttachments[slotName] = {};
      for (const [attName, att] of atts) {
        skinAttachments[slotName][attName] = { ...att };
      }
    }
    const hasSkinData = Object.keys(skinAttachments).length > 0;

    return {
      skeleton: { hash: `export-${Date.now()}`, spine: '4.2', width: 200, height: 400 },
      bones, slots, ik,
      skins: [{ name: 'default', ...(hasSkinData ? { attachments: skinAttachments } : {}) }],
      animations,
    };
  }

  private imagesToDataUrls(images: Map<string, HTMLImageElement>): Map<string, string> {
    const result = new Map<string, string>();
    for (const [key, img] of images) {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        result.set(key, c.toDataURL('image/png'));
      } catch { /* skip CORS */ }
    }
    return result;
  }

  private startLoop(): void {
    if (this.animFrame) return;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.centerView.isConnected) { this.animFrame = 0; return; }
      const dt = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;

      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const rw = Math.round(rect.width * dpr);
      const rh = Math.round(rect.height * dpr);
      if (this.canvas.width !== rw || this.canvas.height !== rh) {
        this.canvas.width = rw;
        this.canvas.height = rh;
      }

      this.timeline.tick(dt);
      this.editorState.animationTime = this.timeline.time;
      this.editorState.playing = this.timeline.playing;
      this.editorState.currentAnimation = this.timeline.currentAnimName;

      this.renderer.draw();
      this.timeline.draw();
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = 0; }
  }

  private syncAnimationsToState(): void {
    if (!this.state || !this.skeleton) return;
    if (this.state.bindingSkeleton) {
      this.state.bindingSkeleton.animations = new Map(this.skeleton.animations);
    }
    if (this.state.bindingJson) {
      const animObj: Record<string, RawAnimation> = {};
      for (const [name, anim] of this.skeleton.animations) {
        const bones: Record<string, RawBoneTimeline> = {};
        for (const [boneName, tl] of Object.entries(anim.boneTimelines)) {
          const rawTl: RawBoneTimeline = {};
          if (tl.rotate) rawTl.rotate = tl.rotate.map(k => ({ time: k.time, value: k.value }));
          if (tl.translate) rawTl.translate = tl.translate.map(k => ({ time: k.time, x: k.x, y: k.y }));
          if (tl.scale) rawTl.scale = tl.scale.map(k => ({ time: k.time, x: k.x, y: k.y }));
          if (tl.shear) rawTl.shear = tl.shear.map(k => ({ time: k.time, x: k.x, y: k.y }));
          bones[boneName] = rawTl;
        }
        animObj[name] = { bones };
      }
      this.state.bindingJson.animations = animObj;
    }
  }

  activate(state: StudioState): void {
    this.state = state;

    const ver = state.bindingVersion ?? 0;
    const needsReload = state.bindingJson && (
      !this.skeleton || ver !== this.loadedBindingVersion
    );

    if (needsReload) {
      this.loadSkeleton(state.bindingJson!, 'character');
      if (state.attachmentImages.size > 0) {
        this.loadAttachmentImages(state.attachmentImages);
      }
      this.loadedBindingVersion = ver;
    }

    this.aiPanel.setCharacterConcept(
      state.characterDescription || '',
      state.profession
    );

    this.refreshAnimListUI();
    this.startLoop();
  }

  deactivate(): void {
    this.syncAnimationsToState();
    this.stopLoop();
    this.setRightCollapsed(false);
  }

  dispose(): void {
    this.stopLoop();
    this.setRightCollapsed(false);
    this.workshopBc?.close();
    this.container.remove();
    this.sidePanel.remove();
    this.centerView.remove();
    this.centerToolbar.remove();
    this.bottomPanel.remove();
    this.rightPanel.remove();
  }
}
