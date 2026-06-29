// @source wb-character/src/pipelines/spine/editor/AutoBindTab.ts
import type { StudioState, StudioTab, TabId, PartRegion } from './StudioState';
import type { EditorSkeleton, RawSpineJson } from './types';
import { BindingPanel } from './BindingPanel';
import { parseSpineJson, computeWorldTransforms, applyIKConstraints } from './SpineDataParser';
import { spineIcon, spineBtnLabel } from './spine-icons';

const PART_DEFS: { id: string; name: string; cx: number; cy: number; sizeHint: 'large' | 'medium' | 'small'; color: string }[] = [
  { id: 'head',        name: '头',     cx: 0.50, cy: 0.08, sizeHint: 'large',  color: '#ff6b6b' },
  { id: 'chest',       name: '胸部',   cx: 0.50, cy: 0.22, sizeHint: 'large',  color: '#ffa94d' },
  { id: 'waist',       name: '腰部',   cx: 0.50, cy: 0.38, sizeHint: 'medium', color: '#ff922b' },
  { id: 'upperarm_l',  name: '左大臂', cx: 0.25, cy: 0.32, sizeHint: 'small',  color: '#74c0fc' },
  { id: 'forearm_l',   name: '左小臂', cx: 0.22, cy: 0.46, sizeHint: 'small',  color: '#4dabf7' },
  { id: 'hand_l',      name: '左手',   cx: 0.18, cy: 0.56, sizeHint: 'small',  color: '#339af0' },
  { id: 'upperarm_r',  name: '右大臂', cx: 0.75, cy: 0.32, sizeHint: 'small',  color: '#63e6be' },
  { id: 'forearm_r',   name: '右小臂', cx: 0.78, cy: 0.46, sizeHint: 'small',  color: '#38d9a9' },
  { id: 'hand_r',      name: '右手',   cx: 0.82, cy: 0.56, sizeHint: 'small',  color: '#20c997' },
  { id: 'thigh_l',     name: '左大腿', cx: 0.35, cy: 0.58, sizeHint: 'small',  color: '#b197fc' },
  { id: 'calf_l',      name: '左小腿', cx: 0.30, cy: 0.72, sizeHint: 'small',  color: '#9775fa' },
  { id: 'foot_l',      name: '左脚',   cx: 0.30, cy: 0.86, sizeHint: 'small',  color: '#845ef7' },
  { id: 'thigh_r',     name: '右大腿', cx: 0.65, cy: 0.58, sizeHint: 'small',  color: '#fcc2d7' },
  { id: 'calf_r',      name: '右小腿', cx: 0.70, cy: 0.72, sizeHint: 'small',  color: '#f783ac' },
  { id: 'foot_r',      name: '右脚',   cx: 0.70, cy: 0.86, sizeHint: 'small',  color: '#e64980' },
  { id: 'weapon',      name: '武器',   cx: 0.12, cy: 0.50, sizeHint: 'medium', color: '#ffe066' },
];

const PART_IDS = PART_DEFS.map(p => p.id);
const PART_NAMES = PART_DEFS.map(p => p.name);

interface PartAdjustment {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
}

const DEFAULT_DRAW_ORDER = [
  'hand_r', 'forearm_r', 'upperarm_r',
  'foot_r', 'calf_r', 'thigh_r',
  'foot_l', 'calf_l', 'thigh_l',
  'waist', 'chest', 'head', 'weapon',
  'upperarm_l', 'forearm_l', 'hand_l',
];

export class AutoBindTab implements StudioTab {
  readonly id: TabId = 'bind';
  readonly container: HTMLDivElement;
  readonly sidePanel: HTMLDivElement;
  readonly centerView: HTMLDivElement;
  readonly centerToolbar: HTMLDivElement;
  readonly bottomPanel = null;
  readonly rightPanel = null;

  private state: StudioState | null = null;
  private onStateChange: (() => void) | null = null;
  private bindingPanel!: BindingPanel;
  private mode: 'auto' | 'manual' = 'auto';

  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private previewSkeleton: EditorSkeleton | null = null;
  private previewImages = new Map<string, HTMLImageElement>();
  private partAdjustments = new Map<string, PartAdjustment>();
  private selectedPart: string | null = null;
  private previewZoom = 2.5;
  private previewPanX = 0;
  private previewPanY = 0;
  private animFrame = 0;

  private dragState: { startX: number; startY: number; origOx: number; origOy: number } | null = null;
  private panDrag: { startX: number; startY: number; origPx: number; origPy: number } | null = null;
  private rotateDrag: { startAngle: number; origRot: number } | null = null;
  private scaleDrag: { startDist: number; origScale: number; corner: number } | null = null;

  private swapSource: string | null = null;
  private advancedOpen = false;
  private drawOrder: string[] = [...DEFAULT_DRAW_ORDER];
  private editMode: 'image' | 'bone' = 'image';
  private selectedBone: string | null = null;
  private boneDrag: { boneName: string; startX: number; startY: number; origRot: number } | null = null;
  private bindBc: BroadcastChannel | null = null;
  private bindBcSelfId = Math.random().toString(36).slice(2, 10);
  private draggingLayerId: string | null = null;

  private partScreenCache = new Map<string, {
    screenX: number; screenY: number;
    rotation: number; halfW: number; halfH: number;
  }>();
  private boneScreenCache = new Map<string, { sx: number; sy: number }>();
  private handleSize = 7;
  private rotHandleOffset = 20;

  constructor(parent: HTMLElement, onStateChange: () => void) {
    this.onStateChange = onStateChange;
    this.container = document.createElement('div');
    this.container.className = 'studio-tab-content';
    parent.appendChild(this.container);

    this.sidePanel = document.createElement('div');
    this.sidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    this.centerView = document.createElement('div');
    this.centerView.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;';

    this.centerToolbar = document.createElement('div');
    this.centerToolbar.className = 'ab-toolbar';

    this.buildUI();
    this.setupBindingSync();
  }

  private q(selector: string): HTMLElement | null {
    return this.sidePanel.querySelector(selector) ?? this.centerView.querySelector(selector) ?? this.centerToolbar.querySelector(selector) ?? null;
  }

  private setupBindingSync(): void {
    try {
      this.bindBc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-anim.spine-binding');
    } catch {
      this.bindBc = null;
      return;
    }
    this.bindBc.onmessage = (e: MessageEvent) => {
      const data = e.data as {
        type?: string;
        from?: string;
        bindingJson?: RawSpineJson;
        cropImages?: [string, string][];
      } | null;
      if (!data || data.from === this.bindBcSelfId || data.type !== 'spine-binding-complete') return;
      if (!data.bindingJson || !Array.isArray(data.cropImages)) return;
      this.applyBindingResult(data.bindingJson, new Map(data.cropImages), false);
    };
  }

  private broadcastBindingResult(bindingJson: RawSpineJson, cropImages: Map<string, string>): void {
    if (!this.bindBc) return;
    try {
      this.bindBc.postMessage({
        type: 'spine-binding-complete',
        from: this.bindBcSelfId,
        bindingJson,
        cropImages: Array.from(cropImages.entries()),
      });
    } catch (e) {
      console.warn('[Spine] broadcast binding result failed:', e);
    }
  }

  private buildUI(): void {
    this.sidePanel.innerHTML = `
      <div class="ab-mode-bar">
        <button class="ab-mode-btn active" data-mode="auto">自动</button>
        <button class="ab-mode-btn" data-mode="manual">手动</button>
      </div>

      <div class="ab-auto-sidebar" id="ab-auto-sidebar">
        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">操作</div>
          <div class="ab-sidebar-actions">
            <button class="ab-sidebar-btn ab-btn-primary" id="ab-run-auto" disabled>一键自动绑骨</button>
            <button class="ab-sidebar-btn" id="ab-upload-expl">上传爆炸图</button>
          </div>
          <div class="ab-auto-status" id="ab-auto-status">请先生成或上传拆件图</div>
        </div>

        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">部件列表 <span class="ab-part-count" id="ab-part-count"></span></div>
          <div class="ab-parts-list" id="ab-parts-list"></div>
        </div>

        <div class="ab-sidebar-section ab-advanced-section">
          <div class="ab-advanced-toggle" id="ab-advanced-toggle">
            <span class="ab-advanced-arrow" id="ab-advanced-arrow">▶</span>
            高级设置
          </div>
          <div class="ab-advanced-panel" id="ab-advanced-panel" style="display:none">
            <div class="ab-adv-row">
              <label>偏移 X</label>
              <input type="number" class="ab-adv-input" id="ab-adj-ox" step="1" value="0">
            </div>
            <div class="ab-adv-row">
              <label>偏移 Y</label>
              <input type="number" class="ab-adv-input" id="ab-adj-oy" step="1" value="0">
            </div>
            <div class="ab-adv-row">
              <label>缩放</label>
              <input type="number" class="ab-adv-input" id="ab-adj-scale" step="0.05" value="1" min="0.1" max="5">
            </div>
            <div class="ab-adv-row">
              <label>旋转°</label>
              <input type="number" class="ab-adv-input" id="ab-adj-rot" step="5" value="0">
            </div>
            <div class="ab-adv-actions">
              <button class="ab-sidebar-btn ab-btn-sm" id="ab-adj-reset">归零</button>
              <button class="ab-sidebar-btn ab-btn-sm" id="ab-adj-apply-all">应用到全部</button>
            </div>
          </div>
        </div>

        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">图层顺序 <span class="ab-layer-hint">(上=前)</span></div>
          <div class="ab-layer-list" id="ab-layer-list"></div>
        </div>
      </div>

      <div class="ab-manual-sidebar" id="ab-manual-sidebar" style="display:none">
        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">手动绑骨说明</div>
          <div class="ab-manual-help">
            <div>1. 在右侧画布中上传或使用当前拆件图。</div>
            <div>2. 左键框选部件，右键可打开操作菜单。</div>
            <div>3. 全部部件确认后点击右下角完成。</div>
          </div>
        </div>
        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">快捷操作</div>
          <div class="ab-sidebar-actions">
            <button class="ab-sidebar-btn" id="ab-manual-upload">上传爆炸图</button>
            <button class="ab-sidebar-btn" id="ab-manual-load-current">使用当前拆件图</button>
            <button class="ab-sidebar-btn" id="ab-manual-back-auto">返回自动模式</button>
          </div>
        </div>
        <div class="ab-sidebar-section">
          <div class="ab-sidebar-title">提示</div>
          <div class="ab-manual-help muted">手动工具区在右侧画布内，左侧只保留说明和快捷入口。</div>
        </div>
      </div>

      <div class="studio-next-float ab-next-float">
        <button class="studio-next-btn" id="ab-confirm" disabled>确认 → 动作工坊</button>
      </div>
    `;

    this.centerView.innerHTML = `
      <div class="ab-preview-wrap" id="ab-preview-wrap">
        <canvas class="ab-preview-canvas" id="ab-preview-canvas"></canvas>
        <div class="ab-edit-mode-bar" id="ab-edit-mode-bar">
          <button class="ab-edit-mode-btn active" data-emode="image" title="编辑图像：选中/移动/缩放/旋转附件图片">${spineBtnLabel('image', '图像')}</button>
          <button class="ab-edit-mode-btn" data-emode="bone" title="编辑骨骼：选中/旋转/移动骨骼节点">${spineBtnLabel('bone', '骨骼')}</button>
        </div>
        <div class="ab-preview-empty" id="ab-preview-empty">
          <div class="ab-preview-empty-icon">${spineIcon('bone')}</div>
          <div>上传爆炸图后点击「一键自动绑骨」</div>
          <div class="ab-preview-empty-sub">绑骨后可在此预览并调整部件位置</div>
        </div>
      </div>
      <div class="ab-manual-panel" id="ab-manual-panel" style="display:none"></div>
    `;

    this.centerToolbar.innerHTML = `
      <span class="ab-status" id="ab-status">等待图像...</span>
      <span class="ab-toolbar-sep"></span>
      <span class="ab-toolbar-hint" id="ab-toolbar-hint">滚轮缩放，按住空白区域左键拖动画布</span>
    `;

    this.previewCanvas = this.q('#ab-preview-canvas') as HTMLCanvasElement;
    this.previewCtx = this.previewCanvas.getContext('2d')!;

    const manualArea = this.q('#ab-manual-panel') as HTMLElement;
    this.bindingPanel = new BindingPanel(manualArea);

    this.bindingPanel.onAutoBindComplete = (_skel, json, cropImages) => {
      this.applyBindingResult(json, cropImages, true);
    };

    this.sidePanel.querySelectorAll('.ab-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sidePanel.querySelectorAll('.ab-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.switchMode((btn as HTMLElement).dataset.mode as 'auto' | 'manual');
      });
    });

    this.q('#ab-run-auto')?.addEventListener('click', () => this.runAutoBind());
    this.q('#ab-upload-expl')?.addEventListener('click', () => this.uploadExplosion());
    this.q('#ab-manual-upload')?.addEventListener('click', () => this.uploadExplosion());
    this.q('#ab-manual-load-current')?.addEventListener('click', () => this.loadCurrentImageIntoManualPanel());
    this.q('#ab-manual-back-auto')?.addEventListener('click', () => this.switchMode('auto'));
    this.q('#ab-confirm')?.addEventListener('click', () => this.confirm());

    this.centerView.querySelectorAll('.ab-edit-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.centerView.querySelectorAll('.ab-edit-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setEditMode((btn as HTMLElement).dataset.emode as 'image' | 'bone');
      });
    });

    this.q('#ab-advanced-toggle')?.addEventListener('click', () => {
      this.advancedOpen = !this.advancedOpen;
      const panel = this.q('#ab-advanced-panel') as HTMLElement;
      const arrow = this.q('#ab-advanced-arrow') as HTMLElement;
      panel.style.display = this.advancedOpen ? 'flex' : 'none';
      arrow.textContent = this.advancedOpen ? '▼' : '▶';
    });

    this.q('#ab-adj-ox')?.addEventListener('input', (e) => this.onAdvancedInput('x', e));
    this.q('#ab-adj-oy')?.addEventListener('input', (e) => this.onAdvancedInput('y', e));
    this.q('#ab-adj-scale')?.addEventListener('input', (e) => this.onAdvancedInput('scale', e));
    this.q('#ab-adj-rot')?.addEventListener('input', (e) => this.onAdvancedInput('rotation', e));
    this.q('#ab-adj-reset')?.addEventListener('click', () => this.resetAdjustment());
    this.q('#ab-adj-apply-all')?.addEventListener('click', () => this.applyToAll());

    this.setupPreviewInteraction();

    new ResizeObserver(() => this.resizePreview()).observe(
      this.q('#ab-preview-wrap') as HTMLElement
    );
  }

  private canvasMousePos(e: MouseEvent): { mx: number; my: number } {
    const cvs = this.previewCanvas!;
    const rect = cvs.getBoundingClientRect();
    return {
      mx: (e.clientX - rect.left),
      my: (e.clientY - rect.top),
    };
  }

  private hitTestHandles(mx: number, my: number): 'rotate' | 'scale' | null {
    if (!this.selectedPart) return null;
    const sc = this.partScreenCache.get(this.selectedPart);
    if (!sc) return null;

    const { screenX: sx, screenY: sy, rotation: rot, halfW: hw, halfH: hh } = sc;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const lx = (mx - sx) * cos - (my - sy) * sin;
    const ly = (mx - sx) * sin + (my - sy) * cos;
    const hs = this.handleSize;

    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [cx, cy] of corners) {
      if (Math.abs(lx - cx) < hs + 2 && Math.abs(ly - cy) < hs + 2) return 'scale';
    }

    const rotDist = Math.sqrt((lx - 0) ** 2 + (ly - (-hh - this.rotHandleOffset)) ** 2);
    if (rotDist < hs + 4) return 'rotate';

    return null;
  }

  private hitTestParts(mx: number, my: number): string | null {
    const orderedParts = this.drawOrder.filter(id => this.previewImages.has(id));
    for (const id of this.previewImages.keys()) {
      if (!orderedParts.includes(id)) orderedParts.unshift(id);
    }

    for (let i = orderedParts.length - 1; i >= 0; i--) {
      const partId = orderedParts[i];
      const sc = this.partScreenCache.get(partId);
      if (!sc) continue;
      const { screenX: sx, screenY: sy, rotation: rot, halfW: hw, halfH: hh } = sc;
      const cos = Math.cos(-rot), sin = Math.sin(-rot);
      const lx = (mx - sx) * cos - (my - sy) * sin;
      const ly = (mx - sx) * sin + (my - sy) * cos;
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return partId;
    }
    return null;
  }

  private setupPreviewInteraction(): void {
    const cvs = this.previewCanvas!;

    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.selectedPart && e.ctrlKey) {
        const adj = this.getAdj(this.selectedPart);
        adj.scale = Math.max(0.1, Math.min(5, adj.scale + (e.deltaY < 0 ? 0.05 : -0.05)));
        this.partAdjustments.set(this.selectedPart, adj);
        this.syncAdvancedInputs();
        this.buildPartsList();
        return;
      }
      const { mx, my } = this.canvasMousePos(e);
      const dpr = window.devicePixelRatio || 1;
      const W = cvs.width / dpr, H = cvs.height / dpr;
      const cx = W / 2 + this.previewPanX;
      const cy = H / 2 + this.previewPanY;
      const worldX = (mx - cx) / this.previewZoom;
      const worldY = (my - cy) / this.previewZoom;
      const oldZoom = this.previewZoom;
      this.previewZoom = Math.max(0.3, Math.min(20, oldZoom * (e.deltaY < 0 ? 1.12 : 0.88)));
      this.previewPanX += worldX * (oldZoom - this.previewZoom);
      this.previewPanY += worldY * (oldZoom - this.previewZoom);
    }, { passive: false });

    cvs.addEventListener('contextmenu', (e) => e.preventDefault());

    cvs.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
        this.panDrag = { startX: e.clientX, startY: e.clientY, origPx: this.previewPanX, origPy: this.previewPanY };
        cvs.style.cursor = 'grabbing';
        return;
      }
      if (e.button !== 0) return;
      const { mx, my } = this.canvasMousePos(e);

      if (this.editMode === 'image') {
        if (this.selectedPart) {
          const handle = this.hitTestHandles(mx, my);
          if (handle === 'rotate') {
            const sc = this.partScreenCache.get(this.selectedPart)!;
            const startAngle = Math.atan2(my - sc.screenY, mx - sc.screenX);
            const adj = this.getAdj(this.selectedPart);
            this.rotateDrag = { startAngle, origRot: adj.rotation };
            cvs.style.cursor = 'crosshair';
            return;
          }
          if (handle === 'scale') {
            const sc = this.partScreenCache.get(this.selectedPart)!;
            const dist = Math.sqrt((mx - sc.screenX) ** 2 + (my - sc.screenY) ** 2);
            const adj = this.getAdj(this.selectedPart);
            this.scaleDrag = { startDist: dist, origScale: adj.scale, corner: 0 };
            cvs.style.cursor = 'nwse-resize';
            return;
          }
        }
        const hitPart = this.hitTestParts(mx, my);
        if (hitPart) {
          this.selectPart(hitPart);
          const adj = this.getAdj(hitPart);
          this.dragState = { startX: e.clientX, startY: e.clientY, origOx: adj.offsetX, origOy: adj.offsetY };
          cvs.style.cursor = 'move';
        } else {
          this.selectPart(null);
          this.panDrag = { startX: e.clientX, startY: e.clientY, origPx: this.previewPanX, origPy: this.previewPanY };
          cvs.style.cursor = 'grabbing';
        }
      } else {
        const hitBone = this.hitTestBones(mx, my);
        if (hitBone) {
          this.selectBone(hitBone);
          const bone = this.previewSkeleton?.bones.get(hitBone);
          if (bone) {
            this.boneDrag = {
              boneName: hitBone,
              startX: mx, startY: my,
              origRot: bone.localRotation,
            };
          }
          cvs.style.cursor = 'crosshair';
        } else {
          this.selectBone(null);
          this.panDrag = { startX: e.clientX, startY: e.clientY, origPx: this.previewPanX, origPy: this.previewPanY };
          cvs.style.cursor = 'grabbing';
        }
      }
    });

    const onMove = (e: MouseEvent) => {
      if (this.panDrag) {
        this.previewPanX = this.panDrag.origPx + (e.clientX - this.panDrag.startX);
        this.previewPanY = this.panDrag.origPy + (e.clientY - this.panDrag.startY);
        return;
      }

      if (this.editMode === 'image') {
        if (this.rotateDrag && this.selectedPart) {
          const sc = this.partScreenCache.get(this.selectedPart);
          if (sc) {
            const { mx, my } = this.canvasMousePos(e);
            const angle = Math.atan2(my - sc.screenY, mx - sc.screenX);
            let delta = (angle - this.rotateDrag.startAngle) * 180 / Math.PI;
            if (e.shiftKey) delta = Math.round(delta / 15) * 15;
            const adj = this.getAdj(this.selectedPart);
            adj.rotation = this.rotateDrag.origRot - delta;
            this.partAdjustments.set(this.selectedPart, adj);
            this.syncAdvancedInputs();
            this.buildPartsList();
          }
          return;
        }
        if (this.scaleDrag && this.selectedPart) {
          const sc = this.partScreenCache.get(this.selectedPart);
          if (sc) {
            const { mx, my } = this.canvasMousePos(e);
            const dist = Math.sqrt((mx - sc.screenX) ** 2 + (my - sc.screenY) ** 2);
            const ratio = dist / Math.max(this.scaleDrag.startDist, 1);
            const adj = this.getAdj(this.selectedPart);
            adj.scale = Math.max(0.1, Math.min(5, this.scaleDrag.origScale * ratio));
            this.partAdjustments.set(this.selectedPart, adj);
            this.syncAdvancedInputs();
            this.buildPartsList();
          }
          return;
        }
        if (this.dragState && this.selectedPart) {
          const sc = this.previewZoom;
          const dx = (e.clientX - this.dragState.startX) / sc;
          const dy = -(e.clientY - this.dragState.startY) / sc;
          const adj = this.getAdj(this.selectedPart);
          adj.offsetX = this.dragState.origOx + dx;
          adj.offsetY = this.dragState.origOy + dy;
          this.partAdjustments.set(this.selectedPart, adj);
          this.syncAdvancedInputs();
          this.buildPartsList();
          return;
        }
        if (!this.dragState && !this.rotateDrag && !this.scaleDrag) {
          const { mx, my } = this.canvasMousePos(e);
          if (this.selectedPart) {
            const handle = this.hitTestHandles(mx, my);
            if (handle === 'rotate') { cvs.style.cursor = 'crosshair'; return; }
            if (handle === 'scale') { cvs.style.cursor = 'nwse-resize'; return; }
          }
          const hover = this.hitTestParts(mx, my);
          cvs.style.cursor = hover ? 'pointer' : 'grab';
        }
      } else {
        if (this.boneDrag && this.previewSkeleton) {
          const { mx, my } = this.canvasMousePos(e);
          const bone = this.previewSkeleton.bones.get(this.boneDrag.boneName);
          if (bone) {
            const parent = bone.parent ? this.previewSkeleton.bones.get(bone.parent) : null;
            const pivotX = parent ? parent.worldX : 0;
            const pivotY = parent ? parent.worldY : 0;
            const z = this.previewZoom;
            const dpr = window.devicePixelRatio || 1;
            const W = this.previewCanvas!.width / dpr;
            const H = this.previewCanvas!.height / dpr;
            const cx = W / 2 + this.previewPanX;
            const cy = H / 2 + this.previewPanY;
            const psx = cx + pivotX * z;
            const psy = cy - pivotY * z;

            const startAngle = Math.atan2(-(this.boneDrag.startY - psy), this.boneDrag.startX - psx);
            const curAngle = Math.atan2(-(my - psy), mx - psx);
            let delta = (curAngle - startAngle) * 180 / Math.PI;
            if (e.shiftKey) delta = Math.round(delta / 5) * 5;

            bone.localRotation = this.boneDrag.origRot + delta;
            computeWorldTransforms(this.previewSkeleton.bones, this.previewSkeleton.boneOrder);
            if (this.previewSkeleton.ik.length > 0) {
              applyIKConstraints(this.previewSkeleton.bones, this.previewSkeleton.boneOrder, this.previewSkeleton.ik);
            }
          }
          return;
        }
        if (!this.boneDrag) {
          const { mx, my } = this.canvasMousePos(e);
          const hover = this.hitTestBones(mx, my);
          cvs.style.cursor = hover ? 'pointer' : 'grab';
        }
      }
    };

    const onUp = () => {
      this.dragState = null;
      this.panDrag = null;
      this.rotateDrag = null;
      this.scaleDrag = null;
      this.boneDrag = null;
      if (this.editMode === 'image') {
        cvs.style.cursor = this.selectedPart ? 'move' : 'grab';
      } else {
        cvs.style.cursor = this.selectedBone ? 'crosshair' : 'grab';
      }
    };

    this.centerView.addEventListener('mousemove', onMove);
    this.centerView.addEventListener('mouseup', onUp);
  }

  private hitTestBones(mx: number, my: number): string | null {
    const hitRadius = 8;
    let closest: string | null = null;
    let closestDist = hitRadius;
    for (const [name, pos] of this.boneScreenCache) {
      const d = Math.sqrt((mx - pos.sx) ** 2 + (my - pos.sy) ** 2);
      if (d < closestDist) {
        closestDist = d;
        closest = name;
      }
    }
    return closest;
  }

  private getAdj(partId: string): PartAdjustment {
    return this.partAdjustments.get(partId) ?? { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 };
  }

  private onAdvancedInput(field: 'x' | 'y' | 'scale' | 'rotation', e: Event): void {
    if (!this.selectedPart) return;
    const val = parseFloat((e.target as HTMLInputElement).value) || 0;
    const adj = this.getAdj(this.selectedPart);
    if (field === 'x') adj.offsetX = val;
    else if (field === 'y') adj.offsetY = val;
    else if (field === 'scale') adj.scale = Math.max(0.1, Math.min(5, val));
    else adj.rotation = val;
    this.partAdjustments.set(this.selectedPart, adj);
    this.buildPartsList();
  }

  private syncAdvancedInputs(): void {
    if (!this.selectedPart) return;
    const adj = this.getAdj(this.selectedPart);
    (this.q('#ab-adj-ox') as HTMLInputElement).value = adj.offsetX.toFixed(1);
    (this.q('#ab-adj-oy') as HTMLInputElement).value = adj.offsetY.toFixed(1);
    (this.q('#ab-adj-scale') as HTMLInputElement).value = adj.scale.toFixed(2);
    (this.q('#ab-adj-rot') as HTMLInputElement).value = adj.rotation.toFixed(1);
  }

  private resetAdjustment(): void {
    if (!this.selectedPart) return;
    this.partAdjustments.set(this.selectedPart, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 });
    this.syncAdvancedInputs();
    this.buildPartsList();
  }

  private applyToAll(): void {
    if (!this.selectedPart) return;
    const adj = this.getAdj(this.selectedPart);
    for (const def of PART_DEFS) {
      if (this.previewImages.has(def.id)) {
        this.partAdjustments.set(def.id, { ...adj });
      }
    }
    this.buildPartsList();
  }

  private setEditMode(mode: 'image' | 'bone'): void {
    this.editMode = mode;
    this.selectedPart = null;
    this.selectedBone = null;
    this.dragState = null;
    this.rotateDrag = null;
    this.scaleDrag = null;
    this.boneDrag = null;
    const hint = this.q('#ab-toolbar-hint') as HTMLElement;
    if (mode === 'image') {
      hint.textContent = '点击图片选中部件 · 空白处拖动画布 · 滚轮缩放视图';
    } else {
      hint.textContent = '点击骨骼节点选中 · 空白处拖动画布 · 滚轮缩放视图';
    }
    this.previewCanvas!.style.cursor = 'grab';
    this.buildPartsList();
  }

  private selectPart(partId: string | null): void {
    this.selectedPart = partId;
    this.selectedBone = null;
    this.swapSource = null;
    this.buildPartsList();
    this.syncAdvancedInputs();
    const hint = this.q('#ab-toolbar-hint') as HTMLElement;
    if (partId) {
      const def = PART_DEFS.find(p => p.id === partId);
      hint.textContent = `「${def?.name}」· 拖拽移动 · 角落缩放 · 绿圆旋转 · Shift吸附15°`;
      this.previewCanvas!.style.cursor = 'move';
    } else {
      hint.textContent = '点击图片选中部件 · 空白处拖动画布 · 滚轮缩放视图';
      this.previewCanvas!.style.cursor = 'grab';
    }
  }

  private selectBone(boneName: string | null): void {
    this.selectedBone = boneName;
    this.selectedPart = null;
    const hint = this.q('#ab-toolbar-hint') as HTMLElement;
    if (boneName) {
      hint.textContent = `骨骼「${boneName}」· 拖拽旋转 · 空白处拖动画布`;
      this.previewCanvas!.style.cursor = 'crosshair';
    } else {
      hint.textContent = '点击骨骼节点选中 · 空白处拖动画布 · 滚轮缩放视图';
      this.previewCanvas!.style.cursor = 'grab';
    }
  }

  private startSwap(partId: string): void {
    this.swapSource = partId;
    this.buildPartsList();
    const def = PART_DEFS.find(p => p.id === partId);
    this.showStatus(`选择要与「${def?.name}」交换的部件...`);
  }

  private executeSwap(targetId: string): void {
    if (!this.swapSource || this.swapSource === targetId) {
      this.swapSource = null;
      this.buildPartsList();
      return;
    }
    const imgA = this.previewImages.get(this.swapSource);
    const imgB = this.previewImages.get(targetId);
    if (imgA && imgB) {
      this.previewImages.set(this.swapSource, imgB);
      this.previewImages.set(targetId, imgA);
    } else if (imgA) {
      this.previewImages.set(targetId, imgA);
      this.previewImages.delete(this.swapSource);
    } else if (imgB) {
      this.previewImages.set(this.swapSource, imgB);
      this.previewImages.delete(targetId);
    }

    const adjA = this.getAdj(this.swapSource);
    const adjB = this.getAdj(targetId);
    this.partAdjustments.set(this.swapSource, adjB);
    this.partAdjustments.set(targetId, adjA);

    if (this.state) {
      const imgDataA = this.state.attachmentImages.get(this.swapSource);
      const imgDataB = this.state.attachmentImages.get(targetId);
      if (imgDataA) this.state.attachmentImages.set(targetId, imgDataA);
      if (imgDataB) this.state.attachmentImages.set(this.swapSource, imgDataB);
      if (!imgDataA) this.state.attachmentImages.delete(targetId);
      if (!imgDataB) this.state.attachmentImages.delete(this.swapSource);
    }

    const srcDef = PART_DEFS.find(p => p.id === this.swapSource);
    const tgtDef = PART_DEFS.find(p => p.id === targetId);
    this.showStatus(`已交换「${srcDef?.name}」↔「${tgtDef?.name}」`);
    this.swapSource = null;
    this.buildPartsList();
  }

  private buildPartsList(): void {
    const list = this.q('#ab-parts-list') as HTMLElement;
    if (!list) return;

    const count = this.q('#ab-part-count') as HTMLElement;
    if (count) count.textContent = `${this.previewImages.size}/${PART_DEFS.length}`;

    list.innerHTML = '';
    for (const def of PART_DEFS) {
      const hasImg = this.previewImages.has(def.id);
      const isSelected = this.selectedPart === def.id;
      const isSwapSource = this.swapSource === def.id;
      const isSwapTarget = this.swapSource && this.swapSource !== def.id;
      const adj = this.getAdj(def.id);

      const row = document.createElement('div');
      row.className = 'ab-part-row' + (isSelected ? ' selected' : '') + (isSwapSource ? ' swap-source' : '') + (!hasImg ? ' empty' : '');

      const dot = document.createElement('span');
      dot.className = 'ab-part-dot';
      dot.style.background = hasImg ? def.color : 'rgba(100,100,100,0.3)';
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'ab-part-label';
      name.textContent = def.name;
      row.appendChild(name);

      if (hasImg && (adj.offsetX !== 0 || adj.offsetY !== 0 || adj.scale !== 1 || adj.rotation !== 0)) {
        const info = document.createElement('span');
        info.className = 'ab-part-adj-info';
        let txt = `${adj.offsetX.toFixed(0)},${adj.offsetY.toFixed(0)}`;
        if (adj.scale !== 1) txt += ` ×${adj.scale.toFixed(1)}`;
        if (adj.rotation !== 0) txt += ` ${adj.rotation.toFixed(0)}°`;
        info.textContent = txt;
        row.appendChild(info);
      }

      const btns = document.createElement('span');
      btns.className = 'ab-part-btns';

      if (isSwapTarget && hasImg) {
        const swapBtn = document.createElement('button');
        swapBtn.className = 'ab-part-action swap-target';
        swapBtn.textContent = '↔';
        swapBtn.title = '交换到此';
        swapBtn.addEventListener('click', (e) => { e.stopPropagation(); this.executeSwap(def.id); });
        btns.appendChild(swapBtn);
      } else if (hasImg && !this.swapSource) {
        const swapBtn = document.createElement('button');
        swapBtn.className = 'ab-part-action';
        swapBtn.textContent = '↔';
        swapBtn.title = '交换部件';
        swapBtn.addEventListener('click', (e) => { e.stopPropagation(); this.startSwap(def.id); });
        btns.appendChild(swapBtn);
      }

      row.appendChild(btns);

      row.addEventListener('click', () => {
        if (this.swapSource) {
          this.executeSwap(def.id);
        } else {
          this.selectPart(isSelected ? null : def.id);
        }
      });

      list.appendChild(row);
    }
    this.buildLayerList();
  }

  private buildLayerList(): void {
    const list = this.q('#ab-layer-list') as HTMLElement;
    if (!list) return;
    list.innerHTML = '';

    const activeParts = this.drawOrder.filter(id => this.previewImages.has(id));
    for (const id of this.previewImages.keys()) {
      if (!activeParts.includes(id)) activeParts.push(id);
    }
    const reversed = [...activeParts].reverse();

    for (let i = 0; i < reversed.length; i++) {
      const partId = reversed[i];
      const def = PART_DEFS.find(p => p.id === partId);
      if (!def) continue;

      const row = document.createElement('div');
      row.className = 'ab-layer-row' + (this.selectedPart === partId ? ' selected' : '');
      row.draggable = true;
      row.dataset.partId = partId;

      const dot = document.createElement('span');
      dot.className = 'ab-layer-dot';
      dot.style.background = def.color;
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'ab-layer-name';
      name.textContent = def.name;
      row.appendChild(name);

      const idx = document.createElement('span');
      idx.className = 'ab-layer-idx';
      idx.textContent = `${reversed.length - i}`;
      row.appendChild(idx);

      const grip = document.createElement('span');
      grip.className = 'ab-layer-grip';
      grip.textContent = '⋮⋮';
      grip.title = '拖拽调整图层顺序';
      row.appendChild(grip);

      const btns = document.createElement('span');
      btns.className = 'ab-layer-btns';

      const upBtn = document.createElement('button');
      upBtn.className = 'ab-layer-btn';
      upBtn.textContent = '▲';
      upBtn.title = '上移一层（更靠前）';
      upBtn.disabled = i === 0;
      upBtn.draggable = false;
      upBtn.addEventListener('click', (e) => { e.stopPropagation(); this.moveLayer(partId, 'up'); });
      btns.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.className = 'ab-layer-btn';
      downBtn.textContent = '▼';
      downBtn.title = '下移一层（更靠后）';
      downBtn.disabled = i === reversed.length - 1;
      downBtn.draggable = false;
      downBtn.addEventListener('click', (e) => { e.stopPropagation(); this.moveLayer(partId, 'down'); });
      btns.appendChild(downBtn);

      row.appendChild(btns);

      row.addEventListener('dragstart', (e) => {
        this.draggingLayerId = partId;
        row.classList.add('dragging');
        e.dataTransfer?.setData('text/plain', partId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        if (!this.draggingLayerId || this.draggingLayerId === partId) return;
        e.preventDefault();
        row.classList.add('drop-target');
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-target');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const sourceId = this.draggingLayerId || e.dataTransfer?.getData('text/plain') || '';
        this.reorderLayer(sourceId, partId);
      });
      row.addEventListener('dragend', () => {
        this.draggingLayerId = null;
        list.querySelectorAll('.ab-layer-row').forEach(el => el.classList.remove('dragging', 'drop-target'));
      });

      row.addEventListener('click', () => {
        this.selectPart(this.selectedPart === partId ? null : partId);
      });

      list.appendChild(row);
    }
  }

  private reorderLayer(sourceId: string, targetId: string): void {
    if (!sourceId || sourceId === targetId) return;
    const activeParts = this.drawOrder.filter(id => this.previewImages.has(id));
    for (const id of this.previewImages.keys()) {
      if (!activeParts.includes(id)) activeParts.push(id);
    }
    const topToBottom = [...activeParts].reverse();
    const from = topToBottom.indexOf(sourceId);
    const to = topToBottom.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = topToBottom.splice(from, 1);
    topToBottom.splice(to, 0, moved);
    const nextActiveOrder = [...topToBottom].reverse();
    const inactive = this.drawOrder.filter(id => !activeParts.includes(id));
    this.drawOrder = [...inactive, ...nextActiveOrder];
    this.buildLayerList();
    this.showStatus('已调整图层顺序');
  }

  private moveLayer(partId: string, direction: 'up' | 'down'): void {
    const idx = this.drawOrder.indexOf(partId);
    if (idx === -1) return;

    if (direction === 'up') {
      if (idx >= this.drawOrder.length - 1) return;
      [this.drawOrder[idx], this.drawOrder[idx + 1]] = [this.drawOrder[idx + 1], this.drawOrder[idx]];
    } else {
      if (idx <= 0) return;
      [this.drawOrder[idx], this.drawOrder[idx - 1]] = [this.drawOrder[idx - 1], this.drawOrder[idx]];
    }
    this.buildLayerList();
    this.showStatus('已调整图层顺序');
  }

  private switchMode(mode: 'auto' | 'manual'): void {
    this.mode = mode;
    this.sidePanel.querySelectorAll('.ab-mode-btn').forEach(btn => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === mode);
    });
    const sidebar = this.q('#ab-auto-sidebar') as HTMLElement;
    const manualSidebar = this.q('#ab-manual-sidebar') as HTMLElement;
    const previewWrap = this.q('#ab-preview-wrap') as HTMLElement;
    const manualPanel = this.q('#ab-manual-panel') as HTMLElement;

    if (mode === 'auto') {
      sidebar.style.display = 'flex';
      manualSidebar.style.display = 'none';
      previewWrap.style.display = 'flex';
      this.centerToolbar.style.display = 'flex';
      manualPanel.style.display = 'none';
    } else {
      sidebar.style.display = 'none';
      manualSidebar.style.display = 'flex';
      previewWrap.style.display = 'none';
      this.centerToolbar.style.display = 'none';
      manualPanel.style.display = 'block';
      this.bindingPanel.setSkeleton();
      void this.loadCurrentImageIntoManualPanel();
    }
  }

  private async loadCurrentImageIntoManualPanel(): Promise<void> {
    const imageData = this.state?.explosionImage || this.state?.characterImage;
    if (!imageData) {
      this.showStatus('没有可用的拆件图，请先上传或生成');
      return;
    }
    try {
      await this.bindingPanel.loadImageFromDataUrl(imageData);
      this.showStatus('已载入当前拆件图，可在右侧手动框选');
    } catch (e) {
      this.showStatus('载入当前拆件图失败: ' + (e as Error).message);
    }
  }

  private uploadExplosion(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        if (this.state) {
          this.state.explosionImage = dataUrl;
          this.state.partRegions = [];
          this.onStateChange?.();
        }
        this.updateAutoPanel();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  private updateAutoPanel(): void {
    const hasImg = !!(this.state?.explosionImage || this.state?.characterImage);
    const hasParts = (this.state?.partRegions?.length ?? 0) > 0;
    const btn = this.q('#ab-run-auto') as HTMLButtonElement;
    btn.disabled = !hasImg && !hasParts;
    btn.title = btn.disabled ? '请先生成或上传拆件图' : '根据当前拆件图和标注部件自动生成骨骼绑定';
    if (hasImg || hasParts) {
      this.showStatus('图像已加载，点击「一键自动绑骨」');
    } else {
      this.showStatus('请先生成或上传拆件图');
    }
    this.buildPartsList();
  }

  private async runAutoBind(): Promise<void> {
    const btn = this.q('#ab-run-auto') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '⏳ 处理中...';
    this.showStatus('正在处理...');

    try {
      let regions = this.state?.partRegions ?? [];

      if (regions.length === 0) {
        const imageData = this.state?.explosionImage || this.state?.characterImage;
        if (!imageData) throw new Error('没有可用的图像');

        this.showStatus('正在智能检测部件...');
        const img = await this.loadImage(imageData);
        regions = this.detectParts(img);

        if (this.state) {
          this.state.partRegions = regions;
          this.onStateChange?.();
        }
      }

      this.showStatus('正在绑定骨骼...');

      const imageData = this.state?.explosionImage || this.state?.characterImage;
      if (imageData) {
        await this.bindingPanel.loadImageFromDataUrl(imageData);
      }
      this.bindingPanel.clearAllRegions();

      let addedRegions = 0;
      for (const r of regions) {
        if (!r.imageData || r.width === 0) continue;
        this.bindingPanel.addRegionProgrammatically(
          r.id, r.x, r.y, r.width, r.height, r.imageData
        );
        addedRegions++;
      }
      if (addedRegions === 0) {
        throw new Error('没有可绑定的有效部件，请先在「拆分部件」中完成标注');
      }

      await new Promise(r => setTimeout(r, 100));
      await this.bindingPanel.triggerAutoBind();
    } catch (e) {
      this.showStatus('❌ 失败: ' + (e as Error).message);
    } finally {
      btn.disabled = false;
      btn.textContent = '一键自动绑骨';
    }
  }

  private applyBindingResult(bindingJson: RawSpineJson, cropImages: Map<string, string>, broadcast: boolean): void {
    if (!this.state) return;
    const skeleton = parseSpineJson(bindingJson);
    this.state.bindingJson = bindingJson;
    this.state.bindingSkeleton = skeleton;
    this.state.attachmentImages = new Map(cropImages);
    this.onStateChange?.();
    this.loadPreview(skeleton, cropImages);
    (this.q('#ab-confirm') as HTMLButtonElement).disabled = false;
    this.showStatus('绑骨完成！点击部件可调整位置');
    if (broadcast) this.broadcastBindingResult(bindingJson, cropImages);
  }

  private loadPreview(skel: EditorSkeleton, cropImages: Map<string, string>): void {
    this.previewSkeleton = skel;
    this.previewImages.clear();
    this.partAdjustments.clear();

    let loaded = 0;
    const total = cropImages.size;
    for (const [partId, dataUrl] of cropImages) {
      const img = new Image();
      img.onload = () => {
        loaded++;
        if (loaded === total) {
          this.buildPartsList();
          (this.q('#ab-preview-empty') as HTMLElement).style.display = 'none';
          this.startRenderLoop();
        }
      };
      img.onerror = () => { loaded++; };
      img.src = dataUrl;
      this.previewImages.set(partId, img);
      this.partAdjustments.set(partId, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 });
    }
  }

  private resizePreview(): void {
    if (!this.previewCanvas) return;
    const wrap = this.q('#ab-preview-wrap') as HTMLElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.previewCanvas.width = Math.round(rect.width * dpr);
    this.previewCanvas.height = Math.round(rect.height * dpr);
  }

  private startRenderLoop(): void {
    if (this.animFrame) return;
    const loop = () => {
      if (!this.centerView.isConnected) { this.animFrame = 0; return; }
      this.drawPreview();
      this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  private stopRenderLoop(): void {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = 0; }
  }

  private drawPreview(): void {
    const ctx = this.previewCtx;
    const cvs = this.previewCanvas;
    if (!ctx || !cvs || !this.previewSkeleton) return;

    const dpr = window.devicePixelRatio || 1;
    const W = cvs.width / dpr;
    const H = cvs.height / dpr;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    const skel = this.previewSkeleton;
    computeWorldTransforms(skel.bones, skel.boneOrder);
    if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik);

    const cx = W / 2 + this.previewPanX;
    const cy = H / 2 + this.previewPanY;
    const z = this.previewZoom;

    ctx.fillStyle = 'rgba(80,70,55,0.15)';
    const sp = 50 * z;
    if (sp >= 10) {
      const gx = ((cx % sp) - sp) % sp, gy = ((cy % sp) - sp) % sp;
      for (let x = gx; x < W; x += sp) for (let y = gy; y < H; y += sp) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }

    ctx.strokeStyle = 'rgba(255,200,100,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 30, cy); ctx.lineTo(cx + 30, cy);
    ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy + 30); ctx.stroke();

    const PART_TO_BONE: Record<string, { bone: string; slot: string }> = this.bindingPanel.getPartToBone();

    const orderedParts = this.drawOrder.filter(id => this.previewImages.has(id));
    for (const id of this.previewImages.keys()) {
      if (!orderedParts.includes(id)) orderedParts.unshift(id);
    }

    this.partScreenCache.clear();

    for (const partId of orderedParts) {
      const img = this.previewImages.get(partId);
      const mapping = PART_TO_BONE[partId];
      if (!mapping || !img) continue;
      const bone = skel.bones.get(mapping.bone);
      if (!bone || !img.complete || img.width === 0) continue;
      const adj = this.getAdj(partId);

      const attMap = skel.skinAttachments.get(mapping.slot);
      const att = attMap?.get(partId);
      const attX = att?.x ?? bone.length / 2;
      const attY = att?.y ?? 0;
      const attRot = att?.rotation ?? 0;
      const attW = att?.width ?? bone.length;
      const attH = att?.height ?? bone.length;

      const boneRad = bone.worldRotation * Math.PI / 180;
      const worldX = bone.worldX + (attX * Math.cos(boneRad) - attY * Math.sin(boneRad));
      const worldY = bone.worldY + (attX * Math.sin(boneRad) + attY * Math.cos(boneRad));

      const imgX = cx + (worldX + adj.offsetX) * z;
      const imgY = cy - (worldY + adj.offsetY) * z;
      const totalRot = (bone.worldRotation + attRot + adj.rotation) * Math.PI / 180;
      const dw = attW * adj.scale * z;
      const dh = attH * adj.scale * z;

      this.partScreenCache.set(partId, {
        screenX: imgX, screenY: imgY,
        rotation: totalRot, halfW: dw / 2, halfH: dh / 2,
      });

      ctx.save();
      ctx.translate(imgX, imgY);
      ctx.rotate(-totalRot);
      ctx.globalAlpha = this.selectedPart === partId ? 1 : 0.85;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }

    this.boneScreenCache.clear();
    const isBoneMode = this.editMode === 'bone';
    ctx.globalAlpha = isBoneMode ? 0.9 : 0.4;
    for (const name of skel.boneOrder) {
      const bone = skel.bones.get(name)!;
      if (!bone.parent) continue;
      const bx = cx + bone.worldX * z, by = cy - bone.worldY * z;
      this.boneScreenCache.set(name, { sx: bx, sy: by });
      const isSel = this.selectedBone === name;
      if (bone.length > 0) {
        const rad = bone.worldRotation * Math.PI / 180;
        const ex = bx + Math.cos(rad) * bone.length * z;
        const ey = by - Math.sin(rad) * bone.length * z;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
        ctx.strokeStyle = isSel ? '#ffee44' : '#44cc66';
        ctx.lineWidth = isSel ? 2.5 : 1.5;
        ctx.stroke();
      }
      const r = isSel ? 5 : 3;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#ffee44' : '#ff4444'; ctx.fill();
      if (isSel) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    if (this.editMode === 'bone') {
      for (const name of skel.boneOrder) {
        const bone = skel.bones.get(name)!;
        if (!bone.parent) continue;
        const isSel = this.selectedBone === name;
        ctx.fillStyle = isSel ? '#ffee44' : 'rgba(255,255,255,0.35)';
        ctx.fillText(name, cx + bone.worldX * z + 6, cy - bone.worldY * z - 6);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (const [partId] of this.previewImages) {
        const mapping = PART_TO_BONE[partId];
        if (!mapping) continue;
        const bone = skel.bones.get(mapping.bone);
        if (!bone) continue;
        const def = PART_DEFS.find(p => p.id === partId);
        ctx.fillText(def?.name ?? partId, cx + bone.worldX * z + 6, cy - bone.worldY * z - 4);
      }
    }

    if (this.selectedPart && this.editMode === 'image') {
      const sc = this.partScreenCache.get(this.selectedPart);
      if (sc) this.drawGizmo(ctx, sc);
    }

    ctx.restore();
  }

  private drawGizmo(ctx: CanvasRenderingContext2D, sc: {
    screenX: number; screenY: number;
    rotation: number; halfW: number; halfH: number;
  }): void {
    const { screenX: sx, screenY: sy, rotation: rot, halfW: hw, halfH: hh } = sc;
    const hs = this.handleSize;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-rot);

    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    ctx.setLineDash([]);

    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (const [cx, cy] of corners) {
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
      ctx.strokeStyle = '#332a10';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - hs, cy - hs, hs * 2, hs * 2);
    }

    const rotY = -hh - this.rotHandleOffset;
    ctx.strokeStyle = 'rgba(255,224,102,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(0, rotY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(0, rotY, hs + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#66cc77';
    ctx.fill();
    ctx.strokeStyle = '#224422';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${hs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↻', 0, rotY);

    ctx.restore();
  }

  // Reuse ExplosionTab's 16-part IDs/names for position-based detection
  private static readonly EXPL_IDS = [
    'head', 'chest', 'waist',
    'upperarm_r', 'upperarm_l',
    'forearm_r', 'forearm_l',
    'thigh_r', 'thigh_l',
    'calf_r', 'calf_l',
    'foot_r', 'foot_l',
    'hand_r', 'hand_l',
    'weapon',
  ];
  private static readonly EXPL_NAMES = [
    '头部', '上胸', '腰/骨盆',
    '右上臂', '左上臂',
    '右前臂', '左前臂',
    '右大腿', '左大腿',
    '右小腿', '左小腿',
    '右脚', '左脚',
    '右手', '左手',
    '武器',
  ];

  private static readonly ZONES: Record<string, [number, number, number, number]> = {
    head:       [0.22, 0.00, 0.72, 0.15],
    upperarm_r: [0.00, 0.05, 0.33, 0.30],
    chest:      [0.22, 0.10, 0.72, 0.38],
    upperarm_l: [0.52, 0.05, 0.92, 0.30],
    forearm_r:  [0.00, 0.26, 0.33, 0.48],
    waist:      [0.22, 0.32, 0.72, 0.52],
    forearm_l:  [0.52, 0.26, 0.92, 0.48],
    hand_r:     [0.00, 0.42, 0.22, 0.58],
    thigh_r:    [0.18, 0.42, 0.50, 0.63],
    thigh_l:    [0.42, 0.42, 0.72, 0.63],
    hand_l:     [0.62, 0.42, 0.92, 0.58],
    calf_r:     [0.10, 0.57, 0.48, 0.80],
    calf_l:     [0.42, 0.57, 0.78, 0.80],
    foot_r:     [0.10, 0.76, 0.48, 1.00],
    foot_l:     [0.42, 0.76, 0.78, 1.00],
  };

  private static readonly CENTERS: Record<string, [number, number]> = {
    head:       [0.46, 0.07],
    upperarm_r: [0.15, 0.18],
    chest:      [0.46, 0.24],
    upperarm_l: [0.72, 0.18],
    forearm_r:  [0.15, 0.37],
    waist:      [0.46, 0.41],
    forearm_l:  [0.72, 0.37],
    hand_r:     [0.10, 0.51],
    thigh_r:    [0.33, 0.53],
    thigh_l:    [0.56, 0.53],
    hand_l:     [0.78, 0.51],
    calf_r:     [0.28, 0.70],
    calf_l:     [0.58, 0.70],
    foot_r:     [0.28, 0.88],
    foot_l:     [0.58, 0.88],
  };

  private detectParts(img: HTMLImageElement): PartRegion[] {
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);
    const { data, width, height } = imgData;

    const ALPHA_TH = 25;
    const opaque = new Uint8Array(width * height);
    for (let i = 0; i < opaque.length; i++) opaque[i] = data[i * 4 + 3] >= ALPHA_TH ? 1 : 0;

    const claimed = new Int32Array(width * height).fill(-1);

    const colCounts = new Uint32Array(width);
    for (let x = 0; x < width; x++)
      for (let y = 0; y < height; y++)
        if (opaque[y * width + x]) colCounts[x]++;

    let contentRight = width - 1;
    while (contentRight > 0 && colCounts[contentRight] < 3) contentRight--;

    const gapThreshold = Math.max(3, Math.round(height * 0.02));
    let bestGapStart = -1, bestGapLen = 0, curGapStart = -1;
    for (let x = Math.round(width * 0.40); x <= contentRight; x++) {
      if (colCounts[x] < gapThreshold) {
        if (curGapStart < 0) curGapStart = x;
      } else {
        if (curGapStart >= 0) {
          const len = x - curGapStart;
          if (len > bestGapLen) { bestGapLen = len; bestGapStart = curGapStart; }
        }
        curGapStart = -1;
      }
    }
    if (curGapStart >= 0) {
      const len = contentRight - curGapStart + 1;
      if (len > bestGapLen) { bestGapLen = len; bestGapStart = curGapStart; }
    }

    let bodyRight = bestGapLen >= 3 ? bestGapStart : Math.round(width * 0.70);
    const bodyW = bodyRight;
    const maxSearch = Math.round(Math.max(bodyW, height) * 0.12);
    let nextLabel = 0;

    const findSeed = (cx: number, cy: number, zxMin: number, zyMin: number, zxMax: number, zyMax: number, maxR: number): [number, number] | null => {
      const ok = (nx: number, ny: number) => nx >= zxMin && nx <= zxMax && ny >= zyMin && ny <= zyMax && nx >= 0 && nx < width && ny >= 0 && ny < height;
      if (ok(cx, cy) && opaque[cy * width + cx] === 1 && claimed[cy * width + cx] < 0) return [cx, cy];
      for (let r = 1; r <= maxR; r++) {
        for (let d = -r; d <= r; d++) {
          for (const [nx, ny] of [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]] as [number, number][]) {
            if (!ok(nx, ny)) continue;
            const ni = ny * width + nx;
            if (opaque[ni] === 1 && claimed[ni] < 0) return [nx, ny];
          }
        }
      }
      return null;
    };

    const floodFill = (sx: number, sy: number, label: number): number[] => {
      const pixels: number[] = [];
      const idx0 = sy * width + sx;
      if (claimed[idx0] >= 0 || opaque[idx0] === 0) return pixels;
      const stack = [idx0]; claimed[idx0] = label;
      while (stack.length > 0) {
        const idx = stack.pop()!; pixels.push(idx);
        const px = idx % width, py = (idx - px) / width;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number,number][]) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (claimed[ni] >= 0 || opaque[ni] === 0) continue;
          claimed[ni] = label; stack.push(ni);
        }
      }
      return pixels;
    };

    const regions: PartRegion[] = [];
    const pad = 2;
    const IDS = AutoBindTab.EXPL_IDS;
    const NAMES = AutoBindTab.EXPL_NAMES;

    for (let i = 0; i < IDS.length; i++) {
      const partId = IDS[i], partName = NAMES[i];
      let zxMin: number, zyMin: number, zxMax: number, zyMax: number, cx: number, cy: number;

      if (partId === 'weapon') {
        zxMin = Math.max(0, bodyRight - 5); zyMin = 0; zxMax = width - 1; zyMax = height - 1;
        cx = Math.round((bodyRight + contentRight) / 2); cy = Math.round(height * 0.45);
      } else {
        const zone = AutoBindTab.ZONES[partId], center = AutoBindTab.CENTERS[partId];
        if (!zone || !center) { regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' }); continue; }
        zxMin = Math.max(0, Math.round(zone[0] * bodyW)); zyMin = Math.max(0, Math.round(zone[1] * height));
        zxMax = Math.min(width - 1, Math.round(zone[2] * bodyW)); zyMax = Math.min(height - 1, Math.round(zone[3] * height));
        cx = Math.round(center[0] * bodyW); cy = Math.round(center[1] * height);
      }

      const seed = findSeed(cx, cy, zxMin, zyMin, zxMax, zyMax, maxSearch);
      if (!seed) { regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' }); continue; }
      const pixels = floodFill(seed[0], seed[1], nextLabel++);
      if (pixels.length < 20) { regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' }); continue; }

      let minX = width, minY = height, maxX = 0, maxY = 0;
      for (const pi of pixels) { const px = pi % width, py = (pi - px) / width; if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; }
      const bx = Math.max(0, minX - pad), by = Math.max(0, minY - pad);
      const bw = Math.min(width, maxX + pad + 1) - bx, bh = Math.min(height, maxY + pad + 1) - by;

      const partCanvas = document.createElement('canvas'); partCanvas.width = bw; partCanvas.height = bh;
      const pCtx = partCanvas.getContext('2d')!; const pData = pCtx.createImageData(bw, bh);
      for (const pi of pixels) {
        const px = pi % width, py = (pi - px) / width;
        const dx = px - bx, dy = py - by;
        if (dx < 0 || dx >= bw || dy < 0 || dy >= bh) continue;
        const so = pi * 4, d = (dy * bw + dx) * 4;
        pData.data[d] = data[so]; pData.data[d + 1] = data[so + 1]; pData.data[d + 2] = data[so + 2]; pData.data[d + 3] = data[so + 3];
      }
      pCtx.putImageData(pData, 0, 0);

      regions.push({ id: partId, name: partName, x: bx, y: by, width: bw, height: bh, imageData: partCanvas.toDataURL('image/png') });
    }

    return regions;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  private showStatus(msg: string): void {
    const el = this.q('#ab-status') as HTMLElement;
    if (el) el.textContent = msg;
    const autoStatus = this.q('#ab-auto-status') as HTMLElement;
    if (autoStatus) autoStatus.textContent = msg;
  }

  private confirm(): void {
    if (!this.state?.bindingJson) return;

    this.applyAdjustmentsToJson();

    this.state.bindingVersion = (this.state.bindingVersion ?? 0) + 1;
    this.state.activeTab = 'anim';
    this.onStateChange?.();
  }

  private applyAdjustmentsToJson(): void {
    const state = this.state;
    if (!state?.bindingJson || !this.previewSkeleton) return;

    const json = state.bindingJson;
    const skel = this.previewSkeleton;
    const PART_TO_BONE = this.bindingPanel.getPartToBone();

    computeWorldTransforms(skel.bones, skel.boneOrder);
    if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik);

    const skinAtts = json.skins?.[0]?.attachments;
    if (!skinAtts) return;

    for (const [partId, adj] of this.partAdjustments) {
      if (adj.offsetX === 0 && adj.offsetY === 0 && adj.scale === 1 && adj.rotation === 0) continue;

      const mapping = PART_TO_BONE[partId];
      if (!mapping) continue;
      const bone = skel.bones.get(mapping.bone);
      if (!bone) continue;

      const slotAtts = skinAtts[mapping.slot];
      if (!slotAtts) continue;
      const att = slotAtts[partId];
      if (!att) continue;

      if (adj.rotation !== 0) {
        att.rotation = (att.rotation ?? 0) + adj.rotation;
      }

      if (adj.scale !== 1) {
        att.scaleX = (att.scaleX ?? 1) * adj.scale;
        att.scaleY = (att.scaleY ?? 1) * adj.scale;
      }

      if (adj.offsetX !== 0 || adj.offsetY !== 0) {
        const boneRad = bone.worldRotation * Math.PI / 180;
        const cos = Math.cos(boneRad);
        const sin = Math.sin(boneRad);
        const localDx = adj.offsetX * cos + adj.offsetY * sin;
        const localDy = -adj.offsetX * sin + adj.offsetY * cos;
        att.x = (att.x ?? 0) + localDx;
        att.y = (att.y ?? 0) + localDy;
      }
    }

    const slotToPartId = new Map<string, string>();
    for (const [partId, mapping] of Object.entries(PART_TO_BONE)) {
      slotToPartId.set(mapping.slot, partId);
    }

    if (json.slots && this.drawOrder.length > 0) {
      const partToSlotName = new Map<string, string>();
      for (const [partId, mapping] of Object.entries(PART_TO_BONE)) {
        partToSlotName.set(partId, mapping.slot);
      }

      const orderedSlotNames: string[] = [];
      for (const partId of this.drawOrder) {
        const slotName = partToSlotName.get(partId);
        if (slotName) orderedSlotNames.push(slotName);
      }

      const slotsByName = new Map<string, any>();
      for (const slot of json.slots) {
        slotsByName.set(slot.name, slot);
      }

      const newSlots: any[] = [];
      const placed = new Set<string>();

      for (const slotName of orderedSlotNames) {
        const slot = slotsByName.get(slotName);
        if (slot) {
          newSlots.push(slot);
          placed.add(slotName);
        }
      }

      for (const slot of json.slots) {
        if (!placed.has(slot.name)) {
          newSlots.push(slot);
        }
      }

      json.slots = newSlots;
    }

    state.bindingSkeleton = parseSpineJson(json);

    this.partAdjustments.clear();
    for (const def of PART_DEFS) {
      if (this.previewImages.has(def.id)) {
        this.partAdjustments.set(def.id, { offsetX: 0, offsetY: 0, scale: 1, rotation: 0 });
      }
    }

    this.previewSkeleton = state.bindingSkeleton;
    this.buildPartsList();
  }

  activate(state: StudioState): void {
    this.state = state;
    this.updateAutoPanel();

    if (state.bindingJson && state.bindingSkeleton && state.attachmentImages.size > 0) {
      (this.q('#ab-confirm') as HTMLButtonElement).disabled = false;
      this.showStatus('已绑骨，可调整部件或进入动作工坊');
      if (!this.previewSkeleton) {
        this.loadPreview(state.bindingSkeleton, state.attachmentImages);
      } else {
        this.startRenderLoop();
      }
    }
  }

  deactivate(): void {
    this.stopRenderLoop();
  }

  dispose(): void {
    this.stopRenderLoop();
    this.bindBc?.close();
    this.container.remove();
    this.sidePanel.remove();
    this.centerView.remove();
    this.centerToolbar.remove();
  }
}
