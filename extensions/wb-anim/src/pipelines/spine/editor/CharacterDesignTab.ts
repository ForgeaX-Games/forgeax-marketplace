// @source wb-character/src/pipelines/spine/editor/CharacterDesignTab.ts
import type { StudioState, StudioTab, TabId, Profession } from './StudioState';
import { spineIcon, spineBtnLabel } from './spine-icons';

export class CharacterDesignTab implements StudioTab {
  readonly id: TabId = 'design';
  readonly container: HTMLDivElement;
  readonly sidePanel: HTMLDivElement;
  readonly centerView: HTMLDivElement;
  readonly centerToolbar = null;
  readonly bottomPanel = null;
  readonly rightPanel = null;

  private state: StudioState | null = null;
  private onStateChange: (() => void) | null = null;
  private refImageData: string | null = null;
  private activeMethod: 'text' | 'upload' | 'direct' = 'text';

  constructor(parent: HTMLElement, onStateChange: () => void) {
    this.onStateChange = onStateChange;
    this.container = document.createElement('div');
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.sidePanel = document.createElement('div');
    this.sidePanel.className = 'sd-side-panel';
    this.sidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:16px;gap:16px;';

    this.centerView = document.createElement('div');
    this.centerView.className = 'sd-center-view';
    this.centerView.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:16px;gap:12px;';

    this.buildUI();
  }

  private q(selector: string): HTMLElement | null {
    return this.sidePanel.querySelector(selector) ?? this.centerView.querySelector(selector) ?? null;
  }

  private buildUI(): void {
    this.sidePanel.innerHTML = `
      <div class="sd-section">
        <div class="sd-section-title">① 选择职业</div>
        <div class="sd-prof-grid">
          <div class="sd-prof-card active" data-prof="melee">
            <div class="sd-prof-icon">⚔️</div>
            <div class="sd-prof-name">近战</div>
            <div class="sd-prof-desc">刀剑类武器，近身格斗</div>
          </div>
          <div class="sd-prof-card" data-prof="ranged">
            <div class="sd-prof-icon">🔫</div>
            <div class="sd-prof-name">远程</div>
            <div class="sd-prof-desc">枪械类武器，远距离射击</div>
          </div>
        </div>
      </div>

      <div class="sd-section">
        <div class="sd-section-title">② 角色生成</div>
        <div class="sd-method-tabs">
          <button class="sd-method-tab active" data-method="text">${spineBtnLabel('list', '文字描述生成')}</button>
          <button class="sd-method-tab" data-method="upload">${spineBtnLabel('image', '上传图片风格化')}</button>
          <button class="sd-method-tab" data-method="direct">${spineBtnLabel('upload', '直接上传角色图')}</button>
        </div>

        <div class="sd-method-panel" id="sd-method-text">
          <textarea class="sd-prompt" id="sd-text-prompt" rows="4"
            placeholder="描述你想要的角色，例如：&#10;一个穿着暗红色铠甲的骑士，持大剑，银色护甲，黑色披风...&#10;&#10;提示：会自动补充游戏角色风格化描述"></textarea>
          <div class="sd-gen-row">
            <button class="sd-gen-btn" id="sd-gen-text">${spineBtnLabel('sparkles', '复制提示词 + 生成路径')}</button>
          </div>
          <div class="sd-gen-hint">
            复制后在 Cursor Agent 中粘贴执行，或直接上传已有角色图
          </div>
        </div>

        <div class="sd-method-panel" id="sd-method-upload" style="display:none">
          <div class="sd-upload-zone" id="sd-upload-ref">
            <div class="sd-upload-hint">${spineIcon('image', 'spine-icon-svg')} 拖拽图片到此处，或点击上传</div>
            <div class="sd-upload-sub">支持头像、全身照、二次元图片</div>
          </div>
          <textarea class="sd-prompt" id="sd-style-prompt" rows="2"
            placeholder="风格化指令（可选）：例如 像素风、赛博朋克风格..."></textarea>
          <div class="sd-gen-row">
            <button class="sd-gen-btn" id="sd-gen-img2img" disabled>${spineBtnLabel('sparkles', '复制图生图提示词')}</button>
          </div>
          <div class="sd-gen-hint">将上传的图片与提示词一起发给 Cursor Agent 进行风格化</div>
        </div>

        <div class="sd-method-panel" id="sd-method-direct" style="display:none">
          <div class="sd-upload-zone" id="sd-upload-direct">
            <div class="sd-upload-hint">${spineIcon('upload', 'spine-icon-svg')} 拖拽角色图片到此处</div>
            <div class="sd-upload-sub">直接使用此图作为角色立绘，进入爆炸图转换</div>
          </div>
        </div>
      </div>

      <div class="sd-state-bar" id="sd-state-bar">
        <span class="sd-state-item">职业: <b id="sd-state-prof">近战</b></span>
        <span class="sd-state-item">角色: <b id="sd-state-char">未选择</b></span>
      </div>
    `;

    this.centerView.innerHTML = `
      <div class="sd-preview-title">角色预览</div>
      <div class="sd-preview" id="sd-preview" style="flex:1;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);border-radius:10px;border:1px solid rgba(232,196,138,0.1);overflow:hidden;">
        <div class="sd-preview-empty">
          <div class="sd-preview-empty-icon">${spineIcon('image')}</div>
          <div>选择生成方式后预览角色</div>
          <div class="sd-preview-tip">支持上传任意图片作为角色</div>
        </div>
      </div>
      <div class="sd-preview-actions" id="sd-preview-actions" style="display:none">
        <button class="sd-action-btn" id="sd-clear">${spineBtnLabel('trash', '清除')}</button>
        <button class="sd-action-btn sd-action-primary" id="sd-confirm">确认 → 进入爆炸图</button>
      </div>
    `;

    this.wireEvents();
  }

  private wireEvents(): void {
    this.sidePanel.querySelectorAll('.sd-prof-card').forEach(card => {
      card.addEventListener('click', () => {
        this.sidePanel.querySelectorAll('.sd-prof-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const prof = (card as HTMLElement).dataset.prof as Profession;
        if (this.state) {
          this.state.profession = prof;
          this.updateStateBar();
          this.onStateChange?.();
        }
      });
    });

    this.sidePanel.querySelectorAll('.sd-method-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.sidePanel.querySelectorAll('.sd-method-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeMethod = (tab as HTMLElement).dataset.method as 'text' | 'upload' | 'direct';
        this.sidePanel.querySelectorAll('.sd-method-panel').forEach(p => (p as HTMLElement).style.display = 'none');
        const panel = this.sidePanel.querySelector(`#sd-method-${this.activeMethod}`) as HTMLElement;
        if (panel) panel.style.display = 'block';
      });
    });

    this.setupUploadZone('sd-upload-ref', 'ref');
    this.setupUploadZone('sd-upload-direct', 'direct');

    this.q('#sd-gen-text')?.addEventListener('click', () => this.generateTextPrompt());
    this.q('#sd-gen-img2img')?.addEventListener('click', () => this.generateImg2ImgPrompt());
    this.q('#sd-clear')?.addEventListener('click', () => this.clearPreview());
    this.q('#sd-confirm')?.addEventListener('click', () => this.confirmCharacter());

    const textPrompt = this.q('#sd-text-prompt') as HTMLTextAreaElement;
    if (textPrompt) {
      textPrompt.addEventListener('input', () => {
        if (this.state) this.state.characterDescription = textPrompt.value.trim();
      });
    }
  }

  private setupUploadZone(zoneId: string, mode: 'ref' | 'direct'): void {
    const zone = this.q(`#${zoneId}`) as HTMLElement;
    if (!zone) return;

    zone.addEventListener('click', () => this.pickImage(mode));
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer?.files[0];
      if (file && file.type.startsWith('image/')) this.handleImageFile(file, mode);
    });
  }

  private pickImage(mode: 'ref' | 'direct'): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) this.handleImageFile(file, mode);
    };
    input.click();
  }

  private handleImageFile(file: File, mode: 'ref' | 'direct'): void {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (mode === 'direct') {
        this.setPreview(dataUrl);
        if (this.state) {
          this.state.characterImage = dataUrl;
          this.updateStateBar();
          this.onStateChange?.();
        }
      } else {
        this.refImageData = dataUrl;
        const zone = this.q('#sd-upload-ref') as HTMLElement;
        zone.innerHTML = `
          <img src="${dataUrl}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:4px;">
          <div class="sd-upload-sub" style="margin-top:4px;">点击可重新上传</div>
        `;
        zone.addEventListener('click', () => this.pickImage('ref'), { once: true });
        (this.q('#sd-gen-img2img') as HTMLButtonElement).disabled = false;
      }
    };
    reader.readAsDataURL(file);
  }

  private setPreview(dataUrl: string): void {
    const preview = this.q('#sd-preview') as HTMLElement;
    preview.innerHTML = `<img src="${dataUrl}" class="sd-preview-img">`;
    const actions = this.q('#sd-preview-actions') as HTMLElement;
    actions.style.display = 'flex';
  }

  private clearPreview(): void {
    if (this.state) {
      this.state.characterImage = null;
      this.updateStateBar();
    }
    const preview = this.q('#sd-preview') as HTMLElement;
    preview.innerHTML = `
      <div class="sd-preview-empty">
        <div class="sd-preview-empty-icon">${spineIcon('image')}</div>
        <div>选择生成方式后预览角色</div>
      </div>
    `;
    const actions = this.q('#sd-preview-actions') as HTMLElement;
    actions.style.display = 'none';
  }

  private generateTextPrompt(): void {
    const rawPrompt = (this.q('#sd-text-prompt') as HTMLTextAreaElement).value.trim();
    if (!rawPrompt) {
      this.showToast('请输入角色描述');
      return;
    }

    const prof = this.state?.profession === 'ranged' ? '枪手' : '近战战士';
    const fullPrompt =
      `Game character full body illustration, ${rawPrompt}, ` +
      `${prof} class, 2D side-scrolling action game style, ` +
      `clean white background, facing right, dynamic pose, ` +
      `pixel-art inspired, vibrant colors, clear silhouette, ` +
      `suitable for Spine 2D skeletal animation`;

    const outputPath = `${(globalThis as { CHARACTER_DESIGN_OUTPUT_DIR?: string }).CHARACTER_DESIGN_OUTPUT_DIR ?? '<absolute-path-to-repo>/playgrounds/1_dnf'}/assets/spine/custom/character_design.png`;

    const mcpCmd = [
      '请调用 image-gemini MCP text_to_image:',
      `prompt: "${fullPrompt}"`,
      `outputPath: "${outputPath}"`,
      `aspectRatio: "3:4"`,
    ].join('\n');

    navigator.clipboard.writeText(mcpCmd).then(() => {
      this.showToast('✅ 已复制到剪贴板！粘贴到 Cursor Agent 执行');
    }).catch(() => {
      const preview = this.q('#sd-preview') as HTMLElement;
      preview.innerHTML = `
        <div class="sd-preview-empty" style="padding:16px;text-align:left;">
          <div style="font-size:12px;color:#e8c48a;margin-bottom:8px;">📋 复制以下内容到 Cursor Agent:</div>
          <pre style="font-size:10px;color:#88ff88;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,0.3);padding:8px;border-radius:4px;">${mcpCmd}</pre>
        </div>
      `;
    });
  }

  private generateImg2ImgPrompt(): void {
    if (!this.refImageData) return;

    const stylePrompt = (this.q('#sd-style-prompt') as HTMLTextAreaElement).value.trim();
    const prof = this.state?.profession === 'ranged' ? 'ranged gunner' : 'melee swordsman';
    const fullPrompt =
      `Transform this image into a game character illustration. ` +
      `Style: 2D side-scrolling action game, ${prof} class. ` +
      (stylePrompt ? `Additional style: ${stylePrompt}. ` : '') +
      `Clean white background, facing right, clear silhouette, ` +
      `full body view suitable for skeletal animation parts extraction.`;

    const outputPath = `${(globalThis as { CHARACTER_DESIGN_OUTPUT_DIR?: string }).CHARACTER_DESIGN_OUTPUT_DIR ?? '<absolute-path-to-repo>/playgrounds/1_dnf'}/assets/spine/custom/character_design.png`;

    const mcpCmd = [
      '请调用 image-gemini MCP image_to_image:',
      `prompt: "${fullPrompt}"`,
      `outputPath: "${outputPath}"`,
      `（将上传的参考图作为 inputImagePaths 或 inputImageBase64s 传入）`,
    ].join('\n');

    navigator.clipboard.writeText(mcpCmd).then(() => {
      this.showToast('✅ 已复制到剪贴板！');
    }).catch(() => {
      this.showToast('复制失败，请手动复制');
    });
  }

  private confirmCharacter(): void {
    if (!this.state?.characterImage) {
      this.showToast('请先上传或生成角色图片');
      return;
    }
    this.state.activeTab = 'explosion';
    this.onStateChange?.();
  }

  private showToast(msg: string): void {
    let toast = document.querySelector('.sd-toast') as HTMLElement;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'sd-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  private updateStateBar(): void {
    const profEl = this.q('#sd-state-prof') as HTMLElement;
    const charEl = this.q('#sd-state-char') as HTMLElement;
    if (profEl) profEl.textContent = this.state?.profession === 'ranged' ? '远程' : '近战';
    if (charEl) charEl.textContent = this.state?.characterImage ? '✅ 已选择' : '未选择';
  }

  activate(state: StudioState): void {
    this.state = state;
    this.sidePanel.querySelectorAll('.sd-prof-card').forEach(card => {
      card.classList.toggle('active', (card as HTMLElement).dataset.prof === state.profession);
    });
    if (state.characterImage) {
      this.setPreview(state.characterImage);
    }
    this.updateStateBar();
  }

  deactivate(): void {}

  dispose(): void {
    this.container.remove();
    this.sidePanel.remove();
    this.centerView.remove();
  }
}
