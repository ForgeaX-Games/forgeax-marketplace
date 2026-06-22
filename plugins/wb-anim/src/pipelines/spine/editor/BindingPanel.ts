// @source wb-character/src/pipelines/spine/editor/BindingPanel.ts
import type { RawSpineJson, RawAttachment, EditorSkeleton } from './types';
import { parseSpineJson, computeWorldTransforms, applyIKConstraints } from './SpineDataParser';

const BODY_PARTS = [
  { id: 'head', name: '头部', color: '#ff6b6b' },
  { id: 'chest', name: '上胸', color: '#ffa94d' },
  { id: 'waist', name: '腰/骨盆', color: '#ffe066' },
  { id: 'upperarm_l', name: '左上臂', color: '#74c0fc' },
  { id: 'forearm_l', name: '左前臂', color: '#4dabf7' },
  { id: 'hand_l', name: '左手', color: '#3bc9db' },
  { id: 'upperarm_r', name: '右上臂', color: '#63e6be' },
  { id: 'forearm_r', name: '右前臂', color: '#38d9a9' },
  { id: 'hand_r', name: '右手', color: '#20c997' },
  { id: 'thigh_l', name: '左大腿', color: '#b197fc' },
  { id: 'calf_l', name: '左小腿', color: '#9775fa' },
  { id: 'foot_l', name: '左脚', color: '#845ef7' },
  { id: 'thigh_r', name: '右大腿', color: '#fcc2d7' },
  { id: 'calf_r', name: '右小腿', color: '#f783ac' },
  { id: 'foot_r', name: '右脚', color: '#e64980' },
  { id: 'weapon', name: '武器', color: '#ff922b' },
];

const PART_TO_BONE: Record<string, { bone: string; slot: string }> = {
  head:       { bone: 'head',       slot: 'head' },
  chest:      { bone: 'torso',      slot: 'torso' },
  waist:      { bone: 'pelvis',     slot: 'pelvis' },
  upperarm_l: { bone: 'arm_f_up',   slot: 'arm_f_up' },
  forearm_l:  { bone: 'arm_f_down', slot: 'arm_f_down' },
  hand_l:     { bone: 'hand_f',     slot: 'hand_f' },
  upperarm_r: { bone: 'arm_b_up',   slot: 'arm_b_up' },
  forearm_r:  { bone: 'arm_b_down', slot: 'arm_b_down' },
  hand_r:     { bone: 'hand_b',     slot: 'hand_b' },
  thigh_l:    { bone: 'leg_f_up',   slot: 'leg_f_up' },
  calf_l:     { bone: 'leg_f_down', slot: 'leg_f_down' },
  foot_l:     { bone: 'foot_f',     slot: 'foot_f' },
  thigh_r:    { bone: 'leg_b_up',   slot: 'leg_b_up' },
  calf_r:     { bone: 'leg_b_down', slot: 'leg_b_down' },
  foot_r:     { bone: 'foot_b',     slot: 'foot_b' },
  weapon:     { bone: 'weapon',     slot: 'weapon' },
};

const HUMANOID_TEMPLATE: RawSpineJson = {
  skeleton: { hash: 'male-warrior', spine: '3.8.99', x: -212.32, y: -42.67, width: 553.08, height: 872.92 },
  bones: [
    { name: 'root' },
    { name: 'pelvis', parent: 'root', x: 20.16, y: 398.61 },
    { name: 'torso', parent: 'pelvis', length: 220.29, rotation: 94.48, x: -1.32, y: 37.04 },
    { name: 'torso2', parent: 'torso', length: 86.81, rotation: 101.75, x: 205.36, y: 12.67, transform: 'noScale' },
    { name: 'arm_f_up', parent: 'torso2', length: 103.13, rotation: 53.25, x: 85.27, y: -3.69, transform: 'noScale' },
    { name: 'arm_f_down', parent: 'arm_f_up', length: 129.02, rotation: 17, x: 104.88, y: -2.17 },
    { name: 'hand_f', parent: 'arm_f_down', length: 47.76, rotation: 7.76, x: 132.15, y: -0.69 },
    { name: 'torso4', parent: 'torso', length: 72.64, rotation: -109.61, x: 203.06, y: -11.04, transform: 'noScale' },
    { name: 'arm_b_up', parent: 'torso4', length: 104.46, rotation: -55.9, x: 72.75, y: -0.43 },
    { name: 'arm_b_down', parent: 'arm_b_up', length: 113.76, rotation: -2.99, x: 107.23, y: -1.42 },
    { name: 'hand_b', parent: 'arm_b_down', length: 52.76, rotation: -3.91, x: 115.88, y: -0.61 },
    { name: 'head', parent: 'torso', length: 105.37, rotation: -9.52, x: 243.06, y: -2.67, transform: 'noScale' },
    { name: 'head2', parent: 'head', length: 28.58, rotation: -46.85, x: 126.15, y: -4.81 },
    { name: 'head3', parent: 'head', length: 29.55, rotation: -84.96, x: 122.43, y: -22.84 },
    { name: 'head5', parent: 'head', length: 38.87, rotation: 91.79, x: 116.27, y: 16.9 },
    { name: 'head6', parent: 'head', length: 27.53, rotation: 130.26, x: 91.73, y: 39.08 },
    { name: 'leg_f_up', parent: 'pelvis', length: 152.11, rotation: -110.54, x: -44.54, y: -50.12 },
    { name: 'leg_f_down', parent: 'leg_f_up', length: 134.79, rotation: 4, x: 154.02, y: 1.19 },
    { name: 'foot_f', parent: 'leg_f_down', length: 73.41, rotation: 8.94, x: 137.7, y: -0.52 },
    { name: 'leg_b_up', parent: 'pelvis', length: 151.12, rotation: -81.61, x: 33.08, y: -37.78 },
    { name: 'leg_b_down', parent: 'leg_b_up', length: 128.88, rotation: -6.04, x: 149.24, y: -0.62 },
    { name: 'foot_b', parent: 'leg_b_down', length: 70.87, rotation: 3, x: 133.69, y: -1.08 },
    { name: 'weapon', parent: 'hand_f', length: 405.46, rotation: 69.05, x: 45.95, y: -2.25 },
    { name: 'target_f', parent: 'root', x: -118.27, y: 66.6, transform: 'noScale' },
    { name: 'target_b', parent: 'root', x: 78.23, y: 79.7, transform: 'noScale' },
  ],
  slots: [
    { name: 'arm_b_up', bone: 'arm_b_up', attachment: 'arm_b_up' },
    { name: 'arm_b_down', bone: 'arm_b_down', attachment: 'arm_b_down' },
    { name: 'hand_b', bone: 'hand_b', attachment: 'hand_b' },
    { name: 'foot_b', bone: 'foot_b', attachment: 'foot_b' },
    { name: 'leg_b_up', bone: 'leg_b_up', attachment: 'leg_b_up' },
    { name: 'leg_b_down', bone: 'leg_b_down', attachment: 'leg_b_down' },
    { name: 'foot_f', bone: 'foot_f', attachment: 'foot_f' },
    { name: 'leg_f_up', bone: 'leg_f_up', attachment: 'leg_f_up' },
    { name: 'leg_f_down', bone: 'leg_f_down', attachment: 'leg_f_down' },
    { name: 'pelvis', bone: 'pelvis', attachment: 'pelvis' },
    { name: 'torso', bone: 'torso', attachment: 'torso' },
    { name: 'head', bone: 'head', attachment: 'head' },
    { name: 'weapon', bone: 'weapon', attachment: 'weapon' },
    { name: 'arm_f_down', bone: 'arm_f_down', attachment: 'arm_f_down' },
    { name: 'arm_f_up', bone: 'arm_f_up', attachment: 'arm_f_up' },
    { name: 'hand_f', bone: 'hand_f', attachment: 'hand_f' },
  ],
  ik: [
    { name: 'target_f', bones: ['leg_f_up', 'leg_f_down'], target: 'target_f', bendPositive: false },
    { name: 'target_b', order: 1, bones: ['leg_b_up', 'leg_b_down'], target: 'target_b', bendPositive: false },
  ],
  skins: [{ name: 'default', attachments: {
    head: { head: { x: 70, y: -3, rotation: -85, width: 141, height: 166 } },
    torso: { torso: { x: 110, y: 0, rotation: -94, width: 186, height: 273 } },
    pelvis: { pelvis: { x: -14.54, y: -17.01, width: 175, height: 122 } },
    arm_f_up: { arm_f_up: { x: 34.31, y: -3.97, rotation: 110.53, width: 102, height: 156 } },
    arm_f_down: { arm_f_down: { x: 76.61, y: -4.44, rotation: 93.53, width: 64, height: 194 } },
    hand_f: { hand_f: { x: 31.09, y: 5.13, rotation: 85.76, width: 61, height: 81 } },
    arm_b_up: { arm_b_up: { x: 42.58, y: 0.15, rotation: 71.03, width: 77, height: 134 } },
    arm_b_down: { arm_b_down: { x: 51.21, y: -1.33, rotation: 74.02, width: 73, height: 136 } },
    hand_b: { hand_b: { x: 41.5, y: -0.21, rotation: 77.94, width: 63, height: 97 } },
    leg_f_up: { leg_f_up: { x: 72.33, y: 1.41, rotation: 110.54, width: 116, height: 166 } },
    leg_f_down: { leg_f_down: { x: 54.17, y: 0.65, rotation: 106.54, width: 97, height: 169 } },
    foot_f: { foot_f: { x: 49.5, y: 14.82, rotation: 97.59, width: 80, height: 124 } },
    leg_b_up: { leg_b_up: { x: 70.41, y: -0.76, rotation: 81.61, width: 100, height: 173 } },
    leg_b_down: { leg_b_down: { x: 55.25, y: 2.23, rotation: 87.65, width: 81, height: 159 } },
    foot_b: { foot_b: { x: 44.56, y: 27.51, rotation: 84.64, width: 115, height: 110 } },
    weapon: { weapon: { x: 214.81, y: -7.96, rotation: -89.64, width: 107, height: 545 } },
  }}],
  animations: {
    idle: {
      bones: {
        pelvis: { translate: [{}, { time: 0.5, y: -3.44 }, { time: 1 }] },
        torso: { translate: [{}, { time: 0.5, y: 6.33 }, { time: 1 }], scale: [{}, { time: 0.5, x: 0.949 }, { time: 1 }] },
        arm_f_up: { rotate: [{}, { time: 0.5, angle: -4.13 }, { time: 1 }] },
        arm_f_down: { rotate: [{}, { time: 0.5, angle: -5 }, { time: 1 }] },
        hand_f: { rotate: [{}, { time: 0.5, angle: 5.35 }, { time: 1 }] },
        arm_b_up: { rotate: [{}, { time: 0.5, angle: 1.37 }, { time: 1 }] },
        arm_b_down: { rotate: [{}, { time: 0.5, angle: 4.65 }, { time: 1 }] },
        head: { rotate: [{}, { time: 0.5, angle: -3.28 }, { time: 1 }] },
      },
    },
  },
};

function shrinkToContent(cvs: HTMLCanvasElement, cctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } | null {
  const data = cctx.getImageData(0, 0, cvs.width, cvs.height).data;
  let minX = cvs.width, minY = cvs.height, maxX = 0, maxY = 0;
  for (let y = 0; y < cvs.height; y++)
    for (let x = 0; x < cvs.width; x++)
      if (data[(y * cvs.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

interface CropRegion { partId: string; x: number; y: number; w: number; h: number; }
interface HistoryEntry { action: 'add' | 'delete'; partId: string; region?: CropRegion; cropImage?: string; }

export class BindingPanel {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sidebar: HTMLDivElement;
  private toast: HTMLDivElement;
  private actionBar: HTMLDivElement;
  private image: HTMLImageElement | null = null;

  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private activePart: string | null = null;
  private regions = new Map<string, CropRegion>();
  private cropImages = new Map<string, string>();
  private skippedParts = new Set<string>();

  private interactionMode: 'idle' | 'panning' | 'selecting' = 'idle';
  private dragOrigin = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };
  private selRect: { x: number; y: number; w: number; h: number } | null = null;

  private history: HistoryEntry[] = [];
  private contextMenu: HTMLDivElement | null = null;

  private viewMode: 'annotate' | 'preview' = 'annotate';
  private previewSkeleton: EditorSkeleton | null = null;
  private previewImages = new Map<string, HTMLImageElement>();
  private partOffsets = new Map<string, { x: number; y: number; scale: number }>();
  private selectedPreviewPart: string | null = null;
  private previewDrag: { startX: number; startY: number; origOx: number; origOy: number } | null = null;
  private previewZoom = 2.5;
  private previewPanX = 0;
  private previewPanY = 0;

  onBind: ((partId: string, imgData: string) => void) | null = null;
  onAutoBindComplete: ((skeleton: EditorSkeleton, spineJson: RawSpineJson, cropImages: Map<string, string>) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'bp-root';
    container.appendChild(this.root);

    const hdr = document.createElement('div');
    hdr.className = 'bp-header';
    this.root.appendChild(hdr);

    const title = document.createElement('span');
    title.className = 'bp-title';
    title.textContent = '角色拆分工具';
    hdr.appendChild(title);

    const help = document.createElement('span');
    help.className = 'bp-help';
    help.textContent = '滚轮缩放 · 中键/Shift+左键拖动 · 左键框选 · 右键菜单';
    hdr.appendChild(help);

    const undoBtn = document.createElement('button');
    undoBtn.className = 'bp-undo-btn';
    undoBtn.textContent = '↩ 撤销';
    undoBtn.addEventListener('click', () => this.undo());
    hdr.appendChild(undoBtn);

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'bp-upload';
    uploadBtn.textContent = '上传图片';
    hdr.appendChild(uploadBtn);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    hdr.appendChild(fileInput);
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.loadImage(URL.createObjectURL(f));
    });

    const body = document.createElement('div');
    body.className = 'bp-body';
    this.root.appendChild(body);

    this.sidebar = document.createElement('div');
    this.sidebar.className = 'bp-sidebar';
    body.appendChild(this.sidebar);
    this.buildSidebar();

    const cw = document.createElement('div');
    cw.className = 'bp-canvas-wrap';
    body.appendChild(cw);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bp-canvas';
    cw.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.actionBar = document.createElement('div');
    this.actionBar.className = 'bp-action-bar';
    this.root.appendChild(this.actionBar);
    this.buildActionBar();

    this.toast = document.createElement('div');
    this.toast.className = 'bp-toast';
    this.root.appendChild(this.toast);

    this.bindCanvas(cw);
    new ResizeObserver(() => this.fitCanvas(cw)).observe(cw);
  }

  setSkeleton(): void { /* no-op */ }

  private get dpr(): number { return window.devicePixelRatio || 1; }
  private get logicalW(): number { return this.canvas.width / this.dpr; }
  private get logicalH(): number { return this.canvas.height / this.dpr; }

  // ── Sidebar ──

  private buildSidebar(): void {
    this.sidebar.innerHTML = '';
    if (this.viewMode === 'preview') { this.buildPreviewSidebar(); return; }

    const tip = document.createElement('div');
    tip.className = 'bp-tip';
    tip.innerHTML = '<b>操作步骤</b><br>① 点击下方某个部位<br>② 在右侧图片上框选<br>③ 松手自动保存并缩框<br>④ 不需要的部位点「跳过」';
    this.sidebar.appendChild(tip);

    for (const part of BODY_PARTS) {
      const row = document.createElement('div');
      row.className = 'bp-part';
      if (this.activePart === part.id) row.classList.add('active');
      const isDone = this.regions.has(part.id);
      const isSkipped = this.skippedParts.has(part.id);
      if (isDone) row.classList.add('done');
      if (isSkipped) row.classList.add('skipped');

      const dot = document.createElement('span');
      dot.className = 'bp-dot';
      dot.style.background = part.color;
      if (isSkipped) dot.style.opacity = '0.3';
      row.appendChild(dot);

      const nameEl = document.createElement('span');
      nameEl.className = 'bp-part-name';
      nameEl.textContent = part.name;
      if (isSkipped) nameEl.style.textDecoration = 'line-through';
      row.appendChild(nameEl);

      const btns = document.createElement('span');
      btns.className = 'bp-part-btns';

      if (isDone) {
        const reBtn = document.createElement('button');
        reBtn.className = 'bp-part-btn bp-part-redo-btn';
        reBtn.textContent = '重选';
        reBtn.addEventListener('click', (e) => { e.stopPropagation(); this.redoPart(part.id); });
        btns.appendChild(reBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'bp-part-btn bp-part-del-btn';
        delBtn.textContent = '删除';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deletePart(part.id); });
        btns.appendChild(delBtn);
      } else if (!isSkipped) {
        const skipBtn = document.createElement('button');
        skipBtn.className = 'bp-part-btn bp-part-skip-btn';
        skipBtn.textContent = '跳过';
        skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.skipPart(part.id); });
        btns.appendChild(skipBtn);
      } else {
        const unskipBtn = document.createElement('button');
        unskipBtn.className = 'bp-part-btn';
        unskipBtn.textContent = '恢复';
        unskipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.unskipPart(part.id); });
        btns.appendChild(unskipBtn);
      }
      row.appendChild(btns);

      const thumb = this.cropImages.get(part.id);
      if (thumb) {
        const img = document.createElement('img');
        img.className = 'bp-thumb';
        img.src = thumb;
        row.appendChild(img);
      }

      row.addEventListener('click', () => {
        if (isSkipped) return;
        this.activePart = part.id;
        this.buildSidebar();
        this.showToast(`已选择「${part.name}」，请在图上框选`);
      });
      this.sidebar.appendChild(row);
    }
  }

  private buildPreviewSidebar(): void {
    const tip = document.createElement('div');
    tip.className = 'bp-tip';
    tip.innerHTML = '<b>预览模式</b><br>点选部位 → 拖拽微调位置<br>滚轮调缩放 · 「归零」重置偏移';
    this.sidebar.appendChild(tip);

    for (const part of BODY_PARTS) {
      if (!this.cropImages.has(part.id)) continue;
      const row = document.createElement('div');
      row.className = 'bp-part';
      if (this.selectedPreviewPart === part.id) row.classList.add('active');

      const dot = document.createElement('span');
      dot.className = 'bp-dot';
      dot.style.background = part.color;
      row.appendChild(dot);

      const nameEl = document.createElement('span');
      nameEl.className = 'bp-part-name';
      nameEl.textContent = part.name;
      row.appendChild(nameEl);

      const off = this.partOffsets.get(part.id) ?? { x: 0, y: 0, scale: 1 };
      const info = document.createElement('span');
      info.className = 'bp-offset-info';
      info.textContent = `${off.x.toFixed(0)},${off.y.toFixed(0)} ×${off.scale.toFixed(2)}`;
      row.appendChild(info);

      const resetBtn = document.createElement('button');
      resetBtn.className = 'bp-part-btn';
      resetBtn.textContent = '归零';
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.partOffsets.set(part.id, { x: 0, y: 0, scale: 1 });
        this.buildSidebar(); this.draw();
      });
      row.appendChild(resetBtn);

      row.addEventListener('click', () => {
        this.selectedPreviewPart = part.id;
        this.buildSidebar(); this.draw();
      });
      this.sidebar.appendChild(row);
    }
  }

  // ── Skip ──

  private skipPart(partId: string): void {
    this.skippedParts.add(partId);
    if (this.activePart === partId) this.activePart = this.nextAvailablePart(partId);
    this.showToast(`已跳过「${BODY_PARTS.find(p => p.id === partId)?.name}」`);
    this.buildSidebar();
    this.buildActionBar();
  }

  private unskipPart(partId: string): void {
    this.skippedParts.delete(partId);
    this.showToast(`已恢复「${BODY_PARTS.find(p => p.id === partId)?.name}」`);
    this.buildSidebar();
  }

  private nextAvailablePart(afterPartId: string): string | null {
    const idx = BODY_PARTS.findIndex(p => p.id === afterPartId);
    for (let i = 1; i < BODY_PARTS.length; i++) {
      const p = BODY_PARTS[(idx + i) % BODY_PARTS.length];
      if (!this.regions.has(p.id) && !this.skippedParts.has(p.id)) return p.id;
    }
    return null;
  }

  // ── Action bar ──

  private buildActionBar(): void {
    this.actionBar.innerHTML = '';
    const count = this.regions.size;

    const info = document.createElement('span');
    info.className = 'bp-action-info';
    info.textContent = `已标注 ${count}/${BODY_PARTS.length - this.skippedParts.size} 个部位`;
    this.actionBar.appendChild(info);

    if (this.viewMode === 'annotate') {
      this.addActionBtn('Canvas 抠图', count === 0, () => this.canvasRemoveBg());
      this.addActionBtn(this.isScaled ? '✅ 已缩放' : '📐 一键缩放', count === 0 || this.isScaled, () => { this.scaleToTemplate(); });
      this.addActionBtn('自动绑骨', count < 1, () => { this.autoBind().then(() => this.draw()); }, true);
      this.addActionBtn('预览拼装', !this.previewSkeleton, () => this.switchView('preview'));
      this.addActionBtn('导出 JSON', !this.previewSkeleton, () => this.exportSpineJson());
    } else {
      this.addActionBtn('← 返回标注', false, () => this.switchView('annotate'));
      this.addActionBtn('导出 Spine JSON', false, () => this.exportSpineJson(), true);
      this.addActionBtn('加载到编辑器', false, () => this.loadToEditor());
    }
  }

  private addActionBtn(text: string, disabled: boolean, onClick: () => void, primary = false): void {
    const btn = document.createElement('button');
    btn.className = `bp-action-btn${primary ? ' bp-action-primary' : ''}`;
    btn.textContent = text;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    this.actionBar.appendChild(btn);
  }

  private switchView(mode: 'annotate' | 'preview'): void {
    this.viewMode = mode;
    if (mode === 'preview' && !this.previewSkeleton) {
      this.autoBind().then(() => { this.buildSidebar(); this.buildActionBar(); this.draw(); });
      return;
    }
    this.buildSidebar(); this.buildActionBar(); this.draw();
  }

  // ── Edit operations ──

  private deletePart(partId: string): void {
    const region = this.regions.get(partId);
    const img = this.cropImages.get(partId);
    if (region) this.history.push({ action: 'delete', partId, region: { ...region }, cropImage: img });
    this.regions.delete(partId);
    this.cropImages.delete(partId);
    this.showToast(`已删除「${BODY_PARTS.find(p => p.id === partId)?.name ?? partId}」`);
    this.buildSidebar(); this.buildActionBar(); this.draw();
  }

  private redoPart(partId: string): void {
    this.deletePart(partId);
    this.activePart = partId;
    this.showToast(`请重新框选「${BODY_PARTS.find(p => p.id === partId)?.name ?? partId}」`);
    this.buildSidebar();
  }

  private undo(): void {
    if (this.history.length === 0) { this.showToast('没有可撤销的操作'); return; }
    const entry = this.history.pop()!;
    const name = BODY_PARTS.find(p => p.id === entry.partId)?.name ?? entry.partId;
    if (entry.action === 'add') {
      if (entry.region) { this.regions.set(entry.partId, entry.region); if (entry.cropImage) this.cropImages.set(entry.partId, entry.cropImage); }
      else { this.regions.delete(entry.partId); this.cropImages.delete(entry.partId); }
      this.showToast(`撤销：还原「${name}」`);
    } else if (entry.action === 'delete' && entry.region) {
      this.regions.set(entry.partId, entry.region);
      if (entry.cropImage) this.cropImages.set(entry.partId, entry.cropImage);
      this.showToast(`撤销：恢复「${name}」`);
    }
    this.buildSidebar(); this.buildActionBar(); this.draw();
  }

  // ── Context menu ──

  private showContextMenu(screenX: number, screenY: number, partId: string): void {
    this.hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'bp-ctx-menu';
    menu.style.left = `${screenX}px`;
    menu.style.top = `${screenY}px`;

    const label = document.createElement('div');
    label.className = 'bp-ctx-label';
    label.textContent = BODY_PARTS.find(p => p.id === partId)?.name ?? partId;
    menu.appendChild(label);

    for (const [text, cls, fn] of [
      ['重新框选', 'bp-ctx-item', () => this.redoPart(partId)],
      ['删除', 'bp-ctx-item bp-ctx-danger', () => this.deletePart(partId)],
    ] as [string, string, () => void][]) {
      const item = document.createElement('div');
      item.className = cls;
      item.textContent = text;
      item.addEventListener('click', () => { this.hideContextMenu(); fn(); });
      menu.appendChild(item);
    }

    this.root.appendChild(menu);
    this.contextMenu = menu;
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) { this.hideContextMenu(); this.root.removeEventListener('mousedown', dismiss); }
    };
    setTimeout(() => this.root.addEventListener('mousedown', dismiss), 0);
  }

  private hideContextMenu(): void { if (this.contextMenu) { this.contextMenu.remove(); this.contextMenu = null; } }

  private hitTestRegion(imgX: number, imgY: number): string | null {
    for (const [pid, r] of this.regions)
      if (imgX >= r.x && imgX <= r.x + r.w && imgY >= r.y && imgY <= r.y + r.h) return pid;
    return null;
  }

  // ── Canvas setup ──

  private fitCanvas(wrap: HTMLElement): void {
    const r = wrap.getBoundingClientRect();
    const dpr = this.dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.draw();
  }

  private loadImage(url: string): void {
    const img = new Image();
    img.onload = () => {
      this.image = img;
      const lw = this.logicalW, lh = this.logicalH;
      this.zoom = Math.min(lw / img.width, lh / img.height) * 0.85;
      this.panX = (lw - img.width * this.zoom) / 2;
      this.panY = (lh - img.height * this.zoom) / 2;
      this.draw();
      this.showToast('图片已加载，请选择左侧部位后框选');
    };
    img.src = url;
  }

  private toImg(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  private bindCanvas(wrap: HTMLElement): void {
    const c = this.canvas;

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (this.viewMode === 'preview') {
        if (this.selectedPreviewPart) {
          const off = this.partOffsets.get(this.selectedPreviewPart) ?? { x: 0, y: 0, scale: 1 };
          off.scale = Math.max(0.1, Math.min(5, off.scale + (e.deltaY < 0 ? 0.05 : -0.05)));
          this.partOffsets.set(this.selectedPreviewPart, off);
          this.buildSidebar(); this.draw(); return;
        }
        this.previewZoom = Math.max(0.01, Math.min(200, this.previewZoom * (e.deltaY < 0 ? 1.12 : 0.88)));
        this.draw(); return;
      }
      const f = e.deltaY < 0 ? 1.12 : 0.88;
      const nz = Math.max(0.01, Math.min(200, this.zoom * f));
      this.panX = mx - (mx - this.panX) * (nz / this.zoom);
      this.panY = my - (my - this.panY) * (nz / this.zoom);
      this.zoom = nz;
      this.draw();
    }, { passive: false });

    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

      if (this.viewMode === 'preview') { this.handlePreviewMouseDown(e, sx, sy); return; }

      if (e.button === 2) {
        const p = this.toImg(sx, sy);
        const hit = this.hitTestRegion(p.x, p.y);
        if (hit) this.showContextMenu(sx, sy, hit);
        return;
      }
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        this.interactionMode = 'panning';
        this.dragOrigin = { x: e.clientX, y: e.clientY };
        this.panOrigin = { x: this.panX, y: this.panY };
        c.style.cursor = 'grabbing'; return;
      }
      if (e.button === 0) {
        if (!this.activePart) { this.showToast('请先在左侧选择一个部位！'); return; }
        if (!this.image) { this.showToast('请先上传图片！'); return; }
        this.interactionMode = 'selecting';
        const p = this.toImg(sx, sy);
        this.dragOrigin = { x: p.x, y: p.y };
        this.selRect = { x: p.x, y: p.y, w: 0, h: 0 };
        c.style.cursor = 'crosshair';
      }
    });

    const onMove = (e: MouseEvent) => {
      if (this.viewMode === 'preview') { this.handlePreviewMouseMove(e); return; }
      if (this.interactionMode === 'panning') {
        this.panX = this.panOrigin.x + (e.clientX - this.dragOrigin.x);
        this.panY = this.panOrigin.y + (e.clientY - this.dragOrigin.y);
        this.draw();
      } else if (this.interactionMode === 'selecting' && this.selRect) {
        const rect = c.getBoundingClientRect();
        const p = this.toImg(e.clientX - rect.left, e.clientY - rect.top);
        this.selRect.w = p.x - this.dragOrigin.x;
        this.selRect.h = p.y - this.dragOrigin.y;
        this.draw();
      }
    };

    const onUp = () => {
      if (this.viewMode === 'preview') { this.previewDrag = null; this.interactionMode = 'idle'; c.style.cursor = 'default'; return; }
      if (this.interactionMode === 'selecting' && this.selRect && this.activePart) {
        let { x, y, w, h } = this.selRect;
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        if (w > 3 && h > 3) this.commitRegion(this.activePart, x, y, w, h);
        this.selRect = null;
      }
      this.interactionMode = 'idle';
      c.style.cursor = 'default';
      this.draw();
    };

    this.root.addEventListener('mousemove', onMove);
    this.root.addEventListener('mouseup', onUp);
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Preview interaction ──

  private handlePreviewMouseDown(e: MouseEvent, _sx: number, _sy: number): void {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.interactionMode = 'panning';
      this.dragOrigin = { x: e.clientX, y: e.clientY };
      this.panOrigin = { x: this.previewPanX, y: this.previewPanY };
      this.canvas.style.cursor = 'grabbing'; return;
    }
    if (e.button === 0 && this.selectedPreviewPart) {
      const off = this.partOffsets.get(this.selectedPreviewPart) ?? { x: 0, y: 0, scale: 1 };
      this.previewDrag = { startX: e.clientX, startY: e.clientY, origOx: off.x, origOy: off.y };
      this.canvas.style.cursor = 'move';
    }
  }

  private handlePreviewMouseMove(e: MouseEvent): void {
    if (this.interactionMode === 'panning') {
      this.previewPanX = this.panOrigin.x + (e.clientX - this.dragOrigin.x);
      this.previewPanY = this.panOrigin.y + (e.clientY - this.dragOrigin.y);
      this.draw(); return;
    }
    if (this.previewDrag && this.selectedPreviewPart) {
      const sc = this.previewZoom;
      const dx = (e.clientX - this.previewDrag.startX) / sc;
      const dy = -(e.clientY - this.previewDrag.startY) / sc;
      const off = this.partOffsets.get(this.selectedPreviewPart) ?? { x: 0, y: 0, scale: 1 };
      off.x = this.previewDrag.origOx + dx;
      off.y = this.previewDrag.origOy + dy;
      this.partOffsets.set(this.selectedPreviewPart, off);
      this.buildSidebar(); this.draw();
    }
  }

  // ── Commit with auto-shrink + forward-only advance ──

  private commitRegion(partId: string, x: number, y: number, w: number, h: number): void {
    if (!this.image) return;
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(w); tmp.height = Math.round(h);
    const tctx = tmp.getContext('2d')!;
    tctx.drawImage(this.image, x, y, w, h, 0, 0, w, h);

    const content = shrinkToContent(tmp, tctx);
    let fx = x, fy = y, fw = w, fh = h;
    if (content && (content.w < w * 0.95 || content.h < h * 0.95)) {
      fx = x + content.x; fy = y + content.y; fw = content.w; fh = content.h;
      tmp.width = Math.round(fw); tmp.height = Math.round(fh);
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      tctx.drawImage(this.image, fx, fy, fw, fh, 0, 0, fw, fh);
    }

    const oldRegion = this.regions.get(partId);
    const oldImg = this.cropImages.get(partId);
    this.history.push({ action: 'add', partId, region: oldRegion ? { ...oldRegion } : undefined, cropImage: oldImg });

    this.regions.set(partId, { partId, x: fx, y: fy, w: fw, h: fh });
    this.cropImages.set(partId, tmp.toDataURL('image/png'));
    this.onBind?.(partId, this.cropImages.get(partId)!);

    const partName = BODY_PARTS.find(p => p.id === partId)?.name ?? partId;
    const next = this.nextAvailablePart(partId);
    if (next) {
      this.activePart = next;
      this.showToast(`已绑定「${partName}」→ 下一个「${BODY_PARTS.find(p => p.id === next)?.name}」`);
    } else {
      this.activePart = null;
      this.showToast('所有部位已完成！可点击「自动绑骨」');
    }
    this.buildSidebar(); this.buildActionBar();
  }

  // ── Scale to template ──

  private isScaled = false;

  private computePPU(): number {
    const REF_DIMS: Record<string, { w: number; h: number }> = {
      head: { w: 141, h: 166 }, chest: { w: 186, h: 273 }, waist: { w: 175, h: 122 },
      upperarm_l: { w: 102, h: 156 }, forearm_l: { w: 64, h: 194 }, hand_l: { w: 61, h: 81 },
      upperarm_r: { w: 77, h: 134 }, forearm_r: { w: 73, h: 136 }, hand_r: { w: 63, h: 97 },
      thigh_l: { w: 116, h: 166 }, calf_l: { w: 97, h: 169 }, foot_l: { w: 80, h: 124 },
      thigh_r: { w: 100, h: 173 }, calf_r: { w: 81, h: 159 }, foot_r: { w: 115, h: 110 },
    };
    const samples: number[] = [];
    for (const [partId, region] of this.regions) {
      if (partId === 'weapon') continue;
      const ref = REF_DIMS[partId];
      if (!ref) continue;
      const cropMax = Math.max(region.w, region.h);
      const refMax = Math.max(ref.w, ref.h);
      if (refMax > 0) samples.push(cropMax / refMax);
    }
    samples.sort((a, b) => a - b);
    return samples.length > 0 ? samples[Math.floor(samples.length / 2)] : 1;
  }

  async scaleToTemplate(): Promise<void> {
    if (this.regions.size === 0) { this.showToast('请先标注部位'); return; }
    const ppu = this.computePPU();
    if (ppu < 1.05) { this.showToast('图像尺寸已与模板匹配，无需缩放'); this.isScaled = true; this.buildActionBar(); return; }

    this.showToast(`正在缩放 (×${(1/ppu).toFixed(2)})...`);
    const promises: Promise<void>[] = [];
    for (const [partId, region] of this.regions) {
      const dataUrl = this.cropImages.get(partId);
      if (!dataUrl) continue;
      const targetW = Math.max(2, Math.round(region.w / ppu));
      const targetH = Math.max(2, Math.round(region.h / ppu));

      promises.push(new Promise<void>((resolve) => {
        const src = new Image();
        src.onload = () => {
          const cvs = document.createElement('canvas');
          cvs.width = targetW; cvs.height = targetH;
          const c = cvs.getContext('2d')!;
          c.imageSmoothingEnabled = true;
          c.imageSmoothingQuality = 'high';
          c.drawImage(src, 0, 0, targetW, targetH);
          this.cropImages.set(partId, cvs.toDataURL('image/png'));
          this.regions.set(partId, { ...region, w: targetW, h: targetH });
          resolve();
        };
        src.onerror = () => resolve();
        src.src = dataUrl;
      }));
    }
    await Promise.all(promises);
    this.isScaled = true;
    this.showToast(`✅ 已缩放至模板尺寸 (ppu=${ppu.toFixed(2)})`);
    this.buildSidebar(); this.buildActionBar(); this.draw();
  }

  // ── Auto-bind ──

  private async autoBind(): Promise<void> {
    if (this.regions.size === 0) { this.showToast('请先标注至少一个部位'); return; }

    // Skip scaleToTemplate — keep original image resolution.
    // REF dimensions below define Spine-space sizes for each attachment.

    const skel = parseSpineJson(HUMANOID_TEMPLATE);
    computeWorldTransforms(skel.bones, skel.boneOrder);

    const REF: Record<string, { x: number; y: number; rot: number; w: number; h: number }> = {
      head:       { x:  70.00, y:  -3.00, rot:  -85.00, w: 141, h: 166 },
      chest:      { x: 110.00, y:   0.00, rot:  -94.00, w: 186, h: 273 },
      waist:      { x: -14.54, y: -17.01, rot:    0.00, w: 175, h: 122 },
      upperarm_l: { x:  34.31, y:  -3.97, rot:  110.53, w: 102, h: 156 },
      forearm_l:  { x:  76.61, y:  -4.44, rot:   93.53, w:  64, h: 194 },
      hand_l:     { x:  31.09, y:   5.13, rot:   85.76, w:  61, h:  81 },
      upperarm_r: { x:  42.58, y:   0.15, rot:   71.03, w:  77, h: 134 },
      forearm_r:  { x:  51.21, y:  -1.33, rot:   74.02, w:  73, h: 136 },
      hand_r:     { x:  41.50, y:  -0.21, rot:   77.94, w:  63, h:  97 },
      thigh_l:    { x:  72.33, y:   1.41, rot:  110.54, w: 116, h: 166 },
      calf_l:     { x:  54.17, y:   0.65, rot:  106.54, w:  97, h: 169 },
      foot_l:     { x:  49.50, y:  14.82, rot:   97.59, w:  80, h: 124 },
      thigh_r:    { x:  70.41, y:  -0.76, rot:   81.61, w: 100, h: 173 },
      calf_r:     { x:  55.25, y:   2.23, rot:   87.65, w:  81, h: 159 },
      foot_r:     { x:  44.56, y:  27.51, rot:   84.64, w: 115, h: 110 },
      weapon:     { x: 214.81, y:  -7.96, rot:  -89.64, w: 107, h: 545 },
    };

    const attachments = new Map<string, Map<string, RawAttachment>>();
    let boundCount = 0;
    for (const [partId] of this.cropImages) {
      const mapping = PART_TO_BONE[partId];
      if (!mapping) continue;
      const bone = skel.bones.get(mapping.bone);
      if (!bone) continue;
      const region = this.regions.get(partId);
      if (!region) continue;

      const r = REF[partId];
      let attX = Math.max(bone.length, 5) / 2;
      let attY = 0;
      let attRot = -bone.worldRotation;
      let attW = region.w;
      let attH = region.h;
      if (r) {
        attX = r.x;
        attY = r.y;
        attRot = r.rot;
        attW = r.w;
        attH = r.h;
      }
      const att: RawAttachment = {
        x:        attX,
        y:        attY,
        rotation: attRot,
        width:    attW,
        height:   attH,
      };

      const slotAtts = attachments.get(mapping.slot) ?? new Map();
      slotAtts.set(partId, att);
      attachments.set(mapping.slot, slotAtts);

      const slot = skel.slots.find(s => s.name === mapping.slot);
      if (slot) slot.attachmentName = partId;

      const img = new Image();
      img.src = this.cropImages.get(partId)!;
      this.previewImages.set(partId, img);
      if (!this.partOffsets.has(partId)) this.partOffsets.set(partId, { x: 0, y: 0, scale: 1 });
      boundCount++;
    }
    skel.skinAttachments = attachments;
    this.previewSkeleton = skel;
    this.showToast(`绑骨完成！已绑定 ${boundCount} 个部位（含武器）`);
    this.buildActionBar();
  }

  private buildAutoMesh(
    skel: EditorSkeleton, targetBone: any,
    attW: number, attH: number, baseX: number, baseY: number, baseRot: number
  ): RawAttachment {
    const cols = 4, rows = 4;
    const uvs: number[] = [];
    const localVerts: { x: number, y: number, r: number, c: number }[] = [];
    const vertexMap = new Map<string, number>();

    const addVert = (c: number, r: number) => {
      const u = c / cols;
      const v = r / rows;
      uvs.push(u, v);
      // Spine attachment local space: 0,0 is center
      const lx = (u - 0.5) * attW;
      const ly = (0.5 - v) * attH; // v=0 is top (+Y in spine), v=1 is bottom (-Y)
      const idx = localVerts.length;
      localVerts.push({ x: lx, y: ly, r, c });
      vertexMap.set(`${c},${r}`, idx);
      return idx;
    };

    // Hull (clockwise) - required by Spine JSON format
    for (let c = 0; c < cols; c++) addVert(c, 0); // Top
    for (let r = 0; r < rows; r++) addVert(cols, r); // Right
    for (let c = cols; c > 0; c--) addVert(c, rows); // Bottom
    for (let r = rows; r > 0; r--) addVert(0, r); // Left
    const hull = localVerts.length;

    // Inner vertices
    for (let r = 1; r < rows; r++) {
      for (let c = 1; c < cols; c++) {
        addVert(c, r);
      }
    }

    // Triangles
    const triangles: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = vertexMap.get(`${c},${r}`)!;
        const i1 = vertexMap.get(`${c + 1},${r}`)!;
        const i2 = vertexMap.get(`${c},${r + 1}`)!;
        const i3 = vertexMap.get(`${c + 1},${r + 1}`)!;
        triangles.push(i0, i1, i2);
        triangles.push(i1, i3, i2);
      }
    }

    // Find candidate bones for weighting (target and descendants)
    const candidates = new Set<string>();
    candidates.add(targetBone.name);
    const q = [targetBone.name];
    while (q.length > 0) {
      const b = skel.bones.get(q.shift()!)!;
      for (const child of b.children) {
        candidates.add(child);
        q.push(child);
      }
    }

    const candidateBones = Array.from(candidates).map(name => skel.bones.get(name)!);
    const boneIndices = new Map<string, number>();
    for (let i = 0; i < skel.boneOrder.length; i++) boneIndices.set(skel.boneOrder[i], i);

    const distToSegment = (px: number, py: number, vx: number, vy: number, wx: number, wy: number) => {
      const l2 = (wx - vx) ** 2 + (wy - vy) ** 2;
      if (l2 === 0) return Math.sqrt((px - vx) ** 2 + (py - vy) ** 2);
      let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.sqrt((px - (vx + t * (wx - vx))) ** 2 + (py - (vy + t * (wy - vy))) ** 2);
    };

    const rad = baseRot * Math.PI / 180;
    const acos = Math.cos(rad), asin = Math.sin(rad);
    const vertices: number[] = [];

    for (const lv of localVerts) {
      // Vertex position in targetBone's local space
      const bx = baseX + lv.x * acos - lv.y * asin;
      const by = baseY + lv.x * asin + lv.y * acos;

      // Vertex position in WORLD space
      const wx = targetBone.worldX + bx * targetBone.worldA + by * targetBone.worldB;
      const wy = targetBone.worldY + bx * targetBone.worldC + by * targetBone.worldD;

      // Calculate weights based on distance to bones
      const weights: { idx: number, w: number }[] = [];
      let totalW = 0;
      for (const cb of candidateBones) {
        const vx = cb.worldX, vy = cb.worldY;
        const wx_b = vx + cb.worldA * cb.length;
        const wy_b = vy + cb.worldC * cb.length;

        let d = distToSegment(wx, wy, vx, vy, wx_b, wy_b);
        if (d < 1) d = 1;
        const w = 1 / (d * d); // Inverse square law for weight falloff
        weights.push({ idx: boneIndices.get(cb.name)!, w });
        totalW += w;
      }

      // Keep top 3 closest bones
      weights.sort((a, b) => b.w - a.w);
      const top = weights.slice(0, 3);
      let topW = 0;
      for (const tw of top) topW += tw.w;
      top.forEach(tw => tw.w /= topW);

      vertices.push(top.length);
      for (const tw of top) {
        const cb = skel.bones.get(skel.boneOrder[tw.idx])!;
        // Inverse transform: world -> local of cb
        const dx = wx - cb.worldX;
        const dy = wy - cb.worldY;
        const det = cb.worldA * cb.worldD - cb.worldB * cb.worldC;
        let cblx = 0, cbly = 0;
        if (Math.abs(det) > 1e-6) {
          cblx = (dx * cb.worldD - dy * cb.worldB) / det;
          cbly = (-dx * cb.worldC + dy * cb.worldA) / det;
        }
        vertices.push(tw.idx, +cblx.toFixed(2), +cbly.toFixed(2), +tw.w.toFixed(3));
      }
    }

    return {
      type: 'mesh',
      width: attW,
      height: attH,
      uvs: uvs.map(v => +v.toFixed(4)),
      triangles,
      vertices,
      hull
    };
  }

  // ── Canvas BG removal ──

  private canvasRemoveBg(): void {
    let processed = 0;
    const total = this.cropImages.size;
    if (total === 0) { this.showToast('没有可处理的部位'); return; }
    this.showToast(`正在 Canvas 抠图 (${total} 个部位)...`);

    for (const [partId, dataUrl] of this.cropImages) {
      const img = new Image();
      img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = img.width; cvs.height = img.height;
        const c = cvs.getContext('2d')!;
        c.drawImage(img, 0, 0);
        const imgData = c.getImageData(0, 0, cvs.width, cvs.height);
        const d = imgData.data;
        const corners = [[0, 0], [cvs.width - 1, 0], [0, cvs.height - 1], [cvs.width - 1, cvs.height - 1]];
        let bgR = 0, bgG = 0, bgB = 0;
        for (const [cx, cy] of corners) { const i = (cy * cvs.width + cx) * 4; bgR += d[i]; bgG += d[i + 1]; bgB += d[i + 2]; }
        bgR /= 4; bgG /= 4; bgB /= 4;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - bgR) < 55 && Math.abs(d[i + 1] - bgG) < 55 && Math.abs(d[i + 2] - bgB) < 55) d[i + 3] = 0;
        }
        c.putImageData(imgData, 0, 0);
        const content = shrinkToContent(cvs, c);
        if (content) {
          const t2 = document.createElement('canvas');
          t2.width = content.w; t2.height = content.h;
          t2.getContext('2d')!.drawImage(cvs, content.x, content.y, content.w, content.h, 0, 0, content.w, content.h);
          this.cropImages.set(partId, t2.toDataURL('image/png'));
        } else { this.cropImages.set(partId, cvs.toDataURL('image/png')); }
        processed++;
        if (processed === total) { this.showToast(`Canvas 抠图完成！处理了 ${processed} 个部位`); this.buildSidebar(); this.draw(); }
      };
      img.src = dataUrl;
    }
  }

  // ── Export ──

  private async exportSpineJson(): Promise<void> {
    if (!this.previewSkeleton) await this.autoBind();
    const json: RawSpineJson = JSON.parse(JSON.stringify(HUMANOID_TEMPLATE));
    this.injectAttachmentData(json);

    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'character-binding.json'; a.click();
    const imgMap: Record<string, string> = {};
    for (const [partId, du] of this.cropImages) imgMap[partId] = du;
    const ib = new Blob([JSON.stringify(imgMap)], { type: 'application/json' });
    const ia = document.createElement('a'); ia.href = URL.createObjectURL(ib); ia.download = 'character-images.json'; ia.click();
    this.showToast('已导出 character-binding.json 和 character-images.json');
  }

  private async loadToEditor(): Promise<void> {
    if (!this.previewSkeleton) { this.showToast('请先自动绑骨'); return; }
    const json: RawSpineJson = JSON.parse(JSON.stringify(HUMANOID_TEMPLATE));
    this.injectAttachmentData(json);
    this.onAutoBindComplete?.(this.previewSkeleton, json, new Map(this.cropImages));
    this.showToast('已加载到骨骼编辑器');
  }

  private injectAttachmentData(json: RawSpineJson): void {
    const skel = this.previewSkeleton;
    if (!skel) return;
    const attachments: Record<string, Record<string, RawAttachment>> = {};
    for (const [slotName, atts] of skel.skinAttachments) {
      attachments[slotName] = {};
      for (const [attName, att] of atts) {
        attachments[slotName][attName] = { ...att };
      }
    }
    if (json.skins && json.skins.length > 0) {
      json.skins[0].attachments = attachments;
    } else {
      json.skins = [{ name: 'default', attachments }];
    }
    for (const slot of json.slots) {
      for (const [partId, mapping] of Object.entries(PART_TO_BONE)) {
        if (mapping.slot === slot.name && this.cropImages.has(partId)) {
          slot.attachment = partId;
        }
      }
    }
  }

  // ── Draw ──

  draw(): void {
    if (this.viewMode === 'preview') this.drawPreview();
    else this.drawAnnotate();
  }

  private drawAnnotate(): void {
    const { ctx } = this;
    const dpr = this.dpr;
    const W = this.logicalW, H = this.logicalH;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const sz = 16;
    for (let i = 0; i < Math.ceil(W / sz); i++)
      for (let j = 0; j < Math.ceil(H / sz); j++) {
        ctx.fillStyle = (i + j) % 2 ? '#252525' : '#1e1e1e';
        ctx.fillRect(i * sz, j * sz, sz, sz);
      }

    if (!this.image) {
      ctx.fillStyle = '#555'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('点击右上角「上传图片」', W / 2, H / 2);
      ctx.restore(); return;
    }

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.drawImage(this.image, 0, 0);

    for (const [pid, r] of this.regions) {
      const part = BODY_PARTS.find(p => p.id === pid);
      const col = part?.color ?? '#fff';
      ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2 / this.zoom; ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(12, 14 / this.zoom)}px sans-serif`;
      ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
      ctx.fillText(part?.name ?? pid, r.x + 4 / this.zoom, r.y - 4 / this.zoom);
      ctx.shadowBlur = 0;
    }

    if (this.selRect) {
      const part = BODY_PARTS.find(p => p.id === this.activePart);
      ctx.strokeStyle = part?.color ?? '#0f0'; ctx.lineWidth = 2 / this.zoom;
      ctx.setLineDash([6 / this.zoom, 4 / this.zoom]);
      ctx.strokeRect(this.selRect.x, this.selRect.y, this.selRect.w, this.selRect.h);
      ctx.setLineDash([]);
      if (part) {
        ctx.fillStyle = part.color;
        ctx.font = `bold ${Math.max(12, 14 / this.zoom)}px sans-serif`;
        ctx.fillText(part.name, this.selRect.x + 4 / this.zoom, this.selRect.y - 4 / this.zoom);
      }
    }
    ctx.restore();
    ctx.restore();
  }

  private drawPreview(): void {
    const { ctx } = this;
    const dpr = this.dpr;
    const W = this.logicalW, H = this.logicalH;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, H);

    if (!this.previewSkeleton) {
      ctx.fillStyle = '#555'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('请先点击「自动绑骨」', W / 2, H / 2);
      ctx.restore(); return;
    }

    const skel = this.previewSkeleton;
    computeWorldTransforms(skel.bones, skel.boneOrder);
    if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik);

    const cx = W / 2 + this.previewPanX;
    const cy = H / 2 + this.previewPanY;
    const z = this.previewZoom;

    // Grid
    ctx.fillStyle = 'rgba(80,70,55,0.15)';
    const sp = 50 * z;
    if (sp >= 10) {
      const gx = ((cx % sp) - sp) % sp, gy = ((cy % sp) - sp) % sp;
      for (let x = gx; x < W; x += sp) for (let y = gy; y < H; y += sp) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
    }

    // Origin
    ctx.strokeStyle = 'rgba(255,200,100,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - 30, cy); ctx.lineTo(cx + 30, cy);
    ctx.moveTo(cx, cy - 30); ctx.lineTo(cx, cy + 30); ctx.stroke();

    // Images at bone positions
    for (const [partId, img] of this.previewImages) {
      const mapping = PART_TO_BONE[partId];
      if (!mapping) continue;
      const bone = skel.bones.get(mapping.bone);
      if (!bone || !img.complete || img.width === 0) continue;
      const off = this.partOffsets.get(partId) ?? { x: 0, y: 0, scale: 1 };

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

      const imgX = cx + (worldX + off.x) * z;
      const imgY = cy - (worldY + off.y) * z;
      const totalRot = (bone.worldRotation + attRot) * Math.PI / 180;
      const dw = attW * off.scale * z;
      const dh = attH * off.scale * z;

      ctx.save();
      ctx.translate(imgX, imgY);
      ctx.rotate(-totalRot);
      ctx.globalAlpha = this.selectedPreviewPart === partId ? 1 : 0.85;
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      if (this.selectedPreviewPart === partId) {
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]); ctx.strokeRect(-dw / 2, -dh / 2, dw, dh); ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Bone overlay
    ctx.globalAlpha = 0.5;
    for (const name of skel.boneOrder) {
      const bone = skel.bones.get(name)!;
      if (!bone.parent) continue;
      const bx = cx + bone.worldX * z, by = cy - bone.worldY * z;
      if (bone.length > 0) {
        const rad = bone.worldRotation * Math.PI / 180;
        const ex = bx + Math.cos(rad) * bone.length * z;
        const ey = by - Math.sin(rad) * bone.length * z;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey);
        ctx.strokeStyle = '#44cc66'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4444'; ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Labels
    ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'left';
    for (const [partId] of this.cropImages) {
      const mapping = PART_TO_BONE[partId];
      if (!mapping) continue;
      const bone = skel.bones.get(mapping.bone);
      if (!bone) continue;
      ctx.fillText(BODY_PARTS.find(p => p.id === partId)?.name ?? partId, cx + bone.worldX * z + 8, cy - bone.worldY * z - 6);
    }
    ctx.restore();
  }

  private showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout((this as any)._toastTimer);
    (this as any)._toastTimer = setTimeout(() => this.toast.classList.remove('show'), 2500);
  }

  // ── Public API for programmatic usage (AutoBindTab) ──

  loadImageFromDataUrl(dataUrl: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.image = img;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.regions.clear();
        this.cropImages.clear();
        this.skippedParts.clear();
        this.history = [];
        this.previewSkeleton = null;
        this.previewImages.clear();
        this.isScaled = false;
        this.activePart = BODY_PARTS[0].id;
        this.viewMode = 'annotate';
        this.buildSidebar();
        this.buildActionBar();
        this.draw();
        resolve();
      };
      img.src = dataUrl;
    });
  }

  addRegionProgrammatically(partId: string, x: number, y: number, w: number, h: number, imageData: string): void {
    this.regions.set(partId, { partId, x, y, w, h });
    this.cropImages.set(partId, imageData);
  }

  async triggerAutoBind(): Promise<void> {
    await this.autoBind();
    if (this.previewSkeleton) {
      const json: RawSpineJson = JSON.parse(JSON.stringify(HUMANOID_TEMPLATE));
      this.injectAttachmentData(json);

      try {
        const resp = await fetch('/spine-assets/male-template/skeleton.json');
        if (resp.ok) {
          const defaultSkel = await resp.json();
          if (defaultSkel.animations) {
            json.animations = { ...(defaultSkel.animations as Record<string, any>), ...(json.animations ?? {}) };
          }
        }
      } catch { /* keep template animations only */ }

      this.onAutoBindComplete?.(this.previewSkeleton, json, new Map(this.cropImages));
    }
  }

  clearAllRegions(): void {
    this.regions.clear();
    this.cropImages.clear();
    this.skippedParts.clear();
    this.history = [];
    this.previewSkeleton = null;
    this.previewImages.clear();
    this.isScaled = false;
    this.buildSidebar();
    this.buildActionBar();
    this.draw();
  }

  getBodyParts(): typeof BODY_PARTS { return BODY_PARTS; }
  getPartToBone(): typeof PART_TO_BONE { return PART_TO_BONE; }
}
