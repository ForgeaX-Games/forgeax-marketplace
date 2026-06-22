// @source wb-character/src/pipelines/spine/editor/ExplosionTab.ts
import type { StudioState, StudioTab, TabId, PartRegion } from './StudioState';
import { globalState } from '../../../shared/GlobalState';

const TEMPLATE_MALE_URL = './assets/spine/template_parts_male.png';
const TEMPLATE_FEMALE_URL = './assets/spine/template_parts_female.png';

// Processing order: torso → upper arms → forearms → thighs → calves → feet → hands → weapon.
// Hands come AFTER thighs to prevent hand seeds from stealing thigh pixels.
const PART_NAMES = [
  '头部', '上胸', '腰/骨盆',
  '左上臂', '右上臂',
  '左前臂', '右前臂',
  '左大腿', '右大腿',
  '左小腿', '右小腿',
  '左脚', '右脚',
  '左手', '右手',
  '武器',
];

const PART_IDS = [
  'head', 'chest', 'waist',
  'upperarm_l', 'upperarm_r',
  'forearm_l', 'forearm_r',
  'thigh_l', 'thigh_r',
  'calf_l', 'calf_r',
  'foot_l', 'foot_r',
  'hand_l', 'hand_r',
  'weapon',
];

const PART_COLORS = [
  '#ff6b6b', '#ffa94d', '#ffe066',
  '#74c0fc', '#4dabf7', '#339af0',
  '#38d9a9', '#63e6be', '#51cf66',
  '#b197fc', '#9775fa', '#845ef7',
  '#f783ac', '#e64980', '#cc5de8',
  '#ff922b',
];

async function apiPost(url: string, body: any): Promise<any> {
  try {
    const payload = JSON.stringify(body);
    console.log(`[Spine API] POST ${url}, payload size: ${(payload.length / 1024).toFixed(0)}KB`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return res.json();
  } catch (e: any) {
    console.error('[Spine API] fetch error:', e);
    return { success: false, error: e.message || 'Network error' };
  }
}

function imageToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:[^;]+;base64,/, '');
}

/** Always re-encode via canvas so Gemini receives valid JPEG bytes (fixes corrupt localStorage blobs). */
async function prepareImageForApi(
  input: string,
  maxW: number,
  maxH: number,
  quality = 0.85,
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = input.startsWith('data:') ? input : await loadImageAsDataUrl(input);

  const blob = await fetch(dataUrl).then((r) => r.blob()).catch(() => null);
  if (!blob || blob.size < 32) {
    throw new Error('图片数据为空或已损坏，请重新上传角色设定图');
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return prepareImageForApiViaImage(dataUrl, maxW, maxH, quality);
  }

  try {
    const scale = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 不可用');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const out = c.toDataURL('image/jpeg', quality);
    return { base64: imageToBase64(out), mimeType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

function prepareImageForApiViaImage(
  dataUrl: string,
  maxW: number,
  maxH: number,
  quality = 0.85,
): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const out = c.toDataURL('image/jpeg', quality);
      resolve({ base64: imageToBase64(out), mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('图片无法解码，请重新上传 PNG/JPEG 格式的角色设定图'));
    img.src = dataUrl;
  });
}

async function fetchPortraitFromDisk(): Promise<string | null> {
  const slug = globalState.getSlug();
  const charId = globalState.get().profile.charId;
  if (!slug || !charId) return null;

  const relPaths = ['portrait/current.png', 'portrait/front.png'];
  for (const rel of relPaths) {
    const path = `.forgeax/games/${slug}/characters/${charId}/${rel}`;
    try {
      const dataUrl = await loadImageAsDataUrl(
        `/api/wb/character/asset?path=${encodeURIComponent(path)}`,
      );
      if (dataUrl) return dataUrl;
    } catch {
      // try next path
    }
  }

  try {
    const res = await fetch(
      `/api/wb/character/characters/${encodeURIComponent(charId)}?slug=${encodeURIComponent(slug)}`,
    );
    if (!res.ok) return null;
    const j = await res.json() as {
      urls?: Record<string, string>
      manifest?: { portrait?: Record<string, string> }
    };
    const portraitUrl =
      j.urls?.['portrait/front'] ??
      (j.manifest?.portrait?.front
        ? `/api/wb/character/asset?path=${encodeURIComponent(
            `.forgeax/games/${slug}/characters/${charId}/${j.manifest.portrait.front}`,
          )}`
        : null);
    if (!portraitUrl) return null;
    return await loadImageAsDataUrl(portraitUrl);
  } catch {
    return null;
  }
}

async function prepareCharacterImageForApi(
  characterImage: string,
  maxW: number,
  maxH: number,
  quality = 0.85,
): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  const sources = [characterImage];
  const disk = await fetchPortraitFromDisk();
  if (disk && disk !== characterImage) sources.push(disk);

  let lastErr: Error | null = null;
  for (const src of sources) {
    try {
      const prepared = await prepareImageForApi(src, maxW, maxH, quality);
      const dataUrl = `data:${prepared.mimeType};base64,${prepared.base64}`;
      return { ...prepared, dataUrl };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn('[Spine] character image prepare failed, len=', src.length, lastErr.message);
    }
  }
  throw lastErr ?? new Error('图片无法解码，请重新上传 PNG/JPEG 格式的角色设定图');
}

async function loadImageAsDataUrl(url: string): Promise<string> {
  // 先走 fetch→blob→FileReader 这条路:同源静态资源无需 CORS,且不依赖 <img>
  // 的格式嗅探。早期模板图(template_parts_female)曾是 JPEG 字节却用 .png 后缀,
  // Tauri WKWebView 在 MIME(image/png) 与真实字节(JPEG)不符时会让 <img> 直接
  // onerror,导致 Spine 全流程在 Step 0 崩。fetch 不做 MIME 校验,blob 原样返回,
  // 直接 readAsDataURL 得到合法 image dataURL(下游 imageToBase64 只需要 base64
  // 体,不在乎是 png 还是 jpeg,Gemini 那边按真实 mimeType 解析即可),省掉再过一次
  // <img>+canvas 的脆弱环节。fetch 不可用(如 file://)时才回退到 <img> 方案。
  try {
    const resp = await fetch(url, { cache: 'no-cache' });
    if (resp.ok) {
      const blob = await resp.blob();
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error(`FileReader 读取失败: ${url}`));
        fr.readAsDataURL(blob);
      });
    }
    console.warn('[Spine] loadImageAsDataUrl fetch 非 200,回退 <img>:', url, resp.status);
  } catch (e) {
    console.warn('[Spine] loadImageAsDataUrl fetch 异常,回退 <img>:', url, e);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(`<img> 加载失败: ${url}`));
    img.src = url;
  });
}

async function canDecodeImageDataUrl(src: string): Promise<boolean> {
  try {
    const dataUrl = src.startsWith('data:') ? src : await loadImageAsDataUrl(src)
    if (!dataUrl) return false
    const blob = await fetch(dataUrl).then((r) => r.blob())
    if (!blob || blob.size < 32) return false
    const bmp = await createImageBitmap(blob)
    bmp.close()
    return true
  } catch {
    return false
  }
}

const PARTS_TEMPLATE = `You are generating a CHARACTER PARTS BREAKDOWN sheet for 2D skeletal animation (Spine 2D).

You have two reference images:
1. LAYOUT TEMPLATE: A portrait-oriented image showing 15 disconnected body parts and 1 large weapon on a pure white background. Each part is completely separated from every other part with visible white space between them.
2. CHARACTER DESIGN: A detailed character concept sheet of [ENTER_BRIEF_CHARACTER_IDENTITY].

CRITICAL RULES:
1. STRICT LAYOUT MATCH: You MUST keep the exact same layout, scale, and positioning of all 16 parts as shown in the LAYOUT TEMPLATE. Each part must be in the same position on the canvas as in the template.
2. PARTS MUST BE DISCONNECTED: Every single part must be a separate, isolated piece with clear white space around it on ALL sides. No part may touch, overlap, or connect to any other part. Like a disassembled puppet with pieces spread apart.
3. The template character is a placeholder. Completely replace with [ENTER_BRIEF_CHARACTER_IDENTITY] from the CHARACTER DESIGN — including body proportions, clothing, and weapon.
4. The character's HEAD MUST BE FACING RIGHT. Do NOT draw facing left or forward.
5. At joints (shoulders, elbows, knees), draw smooth rounded overlaps (padding) for animation. But the parts themselves must NOT touch each other on the sheet.
6. Pure white background. No boxes, frames, or colored backgrounds.

=== GENERATE THESE 16 ISOLATED PARTS EXACTLY WHERE THEY ARE ===

1. [Top Center, Head]: [ENTER_HEAD_DESC]. FACE MUST FACE RIGHT. Rounded neck base.
2. [Row 2 Left, Right Upper Arm]: [ENTER_R_UPPER_ARM].
3. [Row 2 Center, Chest/Torso]: [ENTER_CHEST_DESC]. Rounded extended bottom edge.
4. [Row 2 Right, Left Upper Arm]: [ENTER_L_UPPER_ARM].
5. [Row 3 Left, Right Forearm]: [ENTER_R_FOREARM]. Rounded padding at elbow.
6. [Row 3 Center, Waist/Pelvis]: [ENTER_WAIST_DESC].
7. [Row 3 Right, Left Forearm]: [ENTER_L_FOREARM]. Rounded padding at elbow.
8. [Row 4 Far Left, Right Hand]: [ENTER_R_HAND].
9. [Row 4 Center-Left, Right Thigh]: [ENTER_R_THIGH].
10. [Row 4 Center-Right, Left Thigh]: [ENTER_L_THIGH].
11. [Row 4 Far Right, Left Hand]: [ENTER_L_HAND].
12. [Row 5 Left, Left Calf]: [ENTER_L_CALF].
13. [Row 5 Right, Right Calf]: [ENTER_R_CALF].
14. [Row 6 Left, Left Boot]: [ENTER_L_BOOT].
15. [Row 6 Right, Right Boot]: [ENTER_R_BOOT].
16. [Far Right Vertical, Weapon]: [ENTER_WEAPON_DESC]. Perfectly VERTICAL orientation.

Style: [ENTER_STYLE_KEYWORDS]. All 16 parts completely isolated on a pure white background.`;

export class ExplosionTab implements StudioTab {
  readonly id: TabId = 'explosion';
  readonly container: HTMLDivElement;
  readonly sidePanel: HTMLDivElement;
  readonly centerView: HTMLDivElement;
  readonly centerToolbar = null;
  readonly bottomPanel = null;
  readonly rightPanel = null;

  private state: StudioState | null = null;
  private onStateChange: (() => void) | null = null;

  private annotCanvas: HTMLCanvasElement | null = null;
  private annotCtx: CanvasRenderingContext2D | null = null;
  private annotImg: HTMLImageElement | null = null;
  private annotZoom = 1;
  private annotPanX = 0;
  private annotPanY = 0;
  private annotMode: 'auto' | 'manual' = 'auto';
  private selRect: { x: number; y: number; w: number; h: number } | null = null;
  private dragOrigin = { x: 0, y: 0 };
  private interactionMode: 'idle' | 'panning' | 'selecting' = 'idle';
  private panOrigin = { x: 0, y: 0 };
  private hoveredRegion = -1;
  private selectedRegion = -1;
  private swapSource = -1;
  private manualTarget = -1;
  private annotRafId = 0;
  private resizeObs: ResizeObserver | null = null;
  private generating = false;
  private lastPrompt = '';

  constructor(parent: HTMLElement, onStateChange: () => void) {
    this.onStateChange = onStateChange;
    this.container = document.createElement('div');
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.sidePanel = document.createElement('div');
    this.sidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    this.centerView = document.createElement('div');
    this.centerView.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;';

    this.buildUI();
  }

  private q(selector: string): HTMLElement | null {
    return this.sidePanel.querySelector(selector) ?? this.centerView.querySelector(selector) ?? null;
  }

  private buildUI(): void {
    this.sidePanel.innerHTML = `
      <div class="expl-sidebar-scroll" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;">
        <div class="sd-section-title" style="display:flex;align-items:center;gap:6px;">
          拆件模板
          <div id="expl-gender-toggle" style="margin-left:auto;display:flex;gap:2px;">
            <button class="expl-gender-btn expl-gender-active" data-gender="male" style="font-size:10px;padding:2px 8px;border-radius:3px;border:1px solid rgba(232,196,138,0.3);background:rgba(232,196,138,0.15);color:#e8c48a;cursor:pointer;">♂ 男</button>
            <button class="expl-gender-btn" data-gender="female" style="font-size:10px;padding:2px 8px;border-radius:3px;border:1px solid rgba(232,196,138,0.15);background:transparent;color:rgba(232,196,138,0.5);cursor:pointer;">♀ 女</button>
          </div>
        </div>
        <div class="expl-tmpl-preview" id="expl-tmpl-preview">
          <img id="expl-tmpl-img" class="expl-tmpl-img" src="${this.getTemplateUrl()}" alt="角色拆分模板">
        </div>
        <div class="expl-tmpl-info" style="font-size:10px;opacity:0.6;text-align:center;">
          白底实体模板 · 16 部件（含武器）
        </div>

        <div class="expl-divider"></div>
        <div class="sd-section-title">一键生成流程</div>
        <div class="expl-steps-info">
          <div class="expl-step-item"><span class="expl-step-num">1</span><span>Gemini 3.0 Pro 看图 → 生成提示词</span></div>
          <div class="expl-step-item"><span class="expl-step-num">2</span><span>Nano Banana 2 生成拆件图</span></div>
          <div class="expl-step-item"><span class="expl-step-num">3</span><span>一键抠图（去白底）</span></div>
        </div>

        <div class="expl-divider"></div>
        <div class="expl-actions">
          <button class="sd-gen-btn" id="expl-gen-parts" disabled>
            🎨 一键生成角色拆件图
          </button>
          <div class="cd-progress" id="expl-progress" style="display:none">
            <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
            <div class="cd-progress-text" id="expl-progress-text">生成中...</div>
          </div>
          <button class="sd-gen-btn" id="expl-reroll" style="display:none;">
            🔄 不满意，重新抽卡
          </button>
          <button class="sd-gen-btn" id="expl-remove-bg" disabled>
            🧹 一键抠图（去白底）
          </button>
          <button class="sd-gen-btn" id="expl-auto-crop" disabled>
            ✂️ 自动标注部件
          </button>
          <button class="sd-gen-btn" id="expl-manual-crop" disabled>
            ✋ 手动标注部件
          </button>
          <button class="studio-next-btn" id="expl-confirm" disabled style="margin-top:8px;">确认 → 进入绑骨</button>
        </div>

        <div class="expl-divider"></div>
        <div class="expl-upload-row" style="display:flex;gap:6px;">
          <button class="sd-action-btn" id="expl-upload-result" style="flex:1;font-size:11px;">📤 上传已有拆件图</button>
        </div>

        <div class="expl-divider"></div>
        <div class="sd-section-title" style="display:flex;align-items:center;gap:6px;">
          📋 历史记录
          <button class="sd-action-btn" id="expl-refresh-history" style="font-size:10px;padding:2px 8px;margin-left:auto;">刷新</button>
        </div>
        <div id="expl-history-list" style="max-height:180px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;"></div>
      </div>
    `;

    this.centerView.innerHTML = `
      <div class="expl-previews" style="flex:1;display:flex;align-items:stretch;gap:0;padding:16px;min-height:0;">
        <div class="expl-preview-panel" style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div class="sd-section-title">角色设定图</div>
          <div class="expl-source-box" id="expl-source" style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.3);border-radius:10px;border:1px solid rgba(232,196,138,0.1);overflow:hidden;position:relative;">
            <div class="sd-preview-empty">
              <div class="sd-preview-empty-icon">🖼️</div>
              <div>请先在"角色设计"完成角色</div>
            </div>
          </div>
          <div class="expl-upload-row"><button class="sd-action-btn" id="expl-upload-btn">📤 上传角色设定图</button></div>
        </div>
        <div class="expl-arrow-col" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:60px;flex-shrink:0;">
          <div class="expl-arrow">→</div>
          <div class="expl-arrow-label">Claude<br>+<br>Gemini</div>
        </div>
        <div class="expl-preview-panel" style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <div class="sd-section-title" id="expl-right-title">拆件图结果</div>
          <div class="expl-result-box" id="expl-result" style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,0.3);border-radius:10px;border:1px solid rgba(232,196,138,0.1);overflow:hidden;position:relative;">
            <div class="sd-preview-empty">
              <div class="sd-preview-empty-icon">✂️</div>
              <div>点击「一键生成角色拆件图」</div>
              <div class="sd-preview-tip">Claude 分析 → Gemini 生成 → 自动抠图</div>
            </div>
          </div>
          <div class="expl-upload-row"><button class="sd-action-btn" id="expl-upload-result2">📤 上传拆件图</button></div>
        </div>
      </div>
    `;

    this.q('#expl-upload-btn')?.addEventListener('click', () => this.pickImage('source'));
    this.q('#expl-upload-result')?.addEventListener('click', () => this.pickImage('result'));
    this.q('#expl-upload-result2')?.addEventListener('click', () => this.pickImage('result'));
    this.q('#expl-gen-parts')?.addEventListener('click', () => this.runFullPipeline());
    this.q('#expl-reroll')?.addEventListener('click', () => this.reroll());
    this.q('#expl-remove-bg')?.addEventListener('click', () => this.removeWhiteBackground());
    this.q('#expl-auto-crop')?.addEventListener('click', () => this.enterAnnotateMode('auto'));
    this.q('#expl-manual-crop')?.addEventListener('click', () => this.enterAnnotateMode('manual'));
    this.q('#expl-confirm')?.addEventListener('click', () => this.confirm());
    this.q('#expl-refresh-history')?.addEventListener('click', () => this.loadHistory());

    for (const btn of this.sidePanel.querySelectorAll<HTMLButtonElement>('.expl-gender-btn')) {
      btn.addEventListener('click', () => {
        const gender = btn.dataset.gender as 'male' | 'female';
        try { (window as any).__globalState = (window as any).__globalState || {}; ((window as any).__globalState.profile = (window as any).__globalState.profile || {}).gender = gender; } catch {}
        const url = gender === 'female' ? TEMPLATE_FEMALE_URL : TEMPLATE_MALE_URL;
        const img = this.q('#expl-tmpl-img') as HTMLImageElement;
        if (img) img.src = url;
        for (const b of this.sidePanel.querySelectorAll<HTMLButtonElement>('.expl-gender-btn')) {
          const active = b.dataset.gender === gender;
          b.classList.toggle('expl-gender-active', active);
          b.style.background = active ? 'rgba(232,196,138,0.15)' : 'transparent';
          b.style.color = active ? '#e8c48a' : 'rgba(232,196,138,0.5)';
          b.style.borderColor = active ? 'rgba(232,196,138,0.3)' : 'rgba(232,196,138,0.15)';
        }
      });
    }

    this.setupDropZone('#expl-source', 'source');
    this.setupDropZone('#expl-result', 'result');

    this.loadHistory();
  }

  private setupDropZone(selector: string, target: 'source' | 'result'): void {
    const el = this.q(selector) as HTMLElement;
    if (!el) return;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', (e) => { e.preventDefault(); el.classList.remove('drag-over'); });
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file && file.type.startsWith('image/')) this.handleImage(file, target);
    });
  }

  private pickImage(target: 'source' | 'result'): void {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = () => { const f = input.files?.[0]; if (f) this.handleImage(f, target); };
    input.click();
  }

  private handleImage(file: File, target: 'source' | 'result'): void {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      if (target === 'source') {
        if (this.state) { this.state.characterImage = dataUrl; this.onStateChange?.(); }
        this.showSourcePreview(dataUrl);
      } else {
        if (this.state) { this.state.explosionImage = dataUrl; this.state.partRegions = []; this.onStateChange?.(); }
        this.showResultPreview(dataUrl);
        this.exitAnnotateMode();
      }
      this.updateButtons();
    };
    reader.readAsDataURL(file);
  }

  private async refreshSourcePreview(): Promise<void> {
    if (!this.state) return
    let src = this.state.characterImage
    if (!src || !(await canDecodeImageDataUrl(src))) {
      await globalState.hydrateCharacterImage(true)
      src = globalState.get().characterImage
      if (src) {
        this.state.characterImage = src
        this.onStateChange?.()
      }
    }
    if (src) this.showSourcePreview(src)
  }

  private showSourcePreview(dataUrl: string): void {
    const box = this.q('#expl-source') as HTMLElement;
    if (!box) return;
    const img = document.createElement('img');
    img.className = 'expl-preview-img';
    img.src = dataUrl;
    box.innerHTML = '';
    box.appendChild(img);
  }

  private showResultPreview(dataUrl: string): void {
    const box = this.q('#expl-result') as HTMLElement;
    if (!box) return;
    const img = document.createElement('img');
    img.className = 'expl-preview-img';
    img.src = dataUrl;
    box.innerHTML = '';
    box.appendChild(img);
  }

  // ── 完整管线 ──────────────────────────────────────────────

  private showProgress(show: boolean, text = ''): void {
    const el = this.q('#expl-progress') as HTMLElement;
    if (el) el.style.display = show ? '' : 'none';
    const txt = this.q('#expl-progress-text') as HTMLElement;
    if (txt && text) txt.textContent = text;
  }

  private async runFullPipeline(): Promise<void> {
    console.log('[Spine] runFullPipeline called, characterImage exists:', !!this.state?.characterImage,
      'length:', this.state?.characterImage?.length);
    if (!this.state?.characterImage) {
      this.showToast('请先完成角色设计或上传角色设定图');
      return;
    }
    if (this.generating) return;
    this.generating = true;

    const btn = this.q('#expl-gen-parts') as HTMLButtonElement;
    if (btn) btn.disabled = true;
    this.showProgress(true, '1/3 压缩图片...');

    try {
      const templateUrl = this.getTemplateUrl();
      console.log('[Spine] Step 0: preparing images, template:', templateUrl);
      console.log('[Spine] Step 0a: compressing characterImage…');
      const charPrepared = await prepareCharacterImageForApi(this.state.characterImage, 1024, 1024, 0.85);
      if (charPrepared.dataUrl !== this.state.characterImage) {
        this.state.characterImage = charPrepared.dataUrl;
        this.onStateChange?.();
      }
      const charBase64 = charPrepared.base64;
      console.log('[Spine] charBase64 size:', (charBase64.length / 1024).toFixed(0), 'KB');

      console.log('[Spine] Step 0b: loading template via loadImageAsDataUrl…');
      const templateDataUrl = await loadImageAsDataUrl(templateUrl);
      const templatePrepared = await prepareImageForApi(templateDataUrl, 1024, 1536, 0.9);
      const templateBase64 = templatePrepared.base64;
      console.log('[Spine] templateBase64 size:', (templateBase64.length / 1024).toFixed(0), 'KB');

      console.log('[Spine] Step 0c: detecting aspect ratio…');
      const templateAspect = await this.detectAspectRatio(templateDataUrl);
      console.log('[Spine] Template detected aspect ratio:', templateAspect);

      // ── Step 1: Gemini 3.0 Pro 看图生成提示词 ──
      this.showProgress(true, '1/3 Gemini 3.0 Pro 正在分析角色，生成拆件提示词...');

      const charDesc = this.getCharDesc();
      console.log('[Spine] Step 1: calling Gemini 3.0 Pro for text prompt, charDesc:', charDesc);

      const geminiTextPrompt = `I'm sending you TWO images:
- IMAGE 1: The LAYOUT TEMPLATE — shows 16 separated parts on white background.
- IMAGE 2: The CHARACTER DESIGN — the target character.

Fill in ALL [ENTER_*] placeholders in the template below based on what you SEE in IMAGE 2. The output will be used DIRECTLY as an image generation prompt for another AI model, so it must be a clean, self-contained prompt with NO references to "IMAGE 1" or "IMAGE 2" — just describe what to draw.

Character info: ${charDesc}

RULES:
- [ENTER_BRIEF_CHARACTER_IDENTITY]: Brief identity from IMAGE 2 (e.g. "a muscular male pirate with tribal tattoos and a chain whip").
- [ENTER_HEAD_DESC], [ENTER_CHEST_DESC], etc.: Describe what you SEE in IMAGE 2 for each part. Be specific.
- [ENTER_WEAPON_DESC]: The weapon from IMAGE 2, NOT from IMAGE 1. Describe what the character actually holds.
- [ENTER_STYLE_KEYWORDS]: Art style of IMAGE 2.
- Keep all structure, rules, position tags — only replace [ENTER_*] placeholders.
- The output must read as a standalone image generation prompt. No meta-references.

OUTPUT THE COMPLETED PROMPT BELOW (start directly with "You are generating"):

${PARTS_TEMPLATE}`;

      const chatResult = await apiPost('/__ce-api__/gemini-text', {
        prompt: geminiTextPrompt,
        inputImages: [
          { base64: templateBase64, mimeType: templatePrepared.mimeType },
          { base64: charBase64, mimeType: charPrepared.mimeType },
        ],
      });

      console.log('[Spine] Gemini 3.0 Pro text response:', chatResult.success, chatResult.error);
      if (!chatResult.success || !chatResult.text) {
        this.showToast('提示词生成失败: ' + (chatResult.error || '未知错误'));
        return;
      }

      let finalPrompt = chatResult.text.trim();
      const startIdx = finalPrompt.indexOf('You are generating');
      if (startIdx > 0) finalPrompt = finalPrompt.slice(startIdx);
      console.log('[Spine] Final prompt length:', finalPrompt.length);
      console.log('[Spine] Final prompt preview:', finalPrompt.slice(0, 200));

      this.lastPrompt = finalPrompt;

      // ── Step 2: Nano Banana 2 并行生成 4 张拆件图 ──
      const NUM_CANDIDATES = 4;
      console.log('[Spine] Step 2: calling Nano Banana 2 x' + NUM_CANDIDATES);
      this.showProgress(true, `2/3 Nano Banana 2 正在并行生成 ${NUM_CANDIDATES} 张拆件图...`);

      const imgPayload = {
        prompt: finalPrompt,
        inputImages: [
          { base64: templateBase64, mimeType: templatePrepared.mimeType },
          { base64: charBase64, mimeType: charPrepared.mimeType },
        ],
        aspectRatio: templateAspect,
        model: 'gemini-2.5-flash-image',
      };

      const imgPromises = Array.from({ length: NUM_CANDIDATES }, () =>
        apiPost('/__ce-api__/generate-image', imgPayload).catch((e: any) => ({ success: false, error: e.message }))
      );
      const imgResults = await Promise.all(imgPromises);

      const successResults: string[] = [];
      for (const r of imgResults) {
        if (r.success && r.imageBase64) {
          successResults.push(`data:${r.mimeType || 'image/png'};base64,${r.imageBase64}`);
        }
      }

      console.log(`[Spine] Got ${successResults.length}/${NUM_CANDIDATES} images`);
      if (successResults.length === 0) {
        this.showToast('全部生成失败: ' + (imgResults[0]?.error || '未知错误'));
        return;
      }

      // ── Step 3: 展示候选图供选择 ──
      this.showProgress(true, '3/3 处理中...');
      this.showCandidateGrid(successResults, templateAspect);

    } catch (e: any) {
      console.error('[Spine] ❌ Pipeline error:', e);
      const msg = e?.message || '未知错误';
      this.showToast(msg.includes('无法解码') ? msg : '❌ 请求失败: ' + msg);
    } finally {
      this.generating = false;
      btn.disabled = false;
      this.showProgress(false);
      this.updateButtons();
    }
  }

  private async reroll(): Promise<void> {
    if (!this.state?.characterImage || !this.lastPrompt) {
      this.runFullPipeline();
      return;
    }
    if (this.generating) return;
    this.generating = true;

    const btn = this.q('#expl-gen-parts') as HTMLButtonElement;
    btn.disabled = true;
    this.showProgress(true, '重新抽卡中...');

    try {
      const charPrepared = await prepareCharacterImageForApi(this.state.characterImage, 1024, 1024, 0.85);
      if (charPrepared.dataUrl !== this.state.characterImage) {
        this.state.characterImage = charPrepared.dataUrl;
        this.onStateChange?.();
      }
      const templateDataUrl = await loadImageAsDataUrl(this.getTemplateUrl());
      const templatePrepared = await prepareImageForApi(templateDataUrl, 1024, 1536, 0.9);
      const templateAspect = await this.detectAspectRatio(templateDataUrl);

      const NUM_CANDIDATES = 4;
      this.showProgress(true, `Nano Banana 2 并行生成 ${NUM_CANDIDATES} 张拆件图...`);

      const payload = {
        prompt: this.lastPrompt,
        inputImages: [
          { base64: templatePrepared.base64, mimeType: templatePrepared.mimeType },
          { base64: charPrepared.base64, mimeType: charPrepared.mimeType },
        ],
        aspectRatio: templateAspect,
        model: 'gemini-2.5-flash-image',
      };

      const results = await Promise.all(
        Array.from({ length: NUM_CANDIDATES }, () =>
          apiPost('/__ce-api__/generate-image', payload).catch((e: any) => ({ success: false, error: e.message }))
        )
      );

      const candidates: string[] = [];
      for (const r of results) {
        if (r.success && r.imageBase64) {
          candidates.push(`data:${r.mimeType || 'image/png'};base64,${r.imageBase64}`);
        }
      }

      if (candidates.length === 0) {
        this.showToast('全部生成失败: ' + (results[0]?.error || '未知错误'));
        return;
      }

      this.showCandidateGrid(candidates, templateAspect);
    } catch (e: any) {
      this.showToast('❌ 请求失败: ' + e.message);
    } finally {
      this.generating = false;
      btn.disabled = false;
      this.showProgress(false);
      this.updateButtons();
    }
  }

  private getCharDesc(): string {
    try {
      const gs = (window as any).__globalState;
      if (!gs) return '角色信息未知';
      const p = gs.profile || {};
      const parts: string[] = [];
      if (p.name) parts.push(`角色名: ${p.name}`);
      if (p.gender) parts.push(`性别: ${p.gender === 'female' ? '女' : '男'}`);
      if (p.charClass) parts.push(`职业: ${p.charClass}`);
      if (p.worldSetting) parts.push(`世界观: ${p.worldSetting}`);
      if (p.combatType) parts.push(`战斗类型: ${p.combatType === 'ranged' ? '远程' : '近战'}`);
      return parts.length > 0 ? parts.join('\n') : '角色信息未知';
    } catch { return '角色信息未知'; }
  }

  private syncGenderUI(): void {
    const female = this.isFemale();
    const img = this.q('#expl-tmpl-img') as HTMLImageElement;
    if (img) img.src = female ? TEMPLATE_FEMALE_URL : TEMPLATE_MALE_URL;
    for (const b of this.sidePanel.querySelectorAll<HTMLButtonElement>('.expl-gender-btn')) {
      const active = b.dataset.gender === (female ? 'female' : 'male');
      b.classList.toggle('expl-gender-active', active);
      b.style.background = active ? 'rgba(232,196,138,0.15)' : 'transparent';
      b.style.color = active ? '#e8c48a' : 'rgba(232,196,138,0.5)';
      b.style.borderColor = active ? 'rgba(232,196,138,0.3)' : 'rgba(232,196,138,0.15)';
    }
  }

  private isFemale(): boolean {
    try {
      const gs = (window as any).__globalState;
      return gs?.profile?.gender === 'female';
    } catch { return false; }
  }

  private getTemplateUrl(): string {
    return this.isFemale() ? TEMPLATE_FEMALE_URL : TEMPLATE_MALE_URL;
  }

  // ── 白底去除 ──────────────────────────────────────────────

  private async removeWhiteBgFromDataUrl(dataUrl: string): Promise<string> {
    const img = await this.loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const threshold = 240;
    const edgeSoftness = 30;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r >= threshold && g >= threshold && b >= threshold) {
        data[i + 3] = 0;
      } else {
        const brightness = Math.max(r, g, b);
        const saturation = brightness > 0 ? 1 - Math.min(r, g, b) / brightness : 0;
        if (brightness > (threshold - edgeSoftness) && saturation < 0.15) {
          data[i + 3] = Math.round(Math.min(1, Math.max(0, (threshold - brightness) / edgeSoftness)) * 255);
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }

  private showCandidateGrid(candidates: string[], _aspect: string): void {
    const resultBox = this.q('#expl-result') as HTMLElement;
    const title = this.q('#expl-right-title') as HTMLElement;
    if (title) title.textContent = `选择最佳拆件图 (${candidates.length} 张)`;
    resultBox.innerHTML = '';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;width:100%;height:100%;overflow:auto;';
    resultBox.appendChild(grid);

    for (let i = 0; i < candidates.length; i++) {
      const cell = document.createElement('div');
      cell.style.cssText = 'position:relative;cursor:pointer;border:2px solid transparent;border-radius:8px;overflow:hidden;background:#1a1a2e;transition:border-color 0.2s;';
      cell.innerHTML = `
        <img src="${candidates[i]}" style="width:100%;height:100%;object-fit:contain;">
        <div style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">#${i + 1}</div>
      `;
      cell.addEventListener('mouseenter', () => cell.style.borderColor = '#4fc3f7');
      cell.addEventListener('mouseleave', () => cell.style.borderColor = 'transparent');
      cell.addEventListener('click', () => this.selectCandidate(candidates[i]));
      grid.appendChild(cell);
    }

    this.showProgress(false);
    this.generating = false;
    const btn = this.q('#expl-gen-parts') as HTMLButtonElement;
    if (btn) btn.disabled = false;
    this.updateButtons();
  }

  private async selectCandidate(rawDataUrl: string): Promise<void> {
    this.showProgress(true, '正在去除白色背景...');
    try {
      const transparentDataUrl = await this.removeWhiteBgFromDataUrl(rawDataUrl);
      this.state!.explosionImage = transparentDataUrl;
      this.state!.partRegions = [];
      this.showResultPreview(transparentDataUrl);
      const rerollBtn = this.q('#expl-reroll') as HTMLElement;
      if (rerollBtn) rerollBtn.style.display = '';
      this.triggerSaveOnly();
      this.showToast('✅ 已选择！可继续标注或重新生成');
    } catch (e: any) {
      this.showToast('❌ 处理失败: ' + e.message);
    } finally {
      this.showProgress(false);
      this.updateButtons();
    }
  }

  private async removeWhiteBackground(): Promise<void> {
    if (!this.state?.explosionImage) return;
    const btn = this.q('#expl-remove-bg') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '⏳ 抠图中...';
    try {
      const result = await this.removeWhiteBgFromDataUrl(this.state.explosionImage);
      this.state.explosionImage = result;
      this.state.partRegions = [];
      this.onStateChange?.();
      this.showResultPreview(result);
      this.showToast('✅ 白色背景已去除');
    } catch (e) {
      this.showToast('❌ 抠图失败: ' + (e as Error).message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🧹 一键抠图（去白底）';
      this.updateButtons();
    }
  }

  // ── 标注模式 ──────────────────────────────────────────────

  private async enterAnnotateMode(mode: 'auto' | 'manual'): Promise<void> {
    if (!this.state?.explosionImage) return;
    this.annotMode = mode;
    const img = await this.loadImage(this.state.explosionImage);
    this.annotImg = img;

    if (mode === 'auto') {
      const regions = this.detectParts(img);
      this.state.partRegions = regions;
      this.showToast(`✅ 检测到 ${regions.length} 个部件 · 左侧可交换标签`);
    } else {
      if (this.state.partRegions.length === 0) {
        this.state.partRegions = PART_NAMES.map((n, i) => ({
          id: PART_IDS[i], name: n, x: 0, y: 0, width: 0, height: 0, imageData: '',
        }));
      }
      this.manualTarget = this.state.partRegions.findIndex(r => r.width === 0);
      if (this.manualTarget < 0) this.manualTarget = 0;
      this.showToast('手动模式：左侧选择部件名 → 在图上框选区域');
    }
    this.buildAnnotateUI();
  }

  // ── Position-based part detection ──
  // The template layout is FIXED: each part has a known position.
  // We seed from each part's expected center and flood-fill within its zone.

  // Zone boundaries [xMin, yMin, xMax, yMax] normalized to body area width / image height.
  // Generous enough to contain each part with a few pixels of variation,
  // but small enough to exclude adjacent parts.
  private static readonly PART_ZONES: Record<string, [number, number, number, number]> = {
    head:       [0.22, 0.00, 0.72, 0.15],
    upperarm_l: [0.00, 0.05, 0.33, 0.30],
    chest:      [0.22, 0.10, 0.72, 0.38],
    upperarm_r: [0.52, 0.05, 0.92, 0.30],
    forearm_l:  [0.00, 0.26, 0.33, 0.48],
    waist:      [0.22, 0.32, 0.72, 0.52],
    forearm_r:  [0.52, 0.26, 0.92, 0.48],
    hand_l:     [0.00, 0.42, 0.22, 0.58],
    thigh_l:    [0.18, 0.42, 0.50, 0.63],
    thigh_r:    [0.42, 0.42, 0.72, 0.63],
    hand_r:     [0.62, 0.42, 0.92, 0.58],
    calf_l:     [0.10, 0.57, 0.48, 0.80],
    calf_r:     [0.42, 0.57, 0.78, 0.80],
    foot_l:     [0.10, 0.76, 0.48, 1.00],
    foot_r:     [0.42, 0.76, 0.78, 1.00],
  };

  // Expected center positions [cx, cy] for seeding flood-fill.
  private static readonly PART_CENTERS: Record<string, [number, number]> = {
    head:       [0.46, 0.07],
    upperarm_l: [0.15, 0.18],
    chest:      [0.46, 0.24],
    upperarm_r: [0.72, 0.18],
    forearm_l:  [0.15, 0.37],
    waist:      [0.46, 0.41],
    forearm_r:  [0.72, 0.37],
    hand_l:     [0.10, 0.51],
    thigh_l:    [0.33, 0.53],
    thigh_r:    [0.56, 0.53],
    hand_r:     [0.78, 0.51],
    calf_l:     [0.28, 0.70],
    calf_r:     [0.58, 0.70],
    foot_l:     [0.28, 0.88],
    foot_r:     [0.58, 0.88],
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
    for (let i = 0; i < opaque.length; i++) {
      opaque[i] = data[i * 4 + 3] >= ALPHA_TH ? 1 : 0;
    }

    // Pixels already claimed by a part (-1 = free)
    const claimed = new Int32Array(width * height).fill(-1);

    // ── Find weapon / body boundary ──
    const colCounts = new Uint32Array(width);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (opaque[y * width + x]) colCounts[x]++;
      }
    }

    let contentRight = width - 1;
    while (contentRight > 0 && colCounts[contentRight] < 3) contentRight--;

    // Find the WIDEST vertical gap in the right half of the image.
    // This reliably separates body parts from the weapon column.
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

    // ── Helpers ──
    const findSeed = (
      cx: number, cy: number,
      zxMin: number, zyMin: number, zxMax: number, zyMax: number,
      maxR: number,
    ): [number, number] | null => {
      const clamp = (nx: number, ny: number) =>
        nx >= zxMin && nx <= zxMax && ny >= zyMin && ny <= zyMax;

      if (clamp(cx, cy) && opaque[cy * width + cx] === 1 && claimed[cy * width + cx] < 0)
        return [cx, cy];

      for (let r = 1; r <= maxR; r++) {
        for (let d = -r; d <= r; d++) {
          const checks: [number, number][] = [[cx + d, cy - r], [cx + d, cy + r], [cx - r, cy + d], [cx + r, cy + d]];
          for (const [nx, ny] of checks) {
            if (!clamp(nx, ny) || nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (opaque[ni] === 1 && claimed[ni] < 0) return [nx, ny];
          }
        }
      }
      return null;
    };

    // Free flood fill — no zone constraint. Each part in the template is an
    // independent island, so the fill naturally stops at the part boundary.
    const floodFill = (sx: number, sy: number, label: number): number[] => {
      const pixels: number[] = [];
      const idx0 = sy * width + sx;
      if (claimed[idx0] >= 0 || opaque[idx0] === 0) return pixels;

      const stack = [idx0];
      claimed[idx0] = label;

      while (stack.length > 0) {
        const idx = stack.pop()!;
        pixels.push(idx);
        const px = idx % width, py = (idx - px) / width;

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (claimed[ni] >= 0 || opaque[ni] === 0) continue;
          claimed[ni] = label;
          stack.push(ni);
        }
      }
      return pixels;
    };

    const extractPartImage = (
      pixels: number[], bx: number, by: number, bw: number, bh: number,
    ): string => {
      const partCanvas = document.createElement('canvas');
      partCanvas.width = bw; partCanvas.height = bh;
      const pCtx = partCanvas.getContext('2d')!;
      const pData = pCtx.createImageData(bw, bh);

      for (const pi of pixels) {
        const px = pi % width, py = (pi - px) / width;
        const dx = px - bx, dy = py - by;
        if (dx < 0 || dx >= bw || dy < 0 || dy >= bh) continue;
        const so = pi * 4, d = (dy * bw + dx) * 4;
        pData.data[d] = data[so]; pData.data[d + 1] = data[so + 1];
        pData.data[d + 2] = data[so + 2]; pData.data[d + 3] = data[so + 3];
      }

      pCtx.putImageData(pData, 0, 0);
      return partCanvas.toDataURL('image/png');
    };

    // ── Process each part ──
    const regions: PartRegion[] = [];
    let nextLabel = 0;
    const pad = 2;
    const maxSearch = Math.round(Math.max(bodyW, height) * 0.12);

    for (let i = 0; i < PART_IDS.length; i++) {
      const partId = PART_IDS[i];
      const partName = PART_NAMES[i];

      let zxMin: number, zyMin: number, zxMax: number, zyMax: number;
      let cx: number, cy: number;

      if (partId === 'weapon') {
        zxMin = Math.max(0, bodyRight - 5);
        zyMin = 0;
        zxMax = width - 1;
        zyMax = height - 1;
        cx = Math.round((bodyRight + contentRight) / 2);
        cy = Math.round(height * 0.45);
      } else {
        const zone = ExplosionTab.PART_ZONES[partId];
        const center = ExplosionTab.PART_CENTERS[partId];
        if (!zone || !center) {
          regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' });
          continue;
        }
        zxMin = Math.max(0, Math.round(zone[0] * bodyW));
        zyMin = Math.max(0, Math.round(zone[1] * height));
        zxMax = Math.min(width - 1, Math.round(zone[2] * bodyW));
        zyMax = Math.min(height - 1, Math.round(zone[3] * height));
        cx = Math.round(center[0] * bodyW);
        cy = Math.round(center[1] * height);
      }

      const seed = findSeed(cx, cy, zxMin, zyMin, zxMax, zyMax, maxSearch);

      if (!seed) {
        regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' });
        continue;
      }

      const pixels = floodFill(seed[0], seed[1], nextLabel++);

      if (pixels.length < 20) {
        regions.push({ id: partId, name: partName, x: 0, y: 0, width: 0, height: 0, imageData: '' });
        continue;
      }

      let minX = width, minY = height, maxX = 0, maxY = 0;
      for (const pi of pixels) {
        const px = pi % width, py = (pi - px) / width;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }

      const bx = Math.max(0, minX - pad);
      const by = Math.max(0, minY - pad);
      const bw = Math.min(width, maxX + pad + 1) - bx;
      const bh = Math.min(height, maxY + pad + 1) - by;

      regions.push({
        id: partId, name: partName,
        x: bx, y: by, width: bw, height: bh,
        imageData: extractPartImage(pixels, bx, by, bw, bh),
      });
    }

    return regions;
  }

  private buildAnnotateUI(): void {
    const previewsContainer = this.centerView.querySelector('.expl-previews') as HTMLElement;
    if (previewsContainer) {
      previewsContainer.style.cssText = 'flex:1;display:flex;align-items:stretch;gap:0;padding:0;min-height:0;';
      for (const child of Array.from(previewsContainer.children)) {
        const el = child as HTMLElement;
        if (el.querySelector('#expl-source') || el.classList.contains('expl-arrow-col')) {
          el.style.display = 'none';
        }
      }
      const resultPanel = previewsContainer.querySelector('.expl-preview-panel:last-of-type') as HTMLElement;
      if (resultPanel) resultPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:0;';
    }

    const resultBox = this.q('#expl-result') as HTMLElement;
    const title = this.q('#expl-right-title') as HTMLElement;
    resultBox.innerHTML = '';
    if (title) title.textContent = this.annotMode === 'auto' ? '自动标注 · 在原图上查看' : '手动标注 · 在图上框选';

    const uploadRow = resultBox.parentElement?.querySelector('.expl-upload-row') as HTMLElement;
    if (uploadRow) uploadRow.style.display = 'none';

    const layout = document.createElement('div');
    layout.className = 'expl-annotate-layout';
    layout.style.cssText = 'display:flex;width:100%;height:100%;';
    resultBox.appendChild(layout);

    const sidebar = document.createElement('div');
    sidebar.className = 'expl-annotate-sidebar';
    layout.appendChild(sidebar);

    const modeRow = document.createElement('div');
    modeRow.className = 'expl-mode-row';
    modeRow.innerHTML = `
      <button class="expl-mode-btn ${this.annotMode === 'auto' ? 'active' : ''}" data-mode="auto">自动</button>
      <button class="expl-mode-btn ${this.annotMode === 'manual' ? 'active' : ''}" data-mode="manual">手动</button>
    `;
    sidebar.appendChild(modeRow);
    modeRow.querySelectorAll('.expl-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = (btn as HTMLElement).dataset.mode as 'auto' | 'manual';
        this.enterAnnotateMode(m);
      });
    });

    const list = document.createElement('div');
    list.className = 'expl-annotate-list';
    list.id = 'expl-annotate-list';
    sidebar.appendChild(list);
    this.renderPartList(list);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'expl-annotate-actions';
    actionsRow.innerHTML = `<button class="expl-crop-btn" id="expl-annotate-done">✅ 完成标注</button>`;
    sidebar.appendChild(actionsRow);
    actionsRow.querySelector('#expl-annotate-done')?.addEventListener('click', () => this.exitAnnotateMode());

    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'expl-annotate-canvas-wrap';
    canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#1a1a1a;';
    layout.appendChild(canvasWrap);

    const cvs = document.createElement('canvas');
    cvs.className = 'expl-annotate-canvas';
    cvs.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    canvasWrap.appendChild(cvs);
    this.annotCanvas = cvs;
    this.annotCtx = cvs.getContext('2d')!;
    this.selRect = null;
    this.interactionMode = 'idle';
    this.swapSource = -1;
    this.hoveredRegion = -1;
    this.selectedRegion = -1;
    this.annotZoom = 0;

    this.setupAnnotateInteraction(cvs);
    requestAnimationFrame(() => {
      this.fitCanvasToWrap(canvasWrap);
      this.startAnnotateLoop();
    });

    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => this.fitCanvasToWrap(canvasWrap));
    this.resizeObs.observe(canvasWrap);
  }

  private fitCanvasToWrap(wrap: HTMLElement): void {
    if (!this.annotCanvas) return;
    const r = wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const dpr = window.devicePixelRatio || 1;
    this.annotCanvas.width = Math.round(r.width * dpr);
    this.annotCanvas.height = Math.round(r.height * dpr);
    if (this.annotImg && this.annotZoom < 0.01) {
      this.annotZoom = Math.min(r.width / this.annotImg.width, r.height / this.annotImg.height) * 0.92;
      this.annotPanX = (r.width - this.annotImg.width * this.annotZoom) / 2;
      this.annotPanY = (r.height - this.annotImg.height * this.annotZoom) / 2;
    }
  }

  private renderPartList(list: HTMLElement): void {
    list.innerHTML = '';
    const regions = this.state?.partRegions ?? [];
    for (let i = 0; i < PART_NAMES.length; i++) {
      const region = regions[i];
      const assigned = region && region.width > 0;
      const label = region?.name || PART_NAMES[i];
      const colorIdx = region ? PART_IDS.indexOf(region.id) : i;
      const color = PART_COLORS[(colorIdx >= 0 ? colorIdx : i) % PART_COLORS.length];
      const isManualTarget = this.annotMode === 'manual' && this.manualTarget === i;
      const isSwapSource = this.swapSource === i;

      const item = document.createElement('div');
      item.className = 'expl-annot-item' +
        (isManualTarget ? ' annot-active' : '') +
        (isSwapSource ? ' annot-swap' : '') +
        (!assigned ? ' annot-empty' : '');

      item.innerHTML = `<span class="expl-annot-dot" style="background:${assigned ? color : 'rgba(100,100,100,0.3)'}"></span>` +
        `<span class="expl-annot-name">${label}</span>` +
        `<span class="expl-annot-size">${assigned ? `${region!.width}×${region!.height}` : '未标注'}</span>`;

      if (this.annotMode === 'auto' && assigned) {
        const swapBtn = document.createElement('button');
        swapBtn.className = 'expl-annot-btn' + (this.swapSource >= 0 && this.swapSource !== i ? ' swap-target' : '');
        swapBtn.textContent = '↔';
        swapBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.swapSource >= 0 && this.swapSource !== i) this.doSwap(i);
          else this.startSwap(i);
        });
        item.appendChild(swapBtn);
      }

      item.addEventListener('click', () => {
        if (this.annotMode === 'manual') { this.manualTarget = i; this.refreshPartList(); }
        else if (this.swapSource >= 0 && this.swapSource !== i) this.doSwap(i);
        else { this.selectedRegion = i; this.refreshPartList(); }
      });
      item.addEventListener('mouseenter', () => { this.hoveredRegion = i; });
      item.addEventListener('mouseleave', () => { if (this.hoveredRegion === i) this.hoveredRegion = -1; });
      list.appendChild(item);
    }

    if (this.swapSource >= 0) {
      const cancel = document.createElement('div');
      cancel.className = 'expl-annot-cancel';
      cancel.innerHTML = '<button class="expl-crop-btn">✕ 取消交换</button>';
      cancel.querySelector('button')!.addEventListener('click', () => { this.swapSource = -1; this.refreshPartList(); });
      list.appendChild(cancel);
    }
  }

  private refreshPartList(): void {
    const list = this.centerView.querySelector('#expl-annotate-list') as HTMLElement;
    if (list) this.renderPartList(list);
  }
  private startSwap(idx: number): void {
    const label = this.state?.partRegions?.[idx]?.name || PART_NAMES[idx];
    this.swapSource = idx;
    this.showToast(`选择要与「${label}」交换的部件`);
    this.refreshPartList();
  }
  private doSwap(targetIdx: number): void {
    if (this.swapSource < 0 || !this.state?.partRegions) return;
    const regions = this.state.partRegions;
    const s = this.swapSource;
    if (s === targetIdx) { this.swapSource = -1; this.refreshPartList(); return; }
    const sLabel = regions[s]?.name || PART_NAMES[s];
    const tLabel = regions[targetIdx]?.name || PART_NAMES[targetIdx];
    const swap = (key: keyof PartRegion) => { const tmp = regions[s][key]; (regions[s] as any)[key] = regions[targetIdx][key]; (regions[targetIdx] as any)[key] = tmp; };
    swap('x'); swap('y'); swap('width'); swap('height'); swap('imageData');
    this.swapSource = -1;
    this.showToast(`已交换「${sLabel}」↔「${tLabel}」`);
    this.refreshPartList();
  }

  private setupAnnotateInteraction(cvs: HTMLCanvasElement): void {
    const toImg = (sx: number, sy: number) => ({ x: (sx - this.annotPanX) / this.annotZoom, y: (sy - this.annotPanY) / this.annotZoom });

    cvs.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const f = e.deltaY < 0 ? 1.12 : 0.88;
      const nz = Math.max(0.05, Math.min(20, this.annotZoom * f));
      this.annotPanX = mx - (mx - this.annotPanX) * (nz / this.annotZoom);
      this.annotPanY = my - (my - this.annotPanY) * (nz / this.annotZoom);
      this.annotZoom = nz;
    }, { passive: false });

    cvs.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        this.interactionMode = 'panning'; this.dragOrigin = { x: e.clientX, y: e.clientY }; this.panOrigin = { x: this.annotPanX, y: this.annotPanY }; cvs.style.cursor = 'grabbing'; return;
      }
      if (e.button === 0 && this.annotMode === 'manual' && this.manualTarget >= 0) {
        this.interactionMode = 'selecting'; const p = toImg(sx, sy); this.dragOrigin = { x: p.x, y: p.y }; this.selRect = { x: p.x, y: p.y, w: 0, h: 0 }; cvs.style.cursor = 'crosshair'; return;
      }
      if (e.button === 0 && this.annotMode === 'auto') {
        const p = toImg(sx, sy);
        const hit = this.hitTestRegion(p.x, p.y);
        if (hit >= 0) { if (this.swapSource >= 0 && this.swapSource !== hit) this.doSwap(hit); else { this.selectedRegion = hit; this.refreshPartList(); } }
      }
    });
    const onMove = (e: MouseEvent) => {
      if (this.interactionMode === 'panning') { this.annotPanX = this.panOrigin.x + (e.clientX - this.dragOrigin.x); this.annotPanY = this.panOrigin.y + (e.clientY - this.dragOrigin.y); }
      else if (this.interactionMode === 'selecting' && this.selRect) { const rect = cvs.getBoundingClientRect(); const p = toImg(e.clientX - rect.left, e.clientY - rect.top); this.selRect.w = p.x - this.dragOrigin.x; this.selRect.h = p.y - this.dragOrigin.y; }
      else { const rect = cvs.getBoundingClientRect(); const p = toImg(e.clientX - rect.left, e.clientY - rect.top); this.hoveredRegion = this.hitTestRegion(p.x, p.y); }
    };
    const onUp = () => {
      if (this.interactionMode === 'selecting' && this.selRect && this.manualTarget >= 0) {
        let { x, y, w, h } = this.selRect; if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
        if (w > 3 && h > 3) this.commitManualCrop(this.manualTarget, x, y, w, h); this.selRect = null;
      }
      this.interactionMode = 'idle'; cvs.style.cursor = this.annotMode === 'manual' ? 'crosshair' : 'default';
    };
    cvs.addEventListener('mousemove', onMove);
    cvs.addEventListener('mouseup', onUp);
    cvs.addEventListener('contextmenu', e => e.preventDefault());
  }

  private hitTestRegion(ix: number, iy: number): number {
    const regions = this.state?.partRegions ?? [];
    for (let i = regions.length - 1; i >= 0; i--) { const r = regions[i]; if (r.width === 0) continue; if (ix >= r.x && ix <= r.x + r.width && iy >= r.y && iy <= r.y + r.height) return i; }
    return -1;
  }

  private commitManualCrop(idx: number, x: number, y: number, w: number, h: number): void {
    if (!this.state?.partRegions || !this.annotImg) return;
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(w); tmp.height = Math.round(h);
    const tctx = tmp.getContext('2d')!;
    tctx.drawImage(this.annotImg, x, y, w, h, 0, 0, w, h);
    const content = this.shrinkToContent(tmp, tctx);
    let fx = x, fy = y, fw = w, fh = h;
    if (content && (content.w < w * 0.9 || content.h < h * 0.9)) {
      fx = x + content.x; fy = y + content.y; fw = content.w; fh = content.h;
      tmp.width = Math.round(fw); tmp.height = Math.round(fh);
      tctx.clearRect(0, 0, tmp.width, tmp.height);
      tctx.drawImage(this.annotImg!, fx, fy, fw, fh, 0, 0, fw, fh);
    }
    const region = this.state.partRegions[idx];
    region.x = Math.round(fx); region.y = Math.round(fy);
    region.width = Math.round(fw); region.height = Math.round(fh);
    region.imageData = tmp.toDataURL('image/png');
    const cropLabel = region.name || PART_NAMES[idx] || `部件 ${idx + 1}`;
    this.showToast(`已标注「${cropLabel}」(${Math.round(fw)}×${Math.round(fh)})`);
    const next = this.state.partRegions.findIndex((r, i) => i > idx && r.width === 0);
    this.manualTarget = next >= 0 ? next : (this.state.partRegions.findIndex(r => r.width === 0) ?? idx);
    this.refreshPartList();
  }

  private startAnnotateLoop(): void { this.stopAnnotateLoop(); const loop = () => { this.drawAnnotateCanvas(); this.annotRafId = requestAnimationFrame(loop); }; this.annotRafId = requestAnimationFrame(loop); }
  private stopAnnotateLoop(): void { if (this.annotRafId) { cancelAnimationFrame(this.annotRafId); this.annotRafId = 0; } }

  private drawAnnotateCanvas(): void {
    const ctx = this.annotCtx; const cvs = this.annotCanvas;
    if (!ctx || !cvs || !this.annotImg) return;
    if (this.annotZoom < 0.01) { const wrap = cvs.parentElement; if (wrap) this.fitCanvasToWrap(wrap); if (this.annotZoom < 0.01) return; }
    if (cvs.width < 10 || cvs.height < 10) { const wrap = cvs.parentElement; if (wrap) this.fitCanvasToWrap(wrap); if (cvs.width < 10) return; }

    const dpr = window.devicePixelRatio || 1;
    const W = cvs.width / dpr, H = cvs.height / dpr;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.save(); ctx.scale(dpr, dpr);
    const sz = 16;
    for (let i = 0; i < Math.ceil(W / sz); i++) for (let j = 0; j < Math.ceil(H / sz); j++) { ctx.fillStyle = (i + j) % 2 ? '#252525' : '#1e1e1e'; ctx.fillRect(i * sz, j * sz, sz, sz); }

    ctx.save(); ctx.translate(this.annotPanX, this.annotPanY); ctx.scale(this.annotZoom, this.annotZoom);
    ctx.drawImage(this.annotImg, 0, 0);

    const regions = this.state?.partRegions ?? [];
    const lw = Math.max(1, 2 / this.annotZoom);
    const fontSize = Math.max(8, 12 / this.annotZoom);
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]; if (r.width === 0) continue;
      const colorIdx = PART_IDS.indexOf(r.id);
      const color = colorIdx >= 0 ? PART_COLORS[colorIdx % PART_COLORS.length] : PART_COLORS[i % PART_COLORS.length];
      const label = r.name || PART_NAMES[i] || `部件 ${i + 1}`;
      const isHl = this.hoveredRegion === i || this.selectedRegion === i || this.manualTarget === i || this.swapSource === i;
      ctx.globalAlpha = isHl ? 0.35 : 0.15; ctx.fillStyle = color; ctx.fillRect(r.x, r.y, r.width, r.height);
      ctx.globalAlpha = isHl ? 1 : 0.6; ctx.strokeStyle = color; ctx.lineWidth = isHl ? lw * 2 : lw;
      if (this.swapSource === i) ctx.setLineDash([6 / this.annotZoom, 3 / this.annotZoom]);
      ctx.strokeRect(r.x, r.y, r.width, r.height); ctx.setLineDash([]);
      ctx.globalAlpha = 1; ctx.font = `bold ${fontSize}px sans-serif`;
      const tw = ctx.measureText(label).width;
      const lh = fontSize + 4 / this.annotZoom;
      ctx.fillStyle = color; ctx.globalAlpha = 0.85; ctx.fillRect(r.x, r.y - lh, tw + 6 / this.annotZoom, lh);
      ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillText(label, r.x + 3 / this.annotZoom, r.y - 3 / this.annotZoom);
    }
    if (this.selRect) {
      const tc = this.manualTarget >= 0 ? PART_COLORS[this.manualTarget % PART_COLORS.length] : '#ffe066';
      ctx.globalAlpha = 0.3; ctx.fillStyle = tc; ctx.fillRect(this.selRect.x, this.selRect.y, this.selRect.w, this.selRect.h);
      ctx.globalAlpha = 1; ctx.strokeStyle = tc; ctx.lineWidth = lw * 1.5; ctx.setLineDash([6 / this.annotZoom, 4 / this.annotZoom]);
      ctx.strokeRect(this.selRect.x, this.selRect.y, this.selRect.w, this.selRect.h); ctx.setLineDash([]);
    }
    ctx.restore();
    if (this.annotMode === 'manual' && this.manualTarget >= 0) {
      const mtLabel = regions[this.manualTarget]?.name || PART_NAMES[this.manualTarget] || `部件 ${this.manualTarget + 1}`;
      const mtColorIdx = regions[this.manualTarget] ? PART_IDS.indexOf(regions[this.manualTarget].id) : this.manualTarget;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, H - 28, W, 28);
      ctx.fillStyle = PART_COLORS[(mtColorIdx >= 0 ? mtColorIdx : this.manualTarget) % PART_COLORS.length]; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`框选「${mtLabel}」的区域`, W / 2, H - 9); ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  private exitAnnotateMode(): void {
    this.stopAnnotateLoop(); this.resizeObs?.disconnect(); this.annotCanvas = null; this.annotCtx = null; this.annotImg = null;

    this.restorePreviewLayout();

    const assigned = this.state?.partRegions?.filter(r => r.width > 0).length ?? 0;
    const title = this.q('#expl-right-title') as HTMLElement;
    if (title) title.textContent = assigned > 0 ? `已标注 ${assigned}/${PART_NAMES.length} 个部件` : '拆件图结果';

    if (this.state?.explosionImage) {
      if (assigned > 0) {
        this.showPartGridPreview();
      } else {
        this.showResultPreview(this.state.explosionImage);
      }
    }
    this.updateButtons();
    this.triggerSaveOnly();
  }

  private triggerSaveOnly(): void {
    window.dispatchEvent(new CustomEvent('vag-studio-save'));
  }

  private restorePreviewLayout(): void {
    const previewsContainer = this.centerView.querySelector('.expl-previews') as HTMLElement;
    if (previewsContainer) {
      previewsContainer.style.cssText = 'flex:1;display:flex;align-items:stretch;gap:0;padding:16px;min-height:0;';
      for (const child of Array.from(previewsContainer.children)) {
        const el = child as HTMLElement;
        if (el.querySelector('#expl-source') || el.classList.contains('expl-arrow-col')) {
          el.style.display = '';
        }
      }
      const resultPanel = previewsContainer.querySelector('.expl-preview-panel:last-of-type') as HTMLElement;
      if (resultPanel) resultPanel.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:8px;';
      const uploadRow = previewsContainer.querySelector('.expl-preview-panel:last-of-type .expl-upload-row') as HTMLElement;
      if (uploadRow) uploadRow.style.display = '';
    }
  }

  private showPartGridPreview(): void {
    const box = this.q('#expl-result') as HTMLElement;
    if (!box || !this.state?.partRegions) return;
    box.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px;overflow-y:auto;justify-content:center;align-content:flex-start;width:100%;height:100%;';
    for (let i = 0; i < this.state.partRegions.length; i++) {
      const r = this.state.partRegions[i];
      if (r.width === 0 || !r.imageData) continue;
      const cell = document.createElement('div');
      cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;padding:4px;background:rgba(0,0,0,0.3);border-radius:4px;border:1px solid rgba(232,196,138,0.08);';
      const thumb = document.createElement('img');
      thumb.src = r.imageData;
      thumb.style.cssText = 'max-width:56px;max-height:56px;object-fit:contain;image-rendering:pixelated;';
      const label = document.createElement('div');
      const cIdx = PART_IDS.indexOf(r.id);
      label.style.cssText = `font-size:9px;font-weight:600;color:${PART_COLORS[(cIdx >= 0 ? cIdx : i) % PART_COLORS.length]};text-align:center;`;
      label.textContent = r.name || PART_NAMES[i] || `部件 ${i + 1}`;
      cell.appendChild(thumb);
      cell.appendChild(label);
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  }

  private shrinkToContent(cvs: HTMLCanvasElement, cctx: CanvasRenderingContext2D): { x: number; y: number; w: number; h: number } | null {
    const data = cctx.getImageData(0, 0, cvs.width, cvs.height).data;
    let minX = cvs.width, minY = cvs.height, maxX = 0, maxY = 0;
    for (let y = 0; y < cvs.height; y++) for (let x = 0; x < cvs.width; x++)
      if (data[(y * cvs.width + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
    if (maxX <= minX || maxY <= minY) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // ── Helpers ──────────────────────────────────────────────

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  }

  private detectAspectRatio(dataUrl: string): Promise<string> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const r = img.width / img.height;
        const supported = [
          { ratio: '1:1', v: 1 }, { ratio: '4:5', v: 0.8 }, { ratio: '3:4', v: 0.75 },
          { ratio: '2:3', v: 0.667 }, { ratio: '9:16', v: 0.5625 },
          { ratio: '5:4', v: 1.25 }, { ratio: '4:3', v: 1.333 },
          { ratio: '3:2', v: 1.5 }, { ratio: '16:9', v: 1.778 },
        ];
        let best = supported[0];
        for (const s of supported) {
          if (Math.abs(r - s.v) < Math.abs(r - best.v)) best = s;
        }
        resolve(best.ratio);
      };
      img.onerror = () => resolve('4:5');
      img.src = dataUrl;
    });
  }

  private confirm(): void {
    if (this.state && (this.state.explosionImage || this.state.partRegions.length > 0)) {
      this.exitAnnotateMode(); this.state.activeTab = 'bind'; this.onStateChange?.();
    }
  }

  private updateButtons(): void {
    const hasSource = !!this.state?.characterImage;
    const hasResult = !!this.state?.explosionImage;
    const hasParts = (this.state?.partRegions.length ?? 0) > 0;
    const set = (id: string, disabled: boolean) => { const el = this.q(`#${id}`) as HTMLButtonElement; if (el) el.disabled = disabled; };
    set('expl-gen-parts', !hasSource);
    set('expl-remove-bg', !hasResult);
    set('expl-auto-crop', !hasResult);
    set('expl-manual-crop', !hasResult);
    set('expl-confirm', !hasResult && !hasParts);

    const rerollBtn = this.q('#expl-reroll') as HTMLElement;
    if (rerollBtn) rerollBtn.style.display = (hasResult && this.lastPrompt) ? '' : 'none';
  }

  private showToast(msg: string): void {
    let toast = document.querySelector('.sd-toast') as HTMLElement;
    if (!toast) { toast = document.createElement('div'); toast.className = 'sd-toast'; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ── History ──────────────────────────────────────────────

  private async loadHistory(): Promise<void> {
    const list = this.q('#expl-history-list') as HTMLElement;
    if (!list) return;
    list.innerHTML = '<div style="font-size:11px;opacity:0.5;text-align:center;padding:8px;">加载中...</div>';
    try {
      const res = await fetch('/__ce-api__/list-spine-sessions');
      const data = await res.json();
      if (!data.success || !data.sessions?.length) {
        list.innerHTML = '<div style="font-size:11px;opacity:0.5;text-align:center;padding:8px;">暂无历史记录</div>';
        return;
      }
      list.innerHTML = '';
      for (const s of data.sessions) {
        const ts = s.timestamp ? new Date(s.timestamp) : null;
        const timeStr = ts ? `${ts.getMonth() + 1}/${ts.getDate()} ${ts.getHours()}:${String(ts.getMinutes()).padStart(2, '0')}` : s.slot;
        const tabLabel = ({ explosion: '拆分', bind: '绑骨', anim: '动画', upload: '导出', design: '设计', game: '游戏' } as Record<string, string>)[s.activeTab] || s.activeTab;
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.03);border:1px solid rgba(232,196,138,0.08);transition:all 0.15s;';
        item.innerHTML = `
          <img src="/__ce-api__/spine-session-thumbnail?slot=${s.slot}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;background:#1a1a2e;" onerror="this.style.display='none'">
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${timeStr}</div>
            <div style="font-size:9px;opacity:0.5;">${tabLabel} · ${s.partsCount || 0} 部件${s.hasExplosion ? ' · 已拆件' : ''}</div>
          </div>
          <button class="sd-action-btn" style="font-size:10px;padding:2px 8px;flex-shrink:0;">恢复</button>
        `;
        item.addEventListener('mouseenter', () => { item.style.borderColor = 'rgba(232,196,138,0.3)'; });
        item.addEventListener('mouseleave', () => { item.style.borderColor = 'rgba(232,196,138,0.08)'; });
        item.querySelector('button')!.addEventListener('click', (e) => {
          e.stopPropagation();
          this.restoreSession(s.slot);
        });
        list.appendChild(item);
      }
    } catch (e) {
      list.innerHTML = '<div style="font-size:11px;color:#ff6b6b;text-align:center;padding:8px;">加载失败</div>';
    }
  }

  private async restoreSession(slot: string): Promise<void> {
    this.showToast('正在恢复历史记录...');
    try {
      const res = await fetch(`/__ce-api__/load-spine-session?slot=${encodeURIComponent(slot)}`);
      const data = await res.json();
      if (!data.success || !data.session) {
        this.showToast('❌ 恢复失败: ' + (data.error || '无数据'));
        return;
      }
      const s = data.session;
      if (this.state) {
        if (s.characterImage) this.state.characterImage = s.characterImage;
        if (s.explosionImage) { this.state.explosionImage = s.explosionImage; this.state.partRegions = []; }
        if (s.partRegions?.length) this.state.partRegions = s.partRegions;
        if (s.bindingJson) this.state.bindingJson = s.bindingJson;
        if (s.attachmentImages) this.state.attachmentImages = new Map(Object.entries(s.attachmentImages));
        if (s.animations) this.state.animations = new Map(Object.entries(s.animations));
        this.onStateChange?.();
      }
      if (s.characterImage) this.showSourcePreview(s.characterImage);
      if (s.explosionImage) {
        if (s.partRegions?.filter((r: any) => r.width > 0).length > 0) {
          this.showPartGridPreview();
        } else {
          this.showResultPreview(s.explosionImage);
        }
      }
      this.updateButtons();
      this.showToast('✅ 已恢复历史记录');
    } catch (e: any) {
      this.showToast('❌ 恢复失败: ' + e.message);
    }
  }

  activate(state: StudioState): void {
    this.state = state;
    this.syncGenderUI();
    if (this.annotCanvas) { this.updateButtons(); return; }
    void this.refreshSourcePreview();
    const assignedParts = state.partRegions?.filter(r => r.width > 0).length ?? 0;
    if (state.explosionImage) {
      if (assignedParts > 0) {
        this.showPartGridPreview();
        const title = this.q('#expl-right-title') as HTMLElement;
        if (title) title.textContent = `已标注 ${assignedParts}/${PART_NAMES.length} 个部件`;
      } else {
        this.showResultPreview(state.explosionImage);
      }
    }
    const rerollBtn = this.q('#expl-reroll') as HTMLElement;
    if (rerollBtn && state.explosionImage && this.lastPrompt) rerollBtn.style.display = '';
    this.updateButtons();
  }

  deactivate(): void { this.stopAnnotateLoop(); this.resizeObs?.disconnect(); }
  dispose(): void { this.stopAnnotateLoop(); this.resizeObs?.disconnect(); this.container.remove(); this.sidePanel.remove(); this.centerView.remove(); }
}
