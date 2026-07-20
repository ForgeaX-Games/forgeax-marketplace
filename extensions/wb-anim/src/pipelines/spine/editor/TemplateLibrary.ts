// @source wb-character/src/pipelines/spine/editor/TemplateLibrary.ts
import type { RawSpineJson, EditorSkeleton } from './types';
import { parseSpineJson } from './SpineDataParser';
import { spineIcon, spineBtnLabel } from './spine-icons';

export interface SkeletonTemplate {
  id: string;
  name: string;
  description: string;
  category: 'humanoid' | 'chibi' | 'quadruped' | 'winged' | 'imported' | 'game';
  thumbnail: string;
  skeleton: RawSpineJson | null;
  jsonUrl?: string;
  spritesheetUrl?: string;
  atlasText?: string;
  atlasUrl?: string;
  thumbnailUrl?: string;
}

export interface AtlasRegion {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: boolean;
}

export function parseAtlasText(text: string): AtlasRegion[] {
  const regions: AtlasRegion[] = [];
  const lines = text.split('\n').map(l => l.trimEnd());
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('size:') || line.startsWith('filter:') || line.startsWith('pma:')
        || line.startsWith('format:') || line.startsWith('repeat:')
        || line.trim() === '' || line.endsWith('.png')) {
      i++;
      continue;
    }
    const name = line.trim();
    if (!name) { i++; continue; }
    let bx = -1, by = -1, bw = 0, bh = 0, rotate = false;
    i++;
    while (i < lines.length) {
      const prop = lines[i].trim();
      if (prop.startsWith('bounds:')) {
        const parts = prop.replace('bounds:', '').split(',').map(Number);
        [bx, by, bw, bh] = parts;
      } else if (prop.startsWith('xy:')) {
        const parts = prop.replace('xy:', '').split(',').map(s => Number(s.trim()));
        [bx, by] = parts;
      } else if (prop.startsWith('size:') && bx >= 0) {
        const parts = prop.replace('size:', '').split(',').map(s => Number(s.trim()));
        [bw, bh] = parts;
      } else if (prop.startsWith('rotate:')) {
        rotate = prop.includes('90') || prop.includes('true');
      } else if (prop.startsWith('offsets:') || prop.startsWith('orig:') || prop.startsWith('offset:') || prop.startsWith('index:')) {
        // skip
      } else {
        break;
      }
      i++;
    }
    if (bw > 0 && bh > 0) {
      regions.push({ name, x: Math.max(bx, 0), y: Math.max(by, 0), w: bw, h: bh, rotate });
    }
  }
  return regions;
}

export async function cropAtlasRegions(
  pngUrl: string,
  atlasText: string,
): Promise<Map<string, HTMLImageElement>> {
  const regions = parseAtlasText(atlasText);
  const img = await loadImage(pngUrl);
  const result = new Map<string, HTMLImageElement>();

  for (const r of regions) {
    const cvs = document.createElement('canvas');
    const ctx = cvs.getContext('2d')!;
    if (r.rotate) {
      // r.w and r.h are ORIGINAL dimensions.
      // In the atlas, because it's rotated 90 degrees, it occupies r.h width and r.w height.
      cvs.width = r.w;
      cvs.height = r.h;
      
      // We want to draw the rotated atlas region (r.h x r.w) into our unrotated canvas (r.w x r.h).
      // Atlas rotate: 90 means the image was rotated 90 degrees counter-clockwise before packing.
      // So to restore, we must rotate +90 degrees (clockwise in canvas, where Y is down).
      ctx.translate(r.w / 2, r.h / 2);
      ctx.rotate(Math.PI / 2);
      // The region in the atlas has width = r.h, height = r.w
      ctx.drawImage(img, r.x, r.y, r.h, r.w, -r.h / 2, -r.w / 2, r.h, r.w);
    } else {
      cvs.width = r.w;
      cvs.height = r.h;
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    const cropped = new Image();
    cropped.src = cvs.toDataURL('image/png');
    result.set(r.name, cropped);
  }
  return result;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const HUMANOID_STANDARD: RawSpineJson = {
  skeleton: { hash: 'template-humanoid', spine: '4.2', width: 200, height: 400 },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', x: 0, y: 200 },
    { name: 'spine', parent: 'hip', length: 50, rotation: 90, x: 0, y: 0 },
    { name: 'chest', parent: 'spine', length: 45, rotation: 0, x: 50, y: 0 },
    { name: 'neck', parent: 'chest', length: 20, rotation: 0, x: 45, y: 0 },
    { name: 'head', parent: 'neck', length: 35, rotation: 0, x: 20, y: 0 },
    { name: 'shoulder_l', parent: 'chest', length: 15, rotation: -90, x: 40, y: 10 },
    { name: 'upper_arm_l', parent: 'shoulder_l', length: 40, rotation: -10, x: 15, y: 0 },
    { name: 'forearm_l', parent: 'upper_arm_l', length: 35, rotation: 0, x: 40, y: 0 },
    { name: 'hand_l', parent: 'forearm_l', length: 15, rotation: 0, x: 35, y: 0 },
    { name: 'shoulder_r', parent: 'chest', length: 15, rotation: -90, x: 40, y: -10 },
    { name: 'upper_arm_r', parent: 'shoulder_r', length: 40, rotation: 10, x: 15, y: 0 },
    { name: 'forearm_r', parent: 'upper_arm_r', length: 35, rotation: 0, x: 40, y: 0 },
    { name: 'hand_r', parent: 'forearm_r', length: 15, rotation: 0, x: 35, y: 0 },
    { name: 'weapon_slot', parent: 'hand_r', length: 30, rotation: 0, x: 15, y: 0 },
    { name: 'thigh_l', parent: 'hip', length: 45, rotation: -90, x: 0, y: 10 },
    { name: 'shin_l', parent: 'thigh_l', length: 42, rotation: 0, x: 45, y: 0 },
    { name: 'foot_l', parent: 'shin_l', length: 20, rotation: 90, x: 42, y: 0 },
    { name: 'thigh_r', parent: 'hip', length: 45, rotation: -90, x: 0, y: -10 },
    { name: 'shin_r', parent: 'thigh_r', length: 42, rotation: 0, x: 45, y: 0 },
    { name: 'foot_r', parent: 'shin_r', length: 20, rotation: 90, x: 42, y: 0 },
    { name: 'leg_l_ik_target', parent: 'root', x: -10, y: 10 },
    { name: 'leg_r_ik_target', parent: 'root', x: -10, y: -10 },
  ],
  slots: [
    { name: 'head', bone: 'head' },
    { name: 'chest', bone: 'chest' },
    { name: 'hip', bone: 'hip' },
    { name: 'upper_arm_l', bone: 'upper_arm_l' },
    { name: 'forearm_l', bone: 'forearm_l' },
    { name: 'hand_l', bone: 'hand_l' },
    { name: 'upper_arm_r', bone: 'upper_arm_r' },
    { name: 'forearm_r', bone: 'forearm_r' },
    { name: 'hand_r', bone: 'hand_r' },
    { name: 'weapon', bone: 'weapon_slot' },
    { name: 'thigh_l', bone: 'thigh_l' },
    { name: 'shin_l', bone: 'shin_l' },
    { name: 'foot_l', bone: 'foot_l' },
    { name: 'thigh_r', bone: 'thigh_r' },
    { name: 'shin_r', bone: 'shin_r' },
    { name: 'foot_r', bone: 'foot_r' },
  ],
  ik: [
    { name: 'leg_l_ik', bones: ['thigh_l', 'shin_l'], target: 'leg_l_ik_target', bendPositive: false },
    { name: 'leg_r_ik', bones: ['thigh_r', 'shin_r'], target: 'leg_r_ik_target', bendPositive: false },
  ],
  skins: [{ name: 'default' }],
  animations: {
    idle: {
      bones: {
        spine: { rotate: [{ time: 0, value: 0 }, { time: 0.6, value: 2 }, { time: 1.2, value: 0 }] },
        chest: { rotate: [{ time: 0, value: 0 }, { time: 0.6, value: 1.5 }, { time: 1.2, value: 0 }] },
        head: { rotate: [{ time: 0, value: 0 }, { time: 0.4, value: -1 }, { time: 0.8, value: 1 }, { time: 1.2, value: 0 }] },
        upper_arm_l: { rotate: [{ time: 0, value: 0 }, { time: 0.6, value: -2 }, { time: 1.2, value: 0 }] },
        upper_arm_r: { rotate: [{ time: 0, value: 0 }, { time: 0.6, value: 2 }, { time: 1.2, value: 0 }] },
      },
    },
  },
};

const CHIBI_HUMANOID: RawSpineJson = {
  skeleton: { hash: 'template-chibi', spine: '4.2', width: 150, height: 250 },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', x: 0, y: 100 },
    { name: 'spine', parent: 'hip', length: 30, rotation: 90, x: 0, y: 0 },
    { name: 'chest', parent: 'spine', length: 25, rotation: 0, x: 30, y: 0 },
    { name: 'head', parent: 'chest', length: 50, rotation: 0, x: 25, y: 0 },
    { name: 'arm_l', parent: 'chest', length: 40, rotation: -100, x: 20, y: 10 },
    { name: 'hand_l', parent: 'arm_l', length: 12, rotation: 0, x: 40, y: 0 },
    { name: 'arm_r', parent: 'chest', length: 40, rotation: -80, x: 20, y: -10 },
    { name: 'hand_r', parent: 'arm_r', length: 12, rotation: 0, x: 40, y: 0 },
    { name: 'weapon', parent: 'hand_r', length: 25, rotation: 0, x: 12, y: 0 },
    { name: 'leg_l', parent: 'hip', length: 35, rotation: -90, x: 0, y: 8 },
    { name: 'foot_l', parent: 'leg_l', length: 15, rotation: 80, x: 35, y: 0 },
    { name: 'leg_r', parent: 'hip', length: 35, rotation: -90, x: 0, y: -8 },
    { name: 'foot_r', parent: 'leg_r', length: 15, rotation: 80, x: 35, y: 0 },
  ],
  slots: [
    { name: 'head', bone: 'head' },
    { name: 'body', bone: 'chest' },
    { name: 'arm_l', bone: 'arm_l' },
    { name: 'arm_r', bone: 'arm_r' },
    { name: 'weapon', bone: 'weapon' },
    { name: 'leg_l', bone: 'leg_l' },
    { name: 'leg_r', bone: 'leg_r' },
  ],
  ik: [],
  skins: [{ name: 'default' }],
  animations: {
    idle: {
      bones: {
        spine: { rotate: [{ time: 0, value: 0 }, { time: 0.5, value: 3 }, { time: 1.0, value: 0 }] },
        head: { rotate: [{ time: 0, value: 0 }, { time: 0.3, value: -2 }, { time: 0.7, value: 2 }, { time: 1.0, value: 0 }] },
      },
    },
  },
};

const GUAIWU_ATLAS = `skeleton.png
size:297,102
filter:Linear,Linear
pma:true
shadow
bounds:229,2,25,26
offsets:3,2,30,30
rotate:90
圖層 3
bounds:229,29,71,66
rotate:90
圖層 3 - 副本
bounds:2,16,84,113
offsets:11,56,100,200
rotate:90
圖層 3 - 副本 (2)
bounds:117,18,82,110
offsets:8,67,100,200
rotate:90
資料夾 2
bounds:149,2,14,30
rotate:90
資料夾 2 - 副本
bounds:117,2,14,30
rotate:90
資料夾 3
bounds:257,4,23,30
offsets:0,0,23,32
rotate:90
資料夾 4
bounds:181,4,12,19
rotate:90
資料夾 5
bounds:2,2,12,19
rotate:90
資料夾 5 - 副本
bounds:202,4,12,19
rotate:90`;

const ZMB2_ATLAS = `zmb_2.png
size:156,244
filter:Linear,Linear
pma:true
1 拷贝
bounds:2,123,119,81
rotate:90
1 拷贝1
bounds:2,40,119,81
gw1nt1
bounds:123,83,30,47
offsets:0,0,31,47
gw1nt1b
bounds:123,34,30,47
offsets:0,0,31,47
gw1nt2
bounds:136,223,19,18
rotate:90
gw1nt2b
bounds:136,202,19,18
rotate:90
gw1wt1
bounds:85,183,49,59
gw1wt1b
bounds:85,132,49,59
rotate:90
gw1wt2
bounds:2,2,51,36
gw1wt2b
bounds:55,2,51,36
shadow
bounds:108,6,25,26
offsets:3,2,30,30`;

const BUILT_IN_TEMPLATES: SkeletonTemplate[] = [
  {
    id: 'male-warrior',
    name: '男性战士骨骼',
    description: '25 骨骼 16 插槽，含 attack/idle/run/walk 等 13 套完整动画，IK 腿部约束。推荐默认模板。',
    category: 'humanoid',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine-assets/male-template/skeleton.json',
    spritesheetUrl: 'spine-assets/male-template/skeleton.png',
    atlasUrl: 'spine-assets/male-template/skeleton.atlas',
    thumbnailUrl: 'spine-assets/male-template/thumbnail.png',
  },
  {
    id: 'game-ghost-swordsman',
    name: '🎮 鬼剑士 (dz_g)',
    description: '游戏内玩家角色「鬼剑士」，完整 Spine 骨骼 + 全套动画 + 贴图。含武器、特效等复杂骨骼。',
    category: 'game',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine/player/dz_g.json',
    spritesheetUrl: 'spine/player/dz_g.png',
    atlasUrl: 'spine/player/dz_g.atlas',
    thumbnailUrl: 'spine/player/dz_g.png',
  },
  {
    id: 'game-berserker',
    name: '🎮 狂战士 (dz_j)',
    description: '游戏内玩家角色「狂战士」，完整 Spine 骨骼 + 全套动画 + 贴图。含武器、特效等复杂骨骼。',
    category: 'game',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine/player/dz_j.json',
    spritesheetUrl: 'spine/player/dz_j.png',
    atlasUrl: 'spine/player/dz_j.atlas',
    thumbnailUrl: 'spine/player/dz_j.png',
  },
  {
    id: 'game-monster',
    name: '🎮 怪物 (guaiwu)',
    description: '游戏内怪物角色，含多套换肤和攻击动画。可用作敌人角色模板。',
    category: 'game',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine/guaiwu/skeleton.json',
    spritesheetUrl: 'spine/guaiwu/skeleton.png',
    atlasText: GUAIWU_ATLAS,
    thumbnailUrl: 'spine/guaiwu/skeleton.png',
  },
  {
    id: 'game-zombie',
    name: '🎮 僵尸 (zmb2)',
    description: '游戏内僵尸角色，含多套换肤和攻击动画。可用作敌人角色模板。',
    category: 'game',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine/zmb2/zmb_2.json',
    spritesheetUrl: 'spine/zmb2/zmb_2.png',
    atlasText: ZMB2_ATLAS,
    thumbnailUrl: 'spine/zmb2/zmb_2.png',
  },
  {
    id: 'ref-character',
    name: '参考角色（完整）',
    description: '男性战士参考角色，含贴图、IK、13 套动画。可直接在编辑器中预览完整效果。',
    category: 'humanoid',
    thumbnail: '',
    skeleton: null,
    jsonUrl: 'spine-assets/male-template/skeleton.json',
    spritesheetUrl: 'spine-assets/male-template/skeleton.png',
    atlasUrl: 'spine-assets/male-template/skeleton.atlas',
    thumbnailUrl: 'spine-assets/male-template/thumbnail.png',
  },
  {
    id: 'humanoid-standard',
    name: '标准人形',
    description: '25 根骨骼的人形骨架，含 IK 腿部、武器插槽。适用于战士、法师等角色。',
    category: 'humanoid',
    thumbnail: '🧍',
    skeleton: HUMANOID_STANDARD,
  },
  {
    id: 'humanoid-chibi',
    name: 'Q版人形',
    description: '14 根骨骼的 Q 版/SD 角色。大头简化四肢，适合休闲/可爱风格游戏。',
    category: 'chibi',
    thumbnail: '🧸',
    skeleton: CHIBI_HUMANOID,
  },
];

const ATLAS_CONTENT = `skeleton.png
size:284,111
filter:Linear,Linear
pma:true
右大腿
bounds:172,2,16,27
右大臂
bounds:233,41,17,30
右小腿
bounds:252,55,16,30
rotate:90
右小臂
bounds:200,39,31,32
右脚
bounds:210,5,32,17
rotate:90
头
bounds:2,3,123,106
左大腿
bounds:190,5,18,24
左大臂
bounds:252,31,22,29
rotate:90
左小腿
bounds:248,8,21,29
rotate:90
左小臂
bounds:172,31,26,40
左脚
bounds:229,6,31,17
rotate:90
武器-刀
bounds:127,73,152,36
躯干
bounds:127,16,43,55`;

export class TemplateLibrary {
  private root: HTMLDivElement;
  private grid: HTMLDivElement;
  private importedTemplates: SkeletonTemplate[] = [];

  onTemplateSelect: ((template: SkeletonTemplate) => void) | null = null;
  onTemplateSelectAsync: ((template: SkeletonTemplate) => Promise<void>) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'se-tmpl-lib';
    container.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'se-tmpl-header';
    header.innerHTML = `
      <span class="se-tmpl-title">模板库</span>
      <button class="se-tmpl-import-btn" title="导入外部 skeleton.json">${spineBtnLabel('upload', '导入文件')}</button>
    `;
    this.root.appendChild(header);

    header.querySelector('.se-tmpl-import-btn')!.addEventListener('click', () => this.importFromFile());

    this.grid = document.createElement('div');
    this.grid.className = 'se-tmpl-grid';
    this.root.appendChild(this.grid);

    this.loadSavedTemplates();
    this.renderCards();
  }

  private renderCards(): void {
    this.grid.innerHTML = '';
    const all = [...BUILT_IN_TEMPLATES, ...this.importedTemplates];
    for (const tmpl of all) {
      const card = document.createElement('div');
      card.className = 'se-tmpl-card';
      if (tmpl.category === 'game') card.classList.add('se-tmpl-featured');

      const thumbHtml = tmpl.thumbnailUrl
        ? `<img class="se-tmpl-thumb-img" src="${tmpl.thumbnailUrl}" alt="${tmpl.name}" />`
        : `<div class="se-tmpl-thumb-emoji">${tmpl.thumbnail || '📦'}</div>`;

      const boneCount = tmpl.skeleton ? tmpl.skeleton.bones.length : '?';
      const slotCount = tmpl.skeleton ? tmpl.skeleton.slots.length : '?';
      const ikCount = tmpl.skeleton ? (tmpl.skeleton.ik ?? []).length : '?';

      card.innerHTML = `
        <div class="se-tmpl-thumb">${thumbHtml}</div>
        <div class="se-tmpl-info">
          <div class="se-tmpl-name">${tmpl.name}</div>
          <div class="se-tmpl-desc">${tmpl.description}</div>
          <div class="se-tmpl-meta">${boneCount} bones | ${slotCount} slots | ${ikCount} IK</div>
        </div>
      `;

      card.addEventListener('click', () => this.selectTemplate(tmpl));
      this.grid.appendChild(card);
    }
  }

  async selectTemplate(tmpl: SkeletonTemplate): Promise<void> {
    if (tmpl.jsonUrl && !tmpl.skeleton) {
      try {
        const resp = await fetch(tmpl.jsonUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json() as RawSpineJson;
        tmpl.skeleton = json;
      } catch (e) {
        console.error('Failed to load skeleton JSON:', e);
        return;
      }
    }
    if (tmpl.atlasUrl && !tmpl.atlasText) {
      try {
        const resp = await fetch(tmpl.atlasUrl);
        if (resp.ok) tmpl.atlasText = await resp.text();
      } catch (e) {
        console.warn('Failed to load atlas:', e);
      }
    }
    if (tmpl.skeleton) {
      if (this.onTemplateSelectAsync) {
        await this.onTemplateSelectAsync(tmpl);
      } else {
        this.onTemplateSelect?.(tmpl);
      }
    }
  }

  private importFromFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = false;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text) as RawSpineJson;
        if (!json.bones || !json.skeleton) {
          alert('无效的 Spine JSON 文件');
          return;
        }
        const name = file.name.replace('.json', '');
        const tmpl: SkeletonTemplate = {
          id: `imported-${Date.now()}`,
          name: `导入: ${name}`,
          description: `从文件 ${file.name} 导入，${json.bones.length} 根骨骼`,
          category: 'imported',
          thumbnail: '📥',
          skeleton: json,
        };
        this.importedTemplates.push(tmpl);
        this.renderCards();

        const atlasInput = document.createElement('input');
        atlasInput.type = 'file';
        atlasInput.accept = '.atlas,.txt';
        if (confirm(`是否同时导入 ${name} 的 atlas 文件？（可提供贴图裁切信息）`)) {
          atlasInput.addEventListener('change', async () => {
            const af = atlasInput.files?.[0];
            if (af) {
              tmpl.atlasText = await af.text();
              this.renderCards();
            }
          });
          atlasInput.click();
        }
      } catch {
        alert('JSON 解析失败');
      }
    });
    input.click();
  }

  addSavedTemplate(tmpl: SkeletonTemplate): void {
    this.importedTemplates.push(tmpl);
    this.renderCards();
    try {
      const saved = JSON.parse(localStorage.getItem('se-saved-templates') ?? '[]');
      saved.push({ id: tmpl.id, name: tmpl.name, description: tmpl.description, skeleton: tmpl.skeleton });
      localStorage.setItem('se-saved-templates', JSON.stringify(saved));
    } catch { /* storage full or unavailable */ }
  }

  private loadSavedTemplates(): void {
    try {
      const saved = JSON.parse(localStorage.getItem('se-saved-templates') ?? '[]');
      for (const s of saved) {
        this.importedTemplates.push({
          id: s.id,
          name: s.name,
          description: s.description,
          category: 'imported',
          thumbnail: '💾',
          skeleton: s.skeleton,
        });
      }
    } catch { /* ignore */ }
  }

  getTemplates(): SkeletonTemplate[] {
    return [...BUILT_IN_TEMPLATES, ...this.importedTemplates];
  }

  getTemplateById(id: string): SkeletonTemplate | undefined {
    return this.getTemplates().find(t => t.id === id);
  }
}
