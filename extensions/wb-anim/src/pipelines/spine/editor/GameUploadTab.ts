// @source wb-character/src/pipelines/spine/editor/GameUploadTab.ts
import type { StudioState, StudioTab, TabId } from './StudioState';
import type { RawSpineJson, RawAttachment } from './types';
import { saveCustomCharacter, CUSTOM_CHAR_KEY, studioSave, type CustomCharacterData } from './StudioStorage';
import { spineIcon, spineBtnLabel } from './spine-icons';

export class GameUploadTab implements StudioTab {
  readonly id: TabId = 'upload';
  readonly container: HTMLDivElement;
  readonly sidePanel: HTMLDivElement;
  readonly centerView = null;
  readonly centerToolbar = null;
  readonly bottomPanel = null;
  readonly rightPanel = null;

  private state: StudioState | null = null;
  private onStateChange: (() => void) | null = null;
  private animWorkshopRef: { exportSkeletonJson: () => RawSpineJson } | null = null;

  constructor(parent: HTMLElement, onStateChange: () => void) {
    this.onStateChange = onStateChange;
    this.container = document.createElement('div');
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    this.sidePanel = document.createElement('div');
    this.sidePanel.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;padding:12px;gap:12px;';

    this.buildUI();
  }

  setAnimWorkshopRef(ref: { exportSkeletonJson: () => RawSpineJson }): void {
    this.animWorkshopRef = ref;
  }

  private q(selector: string): HTMLElement | null {
    return this.sidePanel.querySelector(selector);
  }

  private buildUI(): void {
    this.sidePanel.innerHTML = `
      <div class="gu-header" style="text-align:center;">
        <div class="gu-title">${spineIcon('rocket', 'spine-icon-svg gu-title-icon')} 导出 & 上传</div>
        <div class="gu-subtitle" style="font-size:11px;">导出 Spine 资产并加载到游戏</div>
      </div>

      <div class="gu-checklist">
        <div class="gu-check-item" id="gu-check-prof">
          <span class="gu-check-icon">${spineIcon('circle', 'gu-check-svg')}</span>
          <span class="gu-check-text">职业选择</span>
          <span class="gu-check-detail" id="gu-detail-prof">-</span>
        </div>
        <div class="gu-check-item" id="gu-check-char">
          <span class="gu-check-icon">${spineIcon('circle', 'gu-check-svg')}</span>
          <span class="gu-check-text">角色立绘</span>
          <span class="gu-check-detail" id="gu-detail-char">未生成</span>
        </div>
        <div class="gu-check-item" id="gu-check-bind">
          <span class="gu-check-icon">${spineIcon('circle', 'gu-check-svg')}</span>
          <span class="gu-check-text">骨骼绑定</span>
          <span class="gu-check-detail" id="gu-detail-bind">未绑定</span>
        </div>
        <div class="gu-check-item" id="gu-check-anim">
          <span class="gu-check-icon">${spineIcon('circle', 'gu-check-svg')}</span>
          <span class="gu-check-text">至少 1 个动画</span>
          <span class="gu-check-detail" id="gu-detail-anim">0 个动画</span>
        </div>
      </div>

      <div class="gu-export-section">
        <div class="sd-section-title" style="font-size:12px;">导出配置</div>
        <div class="gu-config">
          <label class="gu-config-row">
            <span>角色名称</span>
            <input type="text" class="gu-input" id="gu-name" value="custom_character" />
          </label>
          <label class="gu-config-row">
            <span>格式</span>
            <select class="gu-input" id="gu-format">
              <option value="json">Spine JSON (4.2)</option>
              <option value="bundle">JSON + 图片包</option>
            </select>
          </label>
        </div>
      </div>

      <div class="gu-actions" style="flex-direction:column;">
        <button class="sd-action-btn sd-step-btn" id="gu-export-json" disabled>${spineBtnLabel('box', '导出 Spine JSON')}</button>
        <button class="sd-action-btn sd-step-btn" id="gu-export-images" disabled>${spineBtnLabel('image', '导出部件图片')}</button>
        <button class="sd-gen-btn" id="gu-inject" disabled>${spineBtnLabel('rocket', '注入到游戏 (HMR)')}</button>
        <button class="sd-action-btn gu-play-btn" id="gu-play" style="display:none;">${spineBtnLabel('gamepad', '关闭编辑器 → 进入游戏')}</button>
      </div>

      <div class="gu-log" id="gu-log"></div>
    `;

    this.q('#gu-export-json')?.addEventListener('click', () => this.exportJson());
    this.q('#gu-export-images')?.addEventListener('click', () => this.exportImages());
    this.q('#gu-inject')?.addEventListener('click', () => this.injectToGame());
    this.q('#gu-play')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('vag-studio-close'));
    });
  }

  private exportJson(): void {
    if (!this.state?.bindingJson) return;

    const name = (this.q('#gu-name') as HTMLInputElement).value.trim() || 'custom_character';
    let json: RawSpineJson;

    if (this.animWorkshopRef) {
      json = this.animWorkshopRef.exportSkeletonJson();
    } else {
      json = JSON.parse(JSON.stringify(this.state.bindingJson));
    }

    if (this.state.attachmentImages.size > 0) {
      this.injectAttachmentData(json);
    }

    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    this.addLog(`✅ 已导出 ${name}.json (${(blob.size / 1024).toFixed(1)} KB)`);
  }

  private exportImages(): void {
    if (!this.state?.attachmentImages || this.state.attachmentImages.size === 0) return;

    const name = (this.q('#gu-name') as HTMLInputElement).value.trim() || 'custom_character';

    const canvas = this.generateSpritesheet();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      this.addLog(`✅ 已导出 ${name}.png spritesheet (${(blob.size / 1024).toFixed(1)} KB)`);
    });

    const atlasText = this.generateAtlasText(name, canvas.width, canvas.height);
    const atlasBlob = new Blob([atlasText], { type: 'text/plain' });
    const ab = document.createElement('a');
    ab.href = URL.createObjectURL(atlasBlob);
    ab.download = `${name}.atlas`;
    ab.click();
    URL.revokeObjectURL(ab.href);
    this.addLog(`✅ 已导出 ${name}.atlas`);
  }

  private generateSpritesheet(): HTMLCanvasElement {
    const images = this.state!.attachmentImages;
    const parts: { id: string; img: HTMLImageElement; w: number; h: number }[] = [];

    for (const [id, dataUrl] of images) {
      const img = new Image();
      img.src = dataUrl;
      parts.push({ id, img, w: img.width, h: img.height });
    }

    const maxW = 512;
    let x = 0, y = 0, rowH = 0;
    const positions: { id: string; x: number; y: number; w: number; h: number }[] = [];

    for (const part of parts) {
      if (x + part.w > maxW) {
        x = 0;
        y += rowH + 2;
        rowH = 0;
      }
      positions.push({ id: part.id, x, y, w: part.w, h: part.h });
      x += part.w + 2;
      rowH = Math.max(rowH, part.h);
    }

    const totalH = y + rowH;
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d')!;

    for (let i = 0; i < parts.length; i++) {
      const pos = positions[i];
      ctx.drawImage(parts[i].img, pos.x, pos.y);
    }

    (canvas as any).__positions = positions;
    return canvas;
  }

  private generateAtlasText(name: string, w: number, h: number): string {
    const canvas = this.generateSpritesheet();
    const positions = (canvas as any).__positions as { id: string; x: number; y: number; w: number; h: number }[] | undefined;
    const lines: string[] = [
      `${name}.png`,
      `size:${w},${h}`,
      `filter:Linear,Linear`,
      `pma:true`,
    ];

    if (positions) {
      for (const pos of positions) {
        lines.push(pos.id);
        lines.push(`bounds:${pos.x},${pos.y},${pos.w},${pos.h}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  private injectAttachmentData(json: RawSpineJson): void {
    if (!json.skins || json.skins.length === 0) {
      json.skins = [{ name: 'default' }];
    }
    const hasAttachments = json.skins[0].attachments
      && Object.keys(json.skins[0].attachments).length > 0;
    if (hasAttachments) return;

    const src = this.state?.bindingJson;
    if (src?.skins?.[0]?.attachments) {
      json.skins[0].attachments = JSON.parse(JSON.stringify(src.skins[0].attachments));
      if (src.slots) {
        for (const srcSlot of src.slots) {
          if (!srcSlot.attachment) continue;
          const tgtSlot = json.slots?.find((s: any) => s.name === srcSlot.name);
          if (tgtSlot && !tgtSlot.attachment) {
            tgtSlot.attachment = srcSlot.attachment;
          }
        }
      }
    }
  }

  private async injectToGame(): Promise<void> {
    const btn = this.q('#gu-inject') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '⏳ 注入中...';
    this.addLog('正在准备注入数据...');

    try {
      const json = this.animWorkshopRef
        ? this.animWorkshopRef.exportSkeletonJson()
        : JSON.parse(JSON.stringify(this.state?.bindingJson));

      const name = (this.q('#gu-name') as HTMLInputElement).value.trim() || 'custom_character';

      const images = this.state?.attachmentImages;
      if (!images || images.size === 0) {
        this.addLog('⚠️ 没有部件图片，尝试仅注入骨骼数据...');
      }

      this.addLog('正在生成 spritesheet...');
      const imgCount = images?.size ?? 0;
      const { spritesheetDataUrl, atlasText } = await this.buildSpritesheetAndAtlas(name, images ?? new Map());
      this.addLog(`✅ Spritesheet 生成完成 (${imgCount} parts)`);

      const customEvent = new CustomEvent('vag-character-inject', {
        detail: { json, spritesheetDataUrl, atlasText, name }
      });
      window.dispatchEvent(customEvent);
      this.addLog('✅ 已发送注入事件到游戏运行时');

      const charData: CustomCharacterData = {
        name,
        spineJson: json,
        atlasText,
        spritesheetDataUrl,
        profession: this.state?.profession ?? 'melee',
        timestamp: Date.now(),
      };
      const charId = await saveCustomCharacter(charData);
      this.addLog(`✅ 角色 "${name}" 已保存 (${charId})`);

      const playBtn = this.q('#gu-play') as HTMLButtonElement;
      if (playBtn) playBtn.style.display = 'block';

      if (this.state) {
        this.state.exportPath = 'injected';
        this.onStateChange?.();
      }
    } catch (e) {
      this.addLog('❌ 注入失败: ' + (e as Error).message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = spineBtnLabel('rocket', '注入到游戏 (HMR)');
    }
  }

  private async buildSpritesheetAndAtlas(
    name: string,
    images: Map<string, string>
  ): Promise<{ spritesheetDataUrl: string; atlasText: string }> {
    const parts: { id: string; img: HTMLImageElement; w: number; h: number }[] = [];

    const loadPromises: Promise<void>[] = [];
    for (const [id, dataUrl] of images) {
      loadPromises.push(new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { parts.push({ id, img, w: img.width, h: img.height }); resolve(); };
        img.onerror = () => resolve();
        img.src = dataUrl;
      }));
    }
    await Promise.all(loadPromises);

    if (parts.length === 0) {
      return { spritesheetDataUrl: '', atlasText: '' };
    }

    const maxW = 512;
    let x = 0, y = 0, rowH = 0;
    const positions: { id: string; x: number; y: number; w: number; h: number }[] = [];

    for (const part of parts) {
      if (x + part.w > maxW) { x = 0; y += rowH + 2; rowH = 0; }
      positions.push({ id: part.id, x, y, w: part.w, h: part.h });
      x += part.w + 2;
      rowH = Math.max(rowH, part.h);
    }

    const totalH = y + rowH;
    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = totalH || 1;
    const ctx = canvas.getContext('2d')!;

    for (let i = 0; i < parts.length; i++) {
      ctx.drawImage(parts[i].img, positions[i].x, positions[i].y);
    }

    const spritesheetDataUrl = canvas.toDataURL('image/png');

    const atlasLines: string[] = [
      `${name}.png`,
      `size:${maxW},${totalH}`,
      `filter:Nearest,Nearest`,
      `pma:false`,
    ];
    for (const pos of positions) {
      atlasLines.push(pos.id);
      atlasLines.push(`bounds:${pos.x},${pos.y},${pos.w},${pos.h}`);
    }
    const atlasText = atlasLines.join('\n') + '\n';

    return { spritesheetDataUrl, atlasText };
  }

  private addLog(msg: string): void {
    const log = this.q('#gu-log') as HTMLElement;
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'gu-log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  activate(state: StudioState): void {
    this.state = state;
    this.updateChecklist();
  }

  private updateChecklist(): void {
    if (!this.state) return;

    const hasProf = true;
    const hasChar = !!this.state.characterImage;
    const hasBind = !!this.state.bindingJson;
    const animCount = this.state.bindingSkeleton?.animations.size ?? 0;
    const hasAnim = animCount > 0;

    this.setCheck('gu-check-prof', hasProf,
      this.state.profession === 'ranged' ? '远程' : '近战');
    this.setCheck('gu-check-char', hasChar,
      hasChar ? '✅ 已生成' : '未生成');
    this.setCheck('gu-check-bind', hasBind,
      hasBind ? `✅ ${this.state.bindingSkeleton?.boneOrder.length ?? 0} 骨骼` : '未绑定');
    this.setCheck('gu-check-anim', hasAnim,
      `${animCount} 个动画`);

    const canExport = hasBind;
    (this.q('#gu-export-json') as HTMLButtonElement).disabled = !canExport;
    (this.q('#gu-export-images') as HTMLButtonElement).disabled = !this.state.attachmentImages?.size;
    (this.q('#gu-inject') as HTMLButtonElement).disabled = !canExport;
  }

  private setCheck(id: string, done: boolean, detail: string): void {
    const el = this.q(`#${id}`) as HTMLElement;
    if (!el) return;
    const iconEl = el.querySelector('.gu-check-icon')!;
    iconEl.innerHTML = done ? spineIcon('check', 'gu-check-svg done') : spineIcon('circle', 'gu-check-svg');
    el.classList.toggle('done', done);

    const detailId = id.replace('gu-check-', 'gu-detail-');
    const detailEl = this.q(`#${detailId}`) as HTMLElement;
    if (detailEl) detailEl.textContent = detail;
  }

  deactivate(): void {}

  dispose(): void {
    this.container.remove();
    this.sidePanel.remove();
  }
}
