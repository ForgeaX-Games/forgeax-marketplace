import genreLayoutStyles from '../genre-layout-styles.css?raw'
import previewScreenStyles from '../preview-screen-styles.css?raw'
import type { GenreScreenLayoutSpec } from '../layout-specs/types'
import { shouldShowModuleInLayout } from '../layout-engine'
import type { LayoutPreviewScreenContext, LayoutPrototypeScreenContext } from './types'

const PUZZLE_BOARD_TILES = ['◆', '●', '★', '■', '▲']

function renderPuzzleBoardCells(cols = 8, rows = 8): string {
  const total = cols * rows
  return Array.from({ length: total }, (_, i) => {
    const tile = PUZZLE_BOARD_TILES[i % PUZZLE_BOARD_TILES.length] ?? '◆'
    return `<span data-tile="${i % PUZZLE_BOARD_TILES.length}">${tile}</span>`
  }).join('')
}

function showModule(
  spec: GenreScreenLayoutSpec,
  hasModule: (id: string) => boolean,
  moduleId: string,
): boolean {
  return shouldShowModuleInLayout(spec, moduleId, hasModule(moduleId))
}

function skillRow(keys: string[]): string {
  return keys.map((k, i) => `
    <div class="gl-skill uid-live-icon-${i % 4}"><span>${k}</span></div>
  `).join('')
}

function hotbar(count: number, label = ''): string {
  return Array.from({ length: count }, (_, i) => `
    <div class="gl-hotbar-slot uid-live-icon-${i % 4}">${label || i + 1}</div>
  `).join('')
}

function survivalHotbar(count: number): string {
  return Array.from({ length: count }, (_, i) => `
    <div class="gl-hotbar-slot gl-surv-slot uid-live-icon-${i % 4}${i === 0 ? ' active' : ''}">${i + 1}</div>
  `).join('')
}

function mmoModBar(keys: string[]): string {
  return keys.map((k, i) => `
    <div class="gl-hotbar-slot gl-mmo-skill gl-mmo-skill--mod uid-live-icon-${i % 4}"><em>${k}</em></div>
  `).join('')
}

function mmoMainBar(count = 12): string {
  return Array.from({ length: count }, (_, i) => `
    <div class="gl-hotbar-slot gl-mmo-skill uid-live-icon-${i % 4}${i === 0 ? ' active' : ''}">${i + 1}</div>
  `).join('')
}

function startTagline(ctx: LayoutPreviewScreenContext): string {
  return ctx.playerFantasy || ctx.blueprint.stage.playerGoal
}

export function previewOpenWorldCinematicStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  const renderedIds = showModule(spec, hasModule, 'main-nav') ? ['main-nav'] : []
  return `
    <div class="upv-start upv-start--open-world">
      <div class="gl-ow-brand">${esc(genreLabel)}</div>
      <p class="gl-ow-tagline">${esc(startTagline(ctx))}</p>
      <nav class="gl-ow-rail">
        <button type="button" class="upv-start-item primary">开始游戏</button>
        <button type="button" class="upv-start-item">继续</button>
        <button type="button" class="upv-start-item">在线</button>
        <button type="button" class="upv-start-item">设置</button>
      </nav>
      <div class="gl-ow-meta">版本 1.0 · 开放世界</div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewOpenWorldExploreHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds = ['minimap', 'quest-tracker', 'health-status', 'skill-bar', 'interaction-hints', 'currency', 'weapon-hud'].filter(id => show(id))
  return `
    <div class="upv-hud upv-hud--open-world">
      ${show('minimap') ? '<div class="upv-hud-minimap gl-ow-map"><div class="upv-hud-minimap-dot"></div><span class="gl-map-n">N</span></div>' : ''}
      ${show('currency') ? '<div class="gl-ow-money">$ 24,800</div>' : ''}
      ${show('quest-tracker') ? `<div class="upv-hud-quest gl-ow-quest"><div class="upv-hud-label">主线</div><div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div></div>` : ''}
      ${show('interaction-hints') ? `<div class="gl-ow-interact">△ ${esc(blueprint.stage.cta)}</div>` : ''}
      ${show('health-status') ? '<div class="upv-hud-health gl-ow-vital"><div class="upv-hud-label">HP</div><div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:68%"></div></div></div>' : ''}
      ${show('health-status') ? '<div class="upv-hud-stamina gl-ow-stamina"><div class="upv-hud-label">体力</div><div class="upv-hud-bar"><div class="upv-hud-bar-fill sta" style="width:52%"></div></div></div>' : ''}
      ${show('skill-bar') ? `<div class="upv-hud-skills gl-ow-skills">${skillRow(['1', '2', '3', '4'])}</div>` : ''}
      ${show('weapon-hud') ? '<div class="gl-ow-weapon"><span>手枪</span><strong>12 / 48</strong></div>' : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewOpenWorldInventory(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const tabs = ['武器', '装备', '消耗品', '材料']
  const railIcons = ['包', '剑', '盾', '晶', '书', '设']
  const itemNames = [
    '精铁剑', '治疗药水', '魔法卷轴', '皮革甲', '守护戒指', '迅捷靴',
    '火焰符石', '冰霜碎片', '远古钥匙', '宝石袋', '强化石', '任务信物',
    '银币包', '地图碎片', '神秘盒', '星辉石', '龙鳞片', '风之羽',
  ]
  const detailTitle = '魔法卷轴'
  const renderedIds: string[] = []
  if (show('inventory-grid')) renderedIds.push('inventory-grid')
  if (show('item-detail')) renderedIds.push('item-detail')
  if (show('currency')) renderedIds.push('currency')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('crafting-panel')) renderedIds.push('crafting-panel')
  return `
    <div class="upv-bag upv-bag--open-world">
      <aside class="gl-ow-bag-rail" aria-label="背包分类">
        ${railIcons.map((icon, i) => `
          <button type="button" class="gl-ow-bag-rail-btn${i === 1 ? ' active' : ''}${i === 2 ? ' notify' : ''}">
            <span>${esc(icon)}</span>
          </button>
        `).join('')}
      </aside>
      <section class="gl-ow-bag-main">
        <header class="gl-ow-bag-header">
          <div class="gl-ow-bag-heading">
            <h1 class="gl-ow-bag-title">背包 / 道具</h1>
            <p class="gl-ow-bag-sub">${esc(blueprint.stage.playerGoal)}</p>
          </div>
          <div class="gl-ow-bag-wallet">
            ${show('currency') ? '<span class="gl-ow-bag-chip">金币 <strong>7,100,908</strong></span>' : ''}
            ${show('resource-tracker') ? '<span class="gl-ow-bag-chip">容量 <strong>50 / 2000</strong></span>' : ''}
          </div>
        </header>
        <nav class="gl-ow-bag-tabs" aria-label="物品分类">
          ${tabs.map((t, i) => `<button type="button" class="gl-ow-bag-tab${i === 0 ? ' active' : ''}">${esc(t)}</button>`).join('')}
        </nav>
        <div class="gl-ow-bag-grid">
          ${itemNames.map((name, i) => `
            <button type="button" class="gl-ow-bag-slot${i === 2 ? ' selected' : ''}${i % 6 === 0 ? ' rare' : ''}">
              <span class="gl-ow-bag-slot-icon uid-live-icon-${i % 4}">道具</span>
              <span class="gl-ow-bag-slot-name">${esc(name)}</span>
              <span class="gl-ow-bag-slot-meta">★★★</span>
            </button>
          `).join('')}
        </div>
        <footer class="gl-ow-bag-toolbar">
          <button type="button" class="gl-ow-bag-tool">筛选 / 全部</button>
          <button type="button" class="gl-ow-bag-tool">品质排序</button>
          <span class="gl-ow-bag-count">已选 1 · 共 ${itemNames.length} 件</span>
        </footer>
      </section>
      <aside class="gl-ow-bag-detail">
        <div class="gl-ow-bag-detail-card">
          <div class="gl-ow-bag-detail-art uid-live-icon-2" aria-hidden="true"><span>道具预览</span></div>
          <div class="gl-ow-bag-detail-body">
            <h2 class="gl-ow-bag-detail-title">${esc(detailTitle)}</h2>
            <div class="gl-ow-bag-detail-kind">稀有道具 · 消耗品</div>
            <div class="gl-ow-bag-detail-stars">★★★★☆</div>
            <p class="gl-ow-bag-detail-desc">可装备或使用的核心物品，影响角色成长与战斗表现。使用后获得元素增益。</p>
            <div class="gl-ow-bag-detail-bars">
              <div class="gl-ow-bag-bar"><span>等级</span><div class="gl-ow-bag-bar-track"><i style="width:53%"></i></div><em>8/15</em></div>
              <div class="gl-ow-bag-bar"><span>评分</span><div class="gl-ow-bag-bar-track"><i style="width:72%"></i></div><em>608</em></div>
            </div>
            ${show('crafting-panel') ? `
              <div class="gl-ow-bag-craft">
                <div class="gl-ow-bag-craft-title">制作需求</div>
                <div class="gl-ow-bag-craft-mats"><span>木材 12/20</span><span>铁锭 5/15</span></div>
              </div>
            ` : ''}
          </div>
          <button type="button" class="gl-ow-bag-action primary">使用</button>
        </div>
      </aside>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewOpenWorldCharacterSheet(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const equipSlots = [
    { id: 'weapon', label: '武器', name: '精铁长剑', lv: 'Lv.90', active: true },
    { id: 'head', label: '头部', name: '冒险家帽', lv: 'Lv.80' },
    { id: 'body', label: '躯干', name: '皮革胸甲', lv: 'Lv.75' },
    { id: 'legs', label: '腿部', name: '迅捷护腿', lv: 'Lv.70' },
    { id: 'acc1', label: '饰品', name: '守护戒指', lv: 'Lv.60' },
    { id: 'acc2', label: '饰品', name: '风之羽', lv: 'Lv.55' },
  ]
  const coreStats = [
    { label: '生命值', value: '18,420' },
    { label: '攻击力', value: '1,248' },
    { label: '防御力', value: '892' },
    { label: '体力', value: '160' },
    { label: '暴击率', value: '32.4%' },
    { label: '暴击伤害', value: '68.2%' },
  ]
  const renderedIds: string[] = []
  if (show('character-panel')) renderedIds.push('character-panel')
  if (show('item-detail')) renderedIds.push('item-detail')
  return `
    <div class="upv-char upv-char--open-world">
      <section class="gl-ow-char-center">
        <header class="gl-ow-char-header">
          <div class="gl-ow-char-heading">
            <h1 class="gl-ow-char-title">角色</h1>
            <p class="gl-ow-char-sub">${esc(blueprint.stage.playerGoal)}</p>
          </div>
          <nav class="gl-ow-char-tabs" aria-label="角色页签">
            <button type="button" class="gl-ow-char-tab active">属性</button>
            <button type="button" class="gl-ow-char-tab">天赋</button>
            <button type="button" class="gl-ow-char-tab">履历</button>
          </nav>
          <button type="button" class="gl-ow-char-bag-link">打开背包</button>
        </header>
        <div class="gl-ow-char-showcase">
          <div class="gl-ow-char-model uid-live-icon-0" aria-hidden="true">
            <span class="gl-ow-char-model-label">角色立绘</span>
            <span class="gl-ow-char-element">风</span>
          </div>
          <div class="gl-ow-char-equip-ring" aria-label="装备栏">
            ${equipSlots.map((slot, i) => `
              <button type="button" class="gl-ow-char-equip${slot.active ? ' active' : ''}" data-slot="${esc(slot.id)}" style="--slot-i:${i}">
                <span class="gl-ow-char-equip-label">${esc(slot.label)}</span>
                <span class="gl-ow-char-equip-name">${esc(slot.name)}</span>
                <span class="gl-ow-char-equip-lv">${esc(slot.lv)}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <footer class="gl-ow-char-footer">
          <span class="gl-ow-char-world-lv">世界等级 <strong>6</strong></span>
          <span class="gl-ow-char-exp">冒险等阶 <strong>58</strong> · 经验 42,800 / 60,000</span>
        </footer>
      </section>
      <aside class="gl-ow-char-side">
        ${show('character-panel') ? `
          <div class="gl-ow-char-panel">
            <div class="gl-ow-char-hero-meta">
              <h2 class="gl-ow-char-name">旅行者</h2>
              <div class="gl-ow-char-badges">
                <span class="gl-ow-char-badge">Lv.90</span>
                <span class="gl-ow-char-badge accent">风 · 单手剑</span>
              </div>
              <div class="gl-ow-char-exp-bar"><i style="width:71%"></i></div>
            </div>
            <div class="gl-ow-char-stats-head">基础属性</div>
            <dl class="gl-ow-char-stats">
              ${coreStats.map(s => `
                <div class="gl-ow-char-stat">
                  <dt>${esc(s.label)}</dt>
                  <dd>${esc(s.value)}</dd>
                </div>
              `).join('')}
            </dl>
            <div class="gl-ow-char-talent-hint">
              <span>天赋点</span>
              <strong>3</strong>
              <button type="button" class="gl-ow-char-talent-btn">天赋升级</button>
            </div>
          </div>
        ` : ''}
        ${show('item-detail') ? `
          <div class="gl-ow-char-gear-detail">
            <div class="gl-ow-char-gear-art uid-live-icon-2" aria-hidden="true"><span>武器</span></div>
            <h3 class="gl-ow-char-gear-title">精铁长剑</h3>
            <div class="gl-ow-char-gear-kind">单手剑 · 五星</div>
            <div class="gl-ow-char-gear-stars">★★★★★</div>
            <p class="gl-ow-char-gear-desc">装备中。攻击力与暴击伤害提升，适合风元素扩散流派。</p>
            <dl class="gl-ow-char-gear-stats">
              <div><dt>基础攻击</dt><dd>608</dd></div>
              <div><dt>暴击伤害</dt><dd>66.2%</dd></div>
              <div><dt>精炼</dt><dd>3 / 5</dd></div>
            </dl>
            <button type="button" class="gl-ow-char-gear-action primary">更换装备</button>
          </div>
        ` : ''}
      </aside>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewOpenWorldNpcDialog(ctx: LayoutPreviewScreenContext): string {
  const { esc, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const options = ['继续', '追问细节', '接受任务', '[离开]']
  const renderedIds: string[] = []
  if (show('dialog-box')) renderedIds.push('dialog-box')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  return `
    <div class="upv-dialog upv-dialog--open-world">
      <div class="gl-ow-dialog-vignette" aria-hidden="true"></div>
      ${show('quest-tracker') ? `
        <aside class="gl-ow-dialog-quest">
          <div class="gl-ow-dialog-quest-label">任务追踪</div>
          <p class="gl-ow-dialog-quest-text">${esc(blueprint.stage.playerGoal)}</p>
          <div class="gl-ow-dialog-quest-bar"><i style="width:42%"></i></div>
        </aside>
      ` : ''}
      <div class="gl-ow-dialog-stage" aria-hidden="true"></div>
      <div class="gl-ow-dialog-dock">
        <div class="gl-ow-dialog-portrait uid-live-icon-0">
          <span class="gl-ow-dialog-portrait-label">NPC 立绘</span>
        </div>
        <div class="gl-ow-dialog-panel">
          <div class="gl-ow-dialog-speaker">
            <span class="gl-ow-dialog-role">神秘商人</span>
            <span class="gl-ow-dialog-faction">流浪商贩</span>
          </div>
          <p class="gl-ow-dialog-text">「${esc(blueprint.stage.playerGoal)}……你看起来正是我需要的人。」</p>
          ${show('interaction-hints') ? `
            <div class="gl-ow-dialog-interact"><kbd>△</kbd><span>${esc(blueprint.stage.cta)}</span></div>
          ` : ''}
          <div class="upv-dialog-options">
            ${options.map((o, i) => `<button type="button" class="upv-dialog-opt${i === 0 ? ' primary' : ''}">${esc(o)}</button>`).join('')}
          </div>
        </div>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── Action RPG (Genshin / ARPG style) ──────────────────────────────────────

export function previewArpgInventory(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const tabs = ['武器', '圣遗物', '消耗品', '材料', '任务']
  const itemNames = [
    '祭礼弓', '天空之翼', '西风剑', '流浪乐章', '讨龙英杰谭',
    '宗室长剑', '试作斩岩', '黑缨枪', '匣里灭辰', '雨裁',
    '风鹰剑', '终末嗟叹', '狼的末路', '天空之卷', '无工之剑',
  ]
  const renderedIds: string[] = []
  if (show('inventory-grid')) renderedIds.push('inventory-grid')
  if (show('item-detail')) renderedIds.push('item-detail')
  if (show('currency')) renderedIds.push('currency')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  return `
    <div class="upv-bag upv-bag--arpg">
      <section class="gl-arpg-bag-main">
        <header class="gl-arpg-bag-header">
          <div class="gl-arpg-bag-heading">
            <h1 class="gl-arpg-bag-title">背包</h1>
            <p class="gl-arpg-bag-sub">${esc(blueprint.stage.playerGoal)}</p>
          </div>
          <div class="gl-arpg-bag-wallet">
            ${show('currency') ? `
              <span class="gl-arpg-bag-chip primogem">原石 <strong>1,280</strong></span>
              <span class="gl-arpg-bag-chip mora">摩拉 <strong>7,100,908</strong></span>
            ` : ''}
            ${show('resource-tracker') ? '<span class="gl-arpg-bag-chip">容量 <strong>412 / 2000</strong></span>' : ''}
          </div>
        </header>
        <nav class="gl-arpg-bag-tabs" aria-label="物品分类">
          ${tabs.map((t, i) => `<button type="button" class="gl-arpg-bag-tab${i === 0 ? ' active' : ''}">${esc(t)}</button>`).join('')}
        </nav>
        <div class="gl-arpg-bag-grid">
          ${itemNames.map((name, i) => `
            <button type="button" class="gl-arpg-bag-slot${i === 0 ? ' selected' : ''}${i % 5 === 0 ? ' five-star' : ''}">
              <span class="gl-arpg-bag-slot-icon uid-live-icon-${i % 4}">武</span>
              <span class="gl-arpg-bag-slot-name">${esc(name)}</span>
              <span class="gl-arpg-bag-slot-meta">Lv.${[90, 80, 70, 60, 50][i % 5]}</span>
            </button>
          `).join('')}
        </div>
        <footer class="gl-arpg-bag-toolbar">
          <button type="button" class="gl-arpg-bag-tool">筛选</button>
          <button type="button" class="gl-arpg-bag-tool">等级顺序</button>
          <span class="gl-arpg-bag-count">已选 1 · 五星武器 × 3</span>
        </footer>
      </section>
      <aside class="gl-arpg-bag-detail">
        <div class="gl-arpg-bag-detail-card">
          <div class="gl-arpg-bag-equip-hint">
            <span>当前角色</span>
            <strong>旅行者</strong>
            <em>风 · 单手剑</em>
          </div>
          <div class="gl-arpg-bag-detail-art uid-live-icon-0" aria-hidden="true"><span>武器预览</span></div>
          <div class="gl-arpg-bag-detail-body">
            <h2 class="gl-arpg-bag-detail-title">祭礼弓</h2>
            <div class="gl-arpg-bag-detail-kind">弓 · 四星</div>
            <div class="gl-arpg-bag-detail-stars">★★★★☆</div>
            <p class="gl-arpg-bag-detail-desc">元素战技命中时有概率重置技能冷却，适合辅助与循环流派。</p>
            <dl class="gl-arpg-bag-affixes">
              <div><dt>基础攻击</dt><dd>454</dd></div>
              <div><dt>元素充能</dt><dd>61.3%</dd></div>
              <div><dt>精炼</dt><dd>2 阶</dd></div>
              <div><dt>适用</dt><dd>菲谢尔、温迪</dd></div>
            </dl>
          </div>
          <div class="gl-arpg-bag-actions">
            <button type="button" class="gl-arpg-bag-action primary">装备</button>
            <button type="button" class="gl-arpg-bag-action">强化</button>
            <button type="button" class="gl-arpg-bag-action ghost">锁定</button>
          </div>
        </div>
      </aside>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewArpgCharacterSheet(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const roster = [
    { name: '旅行者', element: '风', lv: 90, active: true },
    { name: '安柏', element: '火', lv: 80 },
    { name: '丽莎', element: '雷', lv: 70 },
    { name: '凯亚', element: '冰', lv: 60 },
  ]
  const relicSlots = [
    { label: '生之花', name: '角斗士', lv: 'Lv.20' },
    { label: '死之羽', name: '翠绿之影', lv: 'Lv.20', active: true },
    { label: '时之沙', name: '绝缘之旗印', lv: 'Lv.20' },
    { label: '空之杯', name: '宗室', lv: 'Lv.20' },
    { label: '理之冠', name: '战狂', lv: 'Lv.20' },
  ]
  const talents = [
    { key: '普攻', lv: 10 },
    { key: '战技', lv: 9 },
    { key: '爆发', lv: 9 },
  ]
  const stats = [
    { label: '生命值', value: '21,840' },
    { label: '攻击力', value: '1,986' },
    { label: '防御力', value: '1,024' },
    { label: '元素精通', value: '186' },
    { label: '暴击率', value: '62.4%' },
    { label: '暴击伤害', value: '142.8%' },
  ]
  const renderedIds: string[] = []
  if (show('character-panel')) renderedIds.push('character-panel')
  if (show('item-detail')) renderedIds.push('item-detail')
  return `
    <div class="upv-char upv-char--arpg">
      <aside class="gl-arpg-char-roster" aria-label="角色列表">
        ${roster.map((c, i) => `
          <button type="button" class="gl-arpg-char-roster-card${c.active ? ' active' : ''}">
            <span class="gl-arpg-char-roster-art uid-live-icon-${i % 4}">${c.name.slice(0, 1)}</span>
            <span class="gl-arpg-char-roster-name">${esc(c.name)}</span>
            <span class="gl-arpg-char-roster-meta">Lv.${c.lv} · ${esc(c.element)}</span>
          </button>
        `).join('')}
      </aside>
      <main class="gl-arpg-char-stage">
        <header class="gl-arpg-char-header">
          <nav class="gl-arpg-char-tabs" aria-label="角色页签">
            <button type="button" class="gl-arpg-char-tab active">属性</button>
            <button type="button" class="gl-arpg-char-tab">命座</button>
            <button type="button" class="gl-arpg-char-tab">天赋</button>
            <button type="button" class="gl-arpg-char-tab">资料</button>
          </nav>
          <div class="gl-arpg-char-header-actions">
            <button type="button" class="gl-arpg-char-bag-link">武器背包</button>
            <button type="button" class="gl-arpg-char-close" aria-label="关闭">×</button>
          </div>
        </header>
        <div class="gl-arpg-char-body">
          <button type="button" class="gl-arpg-char-weapon-slot active">
            <span class="gl-arpg-char-slot-label">武器</span>
            <strong>天空之翼</strong>
            <em>Lv.90 · 弓</em>
          </button>
          <div class="gl-arpg-char-hero uid-live-icon-0">
            <span class="gl-arpg-char-hero-label">角色立绘</span>
            <div class="gl-arpg-char-constellation" aria-label="命座">
              ${Array.from({ length: 6 }, (_, i) => `<span class="${i < 4 ? 'on' : ''}"></span>`).join('')}
            </div>
            <div class="gl-arpg-char-hero-badge">风</div>
          </div>
          <div class="gl-arpg-char-relics" aria-label="圣遗物">
            ${relicSlots.map(slot => `
              <button type="button" class="gl-arpg-char-relic${slot.active ? ' active' : ''}">
                <span class="gl-arpg-char-relic-label">${esc(slot.label)}</span>
                <span class="gl-arpg-char-relic-name">${esc(slot.name)}</span>
                <span class="gl-arpg-char-relic-lv">${esc(slot.lv)}</span>
              </button>
            `).join('')}
          </div>
        </div>
        <footer class="gl-arpg-char-footer">
          <div class="gl-arpg-char-talents">
            ${talents.map(t => `
              <div class="gl-arpg-char-talent">
                <span>${esc(t.key)}</span>
                <strong>Lv.${t.lv}</strong>
              </div>
            `).join('')}
          </div>
          <div class="gl-arpg-char-footer-actions">
            <button type="button" class="gl-arpg-char-btn">突破</button>
            <button type="button" class="gl-arpg-char-btn primary">升级</button>
          </div>
        </footer>
      </main>
      <aside class="gl-arpg-char-side">
        ${show('character-panel') ? `
          <div class="gl-arpg-char-panel">
            <div class="gl-arpg-char-hero-meta">
              <h2 class="gl-arpg-char-name">旅行者</h2>
              <div class="gl-arpg-char-badges">
                <span class="gl-arpg-char-badge">Lv.90</span>
                <span class="gl-arpg-char-badge accent">风 · 单手剑</span>
                <span class="gl-arpg-char-badge">好感 10</span>
              </div>
              <div class="gl-arpg-char-exp-bar"><i style="width:84%"></i></div>
              <p class="gl-arpg-char-exp-text">经验 118,400 / 140,000</p>
            </div>
            <div class="gl-arpg-char-set">
              <span class="gl-arpg-char-set-name">翠绿之影 4 件套</span>
              <p>扩散伤害 +60% · 风元素伤害 +15%</p>
            </div>
            <div class="gl-arpg-char-stats-head">详细属性</div>
            <dl class="gl-arpg-char-stats">
              ${stats.map(s => `
                <div class="gl-arpg-char-stat">
                  <dt>${esc(s.label)}</dt>
                  <dd>${esc(s.value)}</dd>
                </div>
              `).join('')}
            </dl>
          </div>
        ` : ''}
        ${show('item-detail') ? `
          <div class="gl-arpg-char-gear-detail">
            <div class="gl-arpg-char-gear-art uid-live-icon-2"><span>圣遗物</span></div>
            <h3 class="gl-arpg-char-gear-title">翠绿之影的翎羽</h3>
            <div class="gl-arpg-char-gear-kind">死之羽 · 五星</div>
            <div class="gl-arpg-char-gear-stars">★★★★★</div>
            <dl class="gl-arpg-char-gear-stats">
              <div><dt>攻击力</dt><dd>+58</dd></div>
              <div><dt>暴击率</dt><dd>+6.6%</dd></div>
              <div><dt>暴击伤害</dt><dd>+21.8%</dd></div>
              <div><dt>元素精通</dt><dd>+42</dd></div>
            </dl>
            <button type="button" class="gl-arpg-char-gear-action primary">更换圣遗物</button>
          </div>
        ` : ''}
      </aside>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewArpgStoryDialog(ctx: LayoutPreviewScreenContext): string {
  const { esc, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const options = [
    { label: '我愿意接受任务', quest: true },
    { label: '告诉我更多', quest: false },
    { label: '以后再说', quest: false },
    { label: '[离开]', quest: false, leave: true },
  ]
  const renderedIds: string[] = []
  if (show('dialog-box')) renderedIds.push('dialog-box')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  return `
    <div class="upv-dialog upv-dialog--arpg">
      <div class="gl-arpg-dialog-letterbox gl-arpg-dialog-letterbox--top" aria-hidden="true"></div>
      <div class="gl-arpg-dialog-letterbox gl-arpg-dialog-letterbox--bottom" aria-hidden="true"></div>
      <div class="gl-arpg-dialog-vignette" aria-hidden="true"></div>
      <header class="gl-arpg-dialog-top">
        <div class="gl-arpg-dialog-meta">
          <span class="gl-arpg-dialog-quest-type">◆ 魔神任务</span>
          <span class="gl-arpg-dialog-chapter">第一章 · 风起之时</span>
        </div>
        <div class="gl-arpg-dialog-top-actions">
          <button type="button" class="gl-arpg-dialog-auto">自动</button>
          <button type="button" class="gl-arpg-dialog-skip">跳过</button>
        </div>
      </header>
      ${show('quest-tracker') ? `
        <aside class="gl-arpg-dialog-quest">
          <div class="gl-arpg-dialog-quest-label">任务目标</div>
          <p>${esc(blueprint.stage.playerGoal)}</p>
        </aside>
      ` : ''}
      <div class="gl-arpg-dialog-stage" aria-hidden="true"></div>
      <div class="gl-arpg-dialog-bottom">
        <aside class="gl-arpg-dialog-portrait uid-live-icon-0" aria-hidden="true">
          <div class="gl-arpg-dialog-portrait-name">
            <span class="gl-arpg-dialog-role">神秘商人</span>
            <span class="gl-arpg-dialog-faction">蒙德 · 路人</span>
          </div>
        </aside>
        <div class="gl-arpg-dialog-dock">
          <div class="gl-arpg-dialog-panel">
            <div class="gl-arpg-dialog-nameplate">
              <span class="gl-arpg-dialog-speaker">神秘商人</span>
              <button type="button" class="gl-arpg-dialog-voice" aria-label="语音">🔊</button>
            </div>
            <p class="gl-arpg-dialog-text">「${esc(blueprint.stage.playerGoal)}……你看起来正是我要找的人。」</p>
            ${show('interaction-hints') ? `
              <div class="gl-arpg-dialog-interact"><kbd>F</kbd><span>${esc(blueprint.stage.cta)}</span></div>
            ` : ''}
            <div class="upv-dialog-options gl-arpg-dialog-choices">
              ${options.map((o, i) => `
                <button type="button" class="upv-dialog-opt gl-arpg-dialog-opt${i === 0 ? ' primary' : ''}${o.leave ? ' leave' : ''}">
                  ${o.quest ? '<em class="gl-arpg-dialog-opt-mark">◆</em>' : ''}
                  <span>${esc(o.label)}</span>
                </button>
              `).join('')}
            </div>
            <div class="gl-arpg-dialog-advance" aria-hidden="true">▼ 点击继续</div>
          </div>
        </div>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewArpgBattleResults(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const loot = ['精锻用魔矿', '哀叙冰玉', '摩拉', '冒险阅历', '圣遗物', '角色经验']
  const mvpStats = [
    { label: '造成伤害', value: '128,420' },
    { label: '承受伤害', value: '12,340' },
    { label: '治疗量', value: '8,200' },
    { label: '元素爆发', value: '6 次' },
  ]
  const renderedIds: string[] = []
  if (show('reward-summary')) renderedIds.push('reward-summary')
  if (show('level-counter')) renderedIds.push('level-counter')
  if (show('scoreboard')) renderedIds.push('scoreboard')
  return `
    <div class="upv-results upv-results--arpg">
      <div class="gl-arpg-results-vignette" aria-hidden="true"></div>
      <header class="gl-arpg-results-header">
        <div class="gl-arpg-results-heading">
          ${show('level-counter') ? '<span class="gl-arpg-results-chamber">深境螺旋 · 第 12 层</span>' : '<span class="gl-arpg-results-chamber">秘境挑战</span>'}
          <span class="gl-arpg-results-sub">${esc(blueprint.stage.playerGoal)}</span>
        </div>
        ${show('level-counter') ? `
          <div class="gl-arpg-results-stars" aria-label="挑战评价">
            ${Array.from({ length: 3 }, (_, i) => `<span class="${i < 3 ? 'on' : ''}">★</span>`).join('')}
          </div>
        ` : ''}
      </header>
      <div class="gl-arpg-results-main">
        ${show('scoreboard') ? `
          <aside class="gl-arpg-results-mvp">
            <div class="gl-arpg-results-mvp-label">战斗统计 · MVP</div>
            <div class="gl-arpg-results-mvp-hero uid-live-icon-0">
              <span>旅行者</span>
              <em>风 · 单手剑</em>
            </div>
            <dl class="gl-arpg-results-combat-stats">
              ${mvpStats.map(s => `
                <div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>
              `).join('')}
            </dl>
          </aside>
        ` : ''}
        <section class="gl-arpg-results-hero">
          <div class="gl-arpg-results-rank gold">S+</div>
          <h1 class="gl-arpg-results-title">挑战成功</h1>
          <div class="gl-arpg-results-time">用时 <strong>02:14</strong></div>
          <div class="gl-arpg-results-brief">
            <span>最高连击 <b>42</b></span>
            <span>击破弱点 <b>3</b></span>
            <span>达成条件 <b>3/3</b></span>
          </div>
        </section>
        ${show('reward-summary') ? `
          <aside class="gl-arpg-results-loot">
            <div class="gl-arpg-results-loot-title">获得奖励</div>
            <div class="gl-arpg-results-items">
              ${loot.map((name, i) => `
                <div class="gl-arpg-results-item uid-live-icon-${i % 4}${i === 1 ? ' rare' : ''}">
                  <span>${esc(name)}</span>
                </div>
              `).join('')}
            </div>
            <div class="gl-arpg-results-currency">
              <span>冒险阅历 <strong>+1,200</strong></span>
              <span>摩拉 <strong>+24,800</strong></span>
              <span>原石 <strong>+20</strong></span>
            </div>
            <div class="gl-arpg-results-char-exp">
              <div class="gl-arpg-results-exp-row">
                <span>旅行者</span>
                <div class="gl-arpg-results-exp-bar"><i style="width:68%"></i></div>
                <em>Lv.58</em>
              </div>
            </div>
          </aside>
        ` : ''}
      </div>
      <footer class="gl-arpg-results-actions">
        <button type="button" class="upv-results-btn gl-arpg-results-btn">再次挑战</button>
        <button type="button" class="upv-results-btn gl-arpg-results-btn primary">${esc(blueprint.stage.cta)}</button>
        <button type="button" class="upv-results-btn gl-arpg-results-btn ghost">返回城镇</button>
      </footer>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewArpgHeroStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  return `
    <div class="upv-start upv-start--arpg">
      <aside class="gl-arpg-news">
        <div class="gl-arpg-news-title">公告</div>
        <div class="gl-arpg-news-item">新版本「深境螺旋」开启</div>
        <div class="gl-arpg-news-item">限时活动：元素试炼</div>
      </aside>
      <div class="gl-arpg-hero">
        <div class="gl-arpg-logo">${esc(genreLabel)}</div>
        <button type="button" class="upv-start-item primary gl-arpg-enter">进入游戏</button>
      </div>
      <nav class="gl-arpg-tabs">
        <button type="button" class="active">公告</button>
        <button type="button">活动</button>
        <button type="button">设置</button>
      </nav>
      ${renderModuleFeedback(showModule(spec, hasModule, 'main-nav') ? ['main-nav'] : [])}
    </div>
  `
}

export function previewArpgCombatHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('health-status')) renderedIds.push('health-status')
  if (show('skill-bar')) renderedIds.push('skill-bar')
  if (show('minimap')) renderedIds.push('minimap')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  return `
    <div class="upv-hud upv-hud--arpg">
      ${show('resource-tracker') ? `
        <div class="gl-arpg-boss">
          <span class="gl-arpg-boss-name">遗迹守卫</span>
          <div class="gl-arpg-boss-bar"><i style="width:42%"></i></div>
        </div>
      ` : ''}
      <div class="gl-arpg-hud-left-col">
        ${show('minimap') ? '<div class="upv-hud-minimap gl-arpg-minimap"><div class="upv-hud-minimap-dot"></div><span class="gl-map-n">N</span></div>' : ''}
        ${show('quest-tracker') ? `
          <div class="upv-hud-quest gl-arpg-quest">
            <div class="upv-hud-label">追踪</div>
            <div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div>
          </div>
        ` : ''}
      </div>
      ${show('health-status') ? `
        <div class="gl-arpg-vitals-dock">
          <div class="gl-arpg-party" aria-label="编队">
            <div class="gl-arpg-avatar active">主</div>
            <div class="gl-arpg-avatar">副1</div>
            <div class="gl-arpg-avatar">副2</div>
            <div class="gl-arpg-avatar">副3</div>
          </div>
          <div class="gl-arpg-vitals">
            <div class="gl-arpg-vital-row">
              <span class="gl-arpg-vital-label">HP</span>
              <div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:72%"></div></div>
            </div>
            <div class="gl-arpg-vital-row">
              <span class="gl-arpg-vital-label">元素</span>
              <div class="upv-hud-bar"><div class="upv-hud-bar-fill sta" style="width:58%"></div></div>
            </div>
          </div>
        </div>
      ` : ''}
      ${show('skill-bar') ? `
        <div class="gl-arpg-skills" aria-label="技能">
          <div class="gl-skill gl-arpg-skill-normal uid-live-icon-0"><span>攻</span></div>
          <div class="gl-skill gl-arpg-skill-e uid-live-icon-1"><span>E</span></div>
          <div class="gl-skill gl-arpg-skill-q uid-live-icon-2"><span>Q</span></div>
          <div class="gl-skill gl-arpg-skill-burst uid-live-icon-3"><span>爆发</span></div>
        </div>
      ` : ''}
      ${show('interaction-hints') ? `
        <div class="gl-arpg-hint">
          <b class="gl-arpg-hint-key">F</b>
          <span>${esc(blueprint.stage.cta)}</span>
        </div>
      ` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewArpgSystemPause(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, genreLabel, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const quickLinks = [
    { icon: '包', label: '背包', sub: '道具与材料' },
    { icon: '角', label: '角色', sub: '编队与养成' },
    { icon: '图', label: '地图', sub: '传送与探索' },
    { icon: '务', label: '任务', sub: '主线与活动' },
    { icon: '境', label: '秘境', sub: '副本与挑战' },
    { icon: '愿', label: '祈愿', sub: '角色与武器' },
  ]
  const mainActions = show('pause-menu')
    ? [
        { label: '继续冒险', primary: true },
        { label: '保存游戏' },
        { label: '联机共斗' },
        { label: '返回标题' },
      ]
    : []
  if (show('settings-panel')) {
    mainActions.splice(3, 0, { label: '设置' })
  }
  const party = ['旅行者', '安柏', '丽莎', '凯亚']
  const renderedIds: string[] = []
  if (show('pause-menu')) renderedIds.push('pause-menu')
  if (show('settings-panel')) renderedIds.push('settings-panel')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  return `
    <div class="upv-pause upv-pause--arpg">
      <div class="gl-arpg-pause-overlay" aria-hidden="true"></div>
      <div class="gl-arpg-pause-shell">
        <header class="gl-arpg-pause-header">
          <span class="gl-arpg-pause-badge">PAUSED</span>
          <div class="gl-arpg-pause-heading">
            <h1 class="gl-arpg-pause-title">探索暂停</h1>
            <p class="gl-arpg-pause-loc">${esc(genreLabel)} · ${esc(blueprint.stage.label)} · 遗迹平原</p>
          </div>
          ${show('quest-tracker') ? `
            <aside class="gl-arpg-pause-quest">
              <div class="gl-arpg-pause-quest-label">当前追踪</div>
              <p>${esc(blueprint.stage.playerGoal)}</p>
            </aside>
          ` : ''}
        </header>
        <div class="gl-arpg-pause-body">
          <nav class="gl-arpg-pause-quick" aria-label="系统快捷入口">
            ${quickLinks.map((link, i) => `
              <button type="button" class="gl-arpg-pause-quick-btn${i === 0 ? ' active' : ''}">
                <span class="gl-arpg-pause-quick-icon">${esc(link.icon)}</span>
                <span class="gl-arpg-pause-quick-label">${esc(link.label)}</span>
                <span class="gl-arpg-pause-quick-sub">${esc(link.sub)}</span>
              </button>
            `).join('')}
          </nav>
          <section class="gl-arpg-pause-center" aria-label="当前状态">
            <div class="gl-arpg-pause-party">
              ${party.map((name, i) => `
                <div class="gl-arpg-pause-avatar${i === 0 ? ' active' : ''} uid-live-icon-${i % 4}">
                  <span>${name.slice(0, 1)}</span>
                  <em>Lv.${[90, 80, 70, 60][i]}</em>
                </div>
              `).join('')}
            </div>
            <dl class="gl-arpg-pause-meta">
              <div><dt>游玩时间</dt><dd>02:14:36</dd></div>
              <div><dt>冒险等阶</dt><dd>58</dd></div>
              <div><dt>树脂</dt><dd>142 / 160</dd></div>
              <div><dt>探索度</dt><dd>璃月 67%</dd></div>
            </dl>
          </section>
          ${show('pause-menu') ? `
            <nav class="gl-arpg-pause-actions" aria-label="暂停菜单">
              ${mainActions.map(a => `
                <button type="button" class="upv-pause-item gl-arpg-pause-action${a.primary ? ' primary' : ''}">${esc(a.label)}</button>
              `).join('')}
            </nav>
          ` : ''}
        </div>
        <footer class="gl-arpg-pause-foot">
          <span><kbd>Esc</kbd> 继续冒险</span>
          <span>自动存档 · 2 分钟前</span>
        </footer>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── FPS (CoD / Valorant style) ─────────────────────────────────────────────

export function previewFpsLobbyStart(ctx: LayoutPreviewScreenContext): string {
  const { genreLabel, renderModuleFeedback, spec, hasModule } = ctx
  return `
    <div class="upv-start upv-start--fps">
      <nav class="gl-fps-topnav">
        <button type="button" class="active">对战</button>
        <button type="button">武器库</button>
        <button type="button">商店</button>
        <button type="button">通行证</button>
      </nav>
      <div class="gl-fps-modes">
        ${['竞技模式', '休闲模式', '训练场'].map((mode, i) => `
          <button type="button" class="gl-fps-mode${i === 0 ? ' active' : ''}">
            <strong>${mode}</strong>
            <span>${i === 0 ? '5v5 排位' : i === 1 ? '快速匹配' : '练习'}</span>
          </button>
        `).join('')}
      </div>
      <div class="gl-fps-footer">
        <span>${genreLabel}</span>
        <button type="button" class="gl-fps-match-btn">寻找对局</button>
      </div>
      ${renderModuleFeedback(showModule(spec, hasModule, 'main-nav') ? ['main-nav'] : [])}
    </div>
  `
}

/** FPS 武器选择 — Valorant/COD 式：左侧列表 + 右侧预览 + 底栏确认 */
export function previewFpsWeaponSelect(ctx: LayoutPreviewScreenContext): string {
  const { renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const primary = [
    { name: '突击步枪', tag: '全自动 · 中距', mag: 30, active: true },
    { name: '狙击枪', tag: '栓动 · 远距', mag: 5 },
    { name: '霰弹枪', tag: '近距 · 爆发', mag: 8 },
    { name: '冲锋枪', tag: '高机动', mag: 25 },
  ]
  const renderedIds: string[] = []
  if (show('weapon-select')) renderedIds.push('weapon-select')
  if (show('weapon-hud')) renderedIds.push('weapon-hud')
  if (show('ammo-counter')) renderedIds.push('ammo-counter')
  return `
    <div class="upv-weaponwheel upv-weaponwheel--fps">
      <div class="gl-fps-ww-scrim"></div>
      <div class="gl-fps-loadout">
        <header class="gl-fps-loadout-head">
          <h2 class="gl-fps-loadout-title">武器配置</h2>
          <nav class="gl-fps-loadout-tabs" aria-label="武器分类">
            <button type="button" class="active">主武器</button>
            <button type="button">副武器</button>
            <button type="button">战术装备</button>
          </nav>
        </header>
        <div class="gl-fps-loadout-body">
          <div class="gl-fps-loadout-list">
            ${primary.map(w => `
              <button type="button" class="gl-fps-loadout-card${w.active ? ' active' : ''}">
                <span class="gl-fps-loadout-card-icon uid-live-icon-0">🔫</span>
                <span class="gl-fps-loadout-card-text">
                  <strong>${w.name}</strong>
                  <em>${w.tag}</em>
                </span>
                <span class="gl-fps-loadout-card-mag">${w.mag} 发</span>
              </button>
            `).join('')}
          </div>
          <div class="gl-fps-loadout-preview">
            <div class="gl-fps-loadout-preview-hero uid-live-icon-1">⚔</div>
            <div class="gl-fps-loadout-preview-name">突击步枪</div>
            <p class="gl-fps-loadout-preview-desc">中距离全自动，适合突破与控场</p>
            <div class="gl-fps-loadout-stats">
              <div><span>伤害</span><strong>28</strong></div>
              <div><span>射速</span><strong>720</strong></div>
              <div><span>弹匣</span><strong>30</strong></div>
            </div>
          </div>
        </div>
        <footer class="gl-fps-loadout-foot">
          <div class="gl-fps-loadout-current">
            当前配装 <strong>突击步枪</strong>
            ${show('ammo-counter') ? '<span class="gl-fps-loadout-ammo">弹药 <b>30</b> / 90</span>' : ''}
          </div>
          <button type="button" class="gl-fps-loadout-confirm">确认配装</button>
        </footer>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewFpsCombatHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('reticle')) renderedIds.push('reticle')
  if (show('ammo-counter')) renderedIds.push('ammo-counter')
  if (show('weapon-hud')) renderedIds.push('weapon-hud')
  if (show('minimap')) renderedIds.push('minimap')
  if (show('health-status')) renderedIds.push('health-status')
  if (show('scoreboard')) renderedIds.push('scoreboard')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  return `
    <div class="upv-hud upv-hud--fps">
      ${show('minimap') ? `
        <div class="upv-hud-minimap gl-fps-minimap">
          <div class="upv-hud-minimap-dot"></div>
        </div>
      ` : ''}
      ${show('scoreboard') ? `
        <div class="gl-fps-score">
          <span class="gl-fps-score-label">比分</span>
          <span class="gl-fps-score-val"><b>02</b><em>/</em>12</span>
        </div>
      ` : ''}
      ${show('scoreboard') ? `
        <div class="gl-fps-feed">
          <div>Player1 击败 Enemy2</div>
          <div>You 击败 Enemy1</div>
        </div>
      ` : ''}
      ${show('quest-tracker') ? `
        <aside class="gl-fps-quest">
          <div class="upv-hud-label">任务</div>
          <div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div>
        </aside>
      ` : ''}
      ${show('reticle') ? '<div class="upv-hud-reticle gl-fps-reticle">+</div>' : ''}
      ${show('health-status') ? `
        <div class="gl-fps-vitals">
          <div class="gl-fps-vital-row">
            <span class="gl-fps-vital-key">HP</span>
            <div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:72%"></div></div>
            <span class="gl-fps-vital-num">72</span>
          </div>
          <div class="gl-fps-vital-row armor">
            <span class="gl-fps-vital-key">甲</span>
            <div class="upv-hud-bar"><div class="upv-hud-bar-fill sta" style="width:100%"></div></div>
            <span class="gl-fps-vital-num">100</span>
          </div>
        </div>
      ` : ''}
      ${show('interaction-hints') ? `
        <div class="gl-fps-interact">
          <kbd>E</kbd>
          <span>${esc(blueprint.stage.cta)}</span>
        </div>
      ` : ''}
      ${(show('weapon-hud') || show('ammo-counter')) ? `
        <aside class="gl-fps-weapon-dock" aria-label="武器栏">
          <div class="gl-fps-weapon-slot">
            <span class="gl-fps-slot-key">5</span>
            <span class="gl-fps-slot-icon">💨</span>
            <span class="gl-fps-slot-count">×1</span>
          </div>
          <div class="gl-fps-weapon-slot">
            <span class="gl-fps-slot-key">4</span>
            <span class="gl-fps-slot-icon">💣</span>
            <span class="gl-fps-slot-count">×2</span>
          </div>
          <div class="gl-fps-weapon-slot">
            <span class="gl-fps-slot-key">3</span>
            <span class="gl-fps-slot-icon uid-live-icon-2">🔪</span>
          </div>
          <div class="gl-fps-weapon-slot secondary">
            <span class="gl-fps-slot-key">2</span>
            <span class="gl-fps-slot-icon uid-live-icon-1">🔫</span>
            <span class="gl-fps-slot-ammo"><b>20</b><em>/</em>120</span>
          </div>
          <div class="gl-fps-weapon-slot active">
            <span class="gl-fps-slot-key">1</span>
            <div class="gl-fps-weapon-info">
              <strong class="gl-fps-weapon-name">MK-II</strong>
              <span class="gl-fps-weapon-type">突击步枪</span>
            </div>
            ${show('ammo-counter') ? `
              <div class="gl-fps-weapon-ammo">
                <span class="gl-fps-ammo-mag">30</span>
                <span class="gl-fps-ammo-sep">/</span>
                <span class="gl-fps-ammo-res">90</span>
              </div>
            ` : ''}
          </div>
        </aside>
      ` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── Survival (Rust / Valheim style) ────────────────────────────────────────

export function previewSurvivalCampStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('main-nav')) renderedIds.push('main-nav')
  if (show('character-panel')) renderedIds.push('character-panel')
  return `
    <div class="upv-start upv-start--survival">
      <div class="gl-surv-vignette" aria-hidden="true"></div>
      ${show('main-nav') ? `
        <nav class="gl-surv-topnav" aria-label="主菜单">
          <button type="button" class="active">世界</button>
          <button type="button">角色</button>
          <button type="button">档案</button>
          <button type="button">设置</button>
        </nav>
      ` : ''}
      <div class="gl-surv-main">
        <div class="gl-surv-brand-block">
          <h1 class="gl-surv-brand">${esc(genreLabel)}</h1>
          <p class="gl-surv-tagline">${esc(startTagline(ctx))}</p>
          <nav class="gl-surv-rail" aria-label="游戏模式">
            <button type="button" class="upv-start-item primary">加入世界</button>
            <button type="button" class="upv-start-item">创建服务器</button>
            <button type="button" class="upv-start-item">单人游戏</button>
          </nav>
        </div>
        ${show('character-panel') ? `
          <aside class="gl-surv-hero" aria-label="角色与世界">
            <div class="gl-surv-char-portrait uid-live-icon-0">🧍</div>
            <div class="gl-surv-char-name">生存者</div>
            <div class="gl-surv-stats">
              <span><em>等级</em><strong>12</strong></span>
              <span><em>生存</em><strong>第 7 天</strong></span>
            </div>
            <div class="gl-surv-world-card">
              <div class="gl-surv-world-label">最近世界</div>
              <strong class="gl-surv-world-name">北境荒原</strong>
              <span class="gl-surv-world-meta">上次游玩 · 3 小时前</span>
            </div>
          </aside>
        ` : ''}
      </div>
      <div class="gl-surv-foot">版本 1.0 · ${esc(genreLabel)}</div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewSurvivalVitalsHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('minimap')) renderedIds.push('minimap')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('health-status')) renderedIds.push('health-status')
  if (show('item-slot')) renderedIds.push('item-slot')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  if (show('crafting-panel')) renderedIds.push('crafting-panel')
  return `
    <div class="upv-hud upv-hud--survival">
      ${show('minimap') ? `
        <div class="upv-hud-minimap gl-surv-minimap">
          <div class="upv-hud-minimap-dot"></div>
          <span class="gl-map-n">N</span>
        </div>
      ` : ''}
      ${show('resource-tracker') ? `
        <div class="gl-surv-loot">获得 木材 +12 · 铁矿 +3</div>
      ` : ''}
      ${show('quest-tracker') ? `
        <div class="upv-hud-quest gl-surv-quest">
          <div class="upv-hud-label">追踪</div>
          <div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div>
        </div>
      ` : ''}
      ${show('health-status') || show('resource-tracker') ? `
        <div class="gl-surv-vitals-dock">
          ${show('health-status') ? `
            <div class="gl-surv-vital-row">
              <span class="gl-surv-vital-icon">❤</span>
              <div class="gl-surv-vital-body">
                <span class="gl-surv-vital-label">生命</span>
                <div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:62%"></div></div>
              </div>
            </div>
          ` : ''}
          ${show('resource-tracker') ? `
            <div class="gl-surv-vital-row">
              <span class="gl-surv-vital-icon">🍖</span>
              <div class="gl-surv-vital-body">
                <span class="gl-surv-vital-label">饱食</span>
                <div class="upv-hud-bar"><div class="upv-hud-bar-fill food" style="width:45%"></div></div>
              </div>
            </div>
            <div class="gl-surv-vital-row">
              <span class="gl-surv-vital-icon">💧</span>
              <div class="gl-surv-vital-body">
                <span class="gl-surv-vital-label">水分</span>
                <div class="upv-hud-bar"><div class="upv-hud-bar-fill water" style="width:58%"></div></div>
              </div>
            </div>
            <div class="gl-surv-vital-row">
              <span class="gl-surv-vital-icon">🌡</span>
              <div class="gl-surv-vital-body">
                <span class="gl-surv-vital-label">体温</span>
                <div class="upv-hud-bar"><div class="upv-hud-bar-fill temp" style="width:72%"></div></div>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}
      <div class="gl-surv-bottom-dock">
        ${show('interaction-hints') ? `
          <div class="gl-surv-interact"><kbd>E</kbd> ${esc(blueprint.stage.cta)}</div>
        ` : ''}
        ${show('item-slot') ? `
          <div class="gl-surv-hotbar">${survivalHotbar(8)}</div>
        ` : ''}
      </div>
      ${show('crafting-panel') ? `
        <button type="button" class="gl-surv-craft-btn"><span class="gl-surv-craft-icon">🔨</span><em>制作</em></button>
      ` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── MMO (WoW / FFXIV style) ────────────────────────────────────────────────

export function previewMmoLoginStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, renderModuleFeedback, spec, hasModule } = ctx
  return `
    <div class="upv-start upv-start--mmo">
      <div class="gl-mmo-server">服务器 · 艾泽拉斯 <em>在线</em></div>
      <div class="gl-mmo-slots">
        ${['圣骑士 Lv.60', '法师 Lv.58', '+ 创建角色'].map((name, i) => `
          <button type="button" class="gl-mmo-slot${i === 0 ? ' active' : ''}">
            <span class="gl-mmo-class">${i === 0 ? '⚔' : i === 1 ? '✦' : '+'}</span>
            <span>${name}</span>
          </button>
        `).join('')}
      </div>
      <button type="button" class="upv-start-item primary gl-mmo-enter">进入世界</button>
      <div class="gl-mmo-title">${esc(genreLabel)}</div>
      ${renderModuleFeedback(showModule(spec, hasModule, 'character-panel') ? ['character-panel'] : [])}
    </div>
  `
}

export function previewMmoRaidHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('minimap')) renderedIds.push('minimap')
  if (show('health-status')) renderedIds.push('health-status')
  if (show('currency')) renderedIds.push('currency')
  if (show('scoreboard')) renderedIds.push('scoreboard')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  if (show('character-panel')) renderedIds.push('character-panel')
  if (show('chat-panel')) renderedIds.push('chat-panel')
  if (show('skill-bar')) renderedIds.push('skill-bar')
  return `
    <div class="upv-hud upv-hud--mmo">
      <div class="gl-mmo-hud-left">
        ${show('minimap') ? `
          <div class="upv-hud-minimap gl-mmo-minimap">
            <div class="upv-hud-minimap-dot"></div>
            <span class="gl-map-n">N</span>
          </div>
        ` : ''}
        ${show('health-status') ? `
          <div class="gl-mmo-frames">
            <div class="gl-mmo-frame">
              <span class="gl-mmo-frame-label">你</span>
              <div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:76%"></div></div>
            </div>
            <div class="gl-mmo-frame target">
              <span class="gl-mmo-frame-label">Boss</span>
              <div class="upv-hud-bar"><div class="upv-hud-bar-fill sta" style="width:38%"></div></div>
            </div>
          </div>
        ` : ''}
      </div>
      ${show('currency') || show('scoreboard') ? `
        <div class="gl-mmo-topbar">
          ${show('currency') ? '<span class="gl-mmo-gold">💰 12,480</span>' : ''}
          ${show('scoreboard') ? '<span class="gl-mmo-score">排名 <b>02</b> / 12</span>' : ''}
        </div>
      ` : ''}
      <div class="gl-mmo-hud-right">
        ${show('quest-tracker') ? `
          <div class="upv-hud-quest gl-mmo-quest">
            <div class="upv-hud-label">任务追踪</div>
            <div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div>
            <div class="gl-mmo-quest-progress"><i style="width:42%"></i></div>
          </div>
        ` : ''}
        ${show('character-panel') ? `
          <aside class="gl-mmo-char-strip">
            <div class="gl-mmo-char-title">角色属性</div>
            <div class="gl-mmo-char-stat"><span>攻击</span><b>248</b></div>
            <div class="gl-mmo-char-stat"><span>防御</span><b>190</b></div>
            <div class="gl-mmo-char-stat"><span>速度</span><b>122</b></div>
          </aside>
        ` : ''}
      </div>
      ${show('chat-panel') ? `
        <div class="gl-mmo-chat">
          <div class="gl-mmo-chat-head">聊天频道</div>
          <div class="gl-mmo-chat-lines">
            <div><b>[队伍]</b> 准备进入目标区域</div>
            <div><b>[公会]</b> 任务目标已更新</div>
          </div>
          <div class="gl-mmo-chat-input">输入消息…</div>
        </div>
      ` : ''}
      ${show('skill-bar') ? `
        <div class="gl-mmo-bottom-dock">
          <div class="gl-mmo-bar-row-mod">${mmoModBar(['Q', 'W', 'E', 'R'])}</div>
          <div class="gl-mmo-actionbar">${mmoMainBar(12)}</div>
        </div>
      ` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewMmoCharacterSheet(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const roster = [
    { name: '圣骑士', role: '坦克', lv: 60, active: true },
    { name: '法师', role: '输出', lv: 58 },
    { name: '牧师', role: '治疗', lv: 55 },
    { name: '盗贼', role: '输出', lv: 52 },
  ]
  const equipSlots = [
    { label: '主手', name: '霜之哀伤', lv: 'Lv.60', active: true },
    { label: '副手', name: '龙鳞盾', lv: 'Lv.58' },
    { label: '头部', name: '统御头盔', lv: 'Lv.60' },
    { label: '肩部', name: '龙鳞护肩', lv: 'Lv.55' },
    { label: '胸部', name: '审判胸甲', lv: 'Lv.60' },
    { label: '饰品', name: '勇气徽章', lv: 'Lv.50' },
  ]
  const stats = [
    { label: '力量', value: '1,248' },
    { label: '敏捷', value: '486' },
    { label: '智力', value: '312' },
    { label: '耐力', value: '2,840' },
    { label: '暴击', value: '28.6%' },
    { label: '急速', value: '18.2%' },
  ]
  const renderedIds: string[] = []
  if (show('character-panel')) renderedIds.push('character-panel')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('item-detail')) renderedIds.push('item-detail')
  return `
    <div class="upv-char upv-char--mmo">
      <aside class="gl-mmo-char-roster" aria-label="队伍角色">
        ${roster.map((c, i) => `
          <button type="button" class="gl-mmo-char-roster-card${c.active ? ' active' : ''}">
            <span class="gl-mmo-char-roster-art uid-live-icon-${i % 4}">${c.name.slice(0, 1)}</span>
            <span class="gl-mmo-char-roster-name">${esc(c.name)}</span>
            <span class="gl-mmo-char-roster-meta">Lv.${c.lv} · ${esc(c.role)}</span>
          </button>
        `).join('')}
      </aside>
      <main class="gl-mmo-char-stage">
        <header class="gl-mmo-char-header">
          <div class="gl-mmo-char-heading">
            <h1 class="gl-mmo-char-title">角色属性</h1>
            <p class="gl-mmo-char-sub">${esc(blueprint.stage.playerGoal)}</p>
          </div>
          <nav class="gl-mmo-char-tabs" aria-label="属性页签">
            <button type="button" class="gl-mmo-char-tab active">属性</button>
            <button type="button" class="gl-mmo-char-tab">天赋</button>
            <button type="button" class="gl-mmo-char-tab">装备</button>
            <button type="button" class="gl-mmo-char-tab">成就</button>
          </nav>
          ${show('resource-tracker') ? `
            <div class="gl-mmo-char-resources">
              <span>背包容量 <b>50 / 2000</b></span>
              <span>金币 <b>7100908</b></span>
            </div>
          ` : ''}
        </header>
        <div class="gl-mmo-char-body">
          <div class="gl-mmo-char-equip-ring" aria-label="装备栏">
            ${equipSlots.map((slot, i) => `
              <button type="button" class="gl-mmo-char-equip${slot.active ? ' active' : ''}" style="--slot-i:${i}">
                <span class="gl-mmo-char-equip-label">${esc(slot.label)}</span>
                <span class="gl-mmo-char-equip-name">${esc(slot.name)}</span>
                <span class="gl-mmo-char-equip-lv">${esc(slot.lv)}</span>
              </button>
            `).join('')}
          </div>
          <div class="gl-mmo-char-hero uid-live-icon-0">
            <span class="gl-mmo-char-hero-label">角色模型</span>
            <div class="gl-mmo-char-class-badge">圣骑士</div>
          </div>
        </div>
        <footer class="gl-mmo-char-footer">
          <span class="gl-mmo-char-ilvl">装等 <strong>245</strong></span>
          <span class="gl-mmo-char-exp">经验 118,400 / 140,000</span>
        </footer>
      </main>
      <aside class="gl-mmo-char-side">
        ${show('character-panel') ? `
          <div class="gl-mmo-char-panel">
            <div class="gl-mmo-char-hero-meta">
              <h2 class="gl-mmo-char-name">圣骑士</h2>
              <div class="gl-mmo-char-badges">
                <span class="gl-mmo-char-badge">Lv.60</span>
                <span class="gl-mmo-char-badge accent">人类 · 防护</span>
              </div>
              <div class="gl-mmo-char-exp-bar"><i style="width:84%"></i></div>
            </div>
            <div class="gl-mmo-char-stats-head">基础属性</div>
            <dl class="gl-mmo-char-stats">
              ${stats.map(s => `
                <div class="gl-mmo-char-stat-row">
                  <dt>${esc(s.label)}</dt>
                  <dd>${esc(s.value)}</dd>
                </div>
              `).join('')}
            </dl>
          </div>
        ` : ''}
        ${show('item-detail') ? `
          <div class="gl-mmo-char-gear-detail">
            <div class="gl-mmo-char-gear-art uid-live-icon-2"><span>装备</span></div>
            <h3 class="gl-mmo-char-gear-title">霜之哀伤</h3>
            <div class="gl-mmo-char-gear-kind">双手剑 · 史诗</div>
            <div class="gl-mmo-char-gear-stars">★★★★</div>
            <dl class="gl-mmo-char-gear-stats">
              <div><dt>攻击力</dt><dd>+248</dd></div>
              <div><dt>力量</dt><dd>+86</dd></div>
              <div><dt>暴击</dt><dd>+12%</dd></div>
            </dl>
            <button type="button" class="gl-mmo-char-gear-action primary">更换装备</button>
          </div>
        ` : ''}
      </aside>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewMmoSocialDialog(ctx: LayoutPreviewScreenContext): string {
  const { esc, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const options = ['继续', '追问细节', '[关闭]']
  const renderedIds: string[] = []
  if (show('chat-panel')) renderedIds.push('chat-panel')
  if (show('dialog-box')) renderedIds.push('dialog-box')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  if (show('quest-tracker')) renderedIds.push('quest-tracker')
  return `
    <div class="upv-dialog upv-dialog--mmo">
      <div class="upv-dialog-scene">
        <div class="upv-dialog-npc-placeholder">NPC</div>
      </div>
      ${show('quest-tracker') ? `
        <div class="upv-hud-quest gl-mmo-dialog-quest">
          <div class="upv-hud-label">任务追踪</div>
          <div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div>
        </div>
      ` : ''}
      <div class="gl-mmo-dialog-dock">
        ${show('chat-panel') ? `
          <aside class="gl-mmo-dialog-chat">
            <div class="gl-mmo-chat-head">聊天频道</div>
            <div class="gl-mmo-chat-lines">
              <div><b>[队伍]</b> 准备进入目标区域</div>
              <div><b>[系统]</b> 副本已开始</div>
            </div>
            <div class="gl-mmo-chat-input">输入消息…</div>
          </aside>
        ` : ''}
        ${show('dialog-box') ? `
          <div class="gl-mmo-dialog-main">
            <div class="upv-dialog-box">
              <div class="upv-dialog-name">神秘商人</div>
              <div class="upv-dialog-text">「${esc(blueprint.stage.playerGoal)}……你看起来正是我需要的人。」</div>
              ${show('interaction-hints') ? `
                <div class="gl-mmo-dialog-interact"><kbd>E</kbd> ${esc(blueprint.stage.cta)}</div>
              ` : ''}
              <div class="upv-dialog-options">
                ${options.map(o => `<button type="button" class="upv-dialog-opt">${o}</button>`).join('')}
              </div>
            </div>
          </div>
        ` : ''}
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── Life Sim (Stardew / AC style) ──────────────────────────────────────────

export function previewLifesimCozyStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('main-nav')) renderedIds.push('main-nav')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  return `
    <div class="upv-start upv-start--lifesim">
      <div class="gl-life-vignette" aria-hidden="true"></div>
      <div class="gl-life-calendar">春 第 14 天 · 晴</div>
      ${show('resource-tracker') ? '<div class="gl-life-status">心情 良好 · 体力充沛</div>' : ''}
      <div class="gl-life-layout">
        <div class="gl-life-hero">
          <div class="gl-life-hero-frame uid-live-icon-0">
            <span class="gl-life-hero-label">场景预览</span>
          </div>
        </div>
        <div class="gl-life-panel">
          <h1 class="gl-life-title">${esc(genreLabel)}</h1>
          <p class="gl-life-sub">${esc(startTagline(ctx))}</p>
          <div class="gl-life-saves">
            <button type="button" class="gl-life-save active">
              <span class="gl-life-save-name">存档 1</span>
              <em>春 14 日 · 2,400g · 上次 2 小时前</em>
            </button>
            <button type="button" class="gl-life-save">
              <span class="gl-life-save-name">存档 2</span>
              <em>空</em>
            </button>
            <button type="button" class="gl-life-save gl-life-save--new">
              <span class="gl-life-save-name">新建存档</span>
              <em>开始新的生活</em>
            </button>
          </div>
          <button type="button" class="upv-start-item primary gl-life-continue">继续游戏</button>
          ${show('main-nav') ? `
            <nav class="gl-life-nav" aria-label="主菜单">
              <button type="button">新游戏</button>
              <button type="button">设置</button>
            </nav>
          ` : ''}
        </div>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewLifesimDayHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('currency')) renderedIds.push('currency')
  if (show('minimap')) renderedIds.push('minimap')
  if (show('item-slot')) renderedIds.push('item-slot')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  return `
    <div class="upv-hud upv-hud--lifesim">
      ${show('resource-tracker') ? '<div class="gl-life-clock">09:30 · 晴 · 春</div>' : ''}
      ${show('currency') ? '<div class="gl-life-gold">🌿 2,400</div>' : ''}
      ${show('minimap') ? '<div class="upv-hud-minimap gl-life-map"></div>' : ''}
      ${show('item-slot') ? `<div class="gl-life-tools">${['锄', '壶', '斧', '钓', '收'].map(t => `<div class="gl-life-tool">${t}</div>`).join('')}</div>` : ''}
      ${show('interaction-hints') ? `<div class="gl-life-hint">${esc(blueprint.stage.cta)}</div>` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── Racing (Forza / GT style) ──────────────────────────────────────────────

export function previewRacingGarageStart(ctx: LayoutPreviewScreenContext): string {
  const { esc, genreLabel, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('main-nav')) renderedIds.push('main-nav')
  if (show('character-panel')) renderedIds.push('character-panel')
  return `
    <div class="upv-start upv-start--racing">
      <div class="gl-race-vignette" aria-hidden="true"></div>
      <header class="gl-race-header">
        <span class="gl-race-brand">${esc(genreLabel)}</span>
        <span class="gl-race-car-name">RX-7 Spirit R · 街车组</span>
      </header>
      <div class="gl-race-hero" aria-label="展车与数据">
        <div class="gl-race-showcase">
          <div class="gl-race-car-frame uid-live-icon-0">
            <span class="gl-race-car-label">车辆展示</span>
          </div>
        </div>
        <aside class="gl-race-stats-panel">
          <div class="gl-race-stats-title">车辆数据</div>
          <div class="gl-race-stat"><span>马力</span><strong>520</strong></div>
          <div class="gl-race-stat"><span>重量</span><strong>1280 kg</strong></div>
          <div class="gl-race-stat"><span>抓地</span><strong>A</strong></div>
          <div class="gl-race-stat"><span>加速</span><strong>3.2s</strong></div>
        </aside>
      </div>
      <nav class="gl-race-nav" aria-label="车库菜单">
        <button type="button" class="upv-start-item primary">开始比赛</button>
        <button type="button" class="upv-start-item">选择赛车</button>
        <button type="button" class="upv-start-item">改装</button>
        <button type="button" class="upv-start-item">多人</button>
      </nav>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewRacingTrackSelect(ctx: LayoutPreviewScreenContext): string {
  const { esc, blueprint, renderModuleFeedback, spec, hasModule } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const tracks = [
    { name: '铃鹿赛道', tag: 'GP · 日本', km: '5.8 km', turns: '18 弯', record: '2:08.42', stars: '★★★' },
    { name: '东京高速', tag: '街道 · 夜赛', km: '4.2 km', turns: '12 弯', record: '1:42.10', stars: '★★☆' },
    { name: '纽博格林', tag: '北环 · 经典', km: '20.8 km', turns: '154 弯', record: '7:12.88', stars: '★☆☆' },
    { name: 'Laguna Seca', tag: '海岸 · 美国', km: '3.6 km', turns: '11 弯', record: '1:28.55', stars: '★★★' },
  ]
  const renderedIds: string[] = ['level-select']
  if (show('main-nav')) renderedIds.push('main-nav')
  if (show('reward-summary')) renderedIds.push('reward-summary')
  if (show('level-counter')) renderedIds.push('level-counter')
  const active = tracks[0]
  return `
    <div class="upv-levelsel upv-levelsel--racing">
      <div class="gl-race-track-vignette" aria-hidden="true"></div>
      <header class="gl-race-track-top">
        <button type="button" class="gl-race-track-back" aria-label="返回">← 返回</button>
        <div class="gl-race-track-top-title">
          <span class="gl-race-track-kicker">竞速驾驶</span>
          <strong>赛道选择</strong>
        </div>
        ${show('main-nav') ? `
          <nav class="gl-race-track-topnav" aria-label="主导航">
            <button type="button" class="active">赛事</button>
            <button type="button">车库</button>
            <button type="button">排行榜</button>
            <button type="button">设置</button>
          </nav>
        ` : '<div class="gl-race-track-top-spacer"></div>'}
        ${show('level-counter') ? '<div class="gl-race-track-season">第 3 赛季 · 12/24</div>' : '<div class="gl-race-track-top-spacer"></div>'}
      </header>
      <div class="gl-race-track-layout">
        <aside class="gl-race-track-rail" aria-label="赛道列表">
          ${tracks.map((t, i) => `
            <button type="button" class="gl-race-track-card${i === 0 ? ' active' : ''}">
              <span class="gl-race-track-card-name">${esc(t.name)}</span>
              <span class="gl-race-track-card-tag">${esc(t.tag)}</span>
              <span class="gl-race-track-card-meta">${esc(t.km)} · ${esc(t.turns)}</span>
              <span class="gl-race-track-card-stars">${t.stars}</span>
            </button>
          `).join('')}
        </aside>
        <main class="gl-race-track-stage">
          <div class="gl-race-track-map-panel">
            <svg viewBox="0 0 320 200" class="gl-race-circuit" aria-hidden="true">
              <path d="M48 100 C48 36 272 36 272 100 C272 164 48 164 48 100 Z" fill="none" stroke="currentColor" stroke-width="4"/>
              <path d="M120 100 C120 72 200 72 200 100" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".45"/>
            </svg>
          </div>
          <div class="gl-race-track-stage-caption">
            <h1 class="gl-race-track-name">${esc(active.name)} · GP</h1>
            <p class="gl-race-track-meta">${esc(active.km)} · ${esc(active.turns)} · 干地 · 白天</p>
          </div>
        </main>
        <aside class="gl-race-track-detail">
          <div class="gl-race-track-detail-head">赛道详情</div>
          <dl class="gl-race-track-stats">
            <div><dt>单圈纪录</dt><dd>${esc(active.record)}</dd></div>
            <div><dt>推荐等级</dt><dd>28+</dd></div>
            <div><dt>难度</dt><dd>A</dd></div>
            <div><dt>奖励倍率</dt><dd>×1.4</dd></div>
          </dl>
          ${show('reward-summary') ? `
            <div class="gl-race-track-reward">
              <div class="gl-race-track-reward-title">通关奖励</div>
              <div class="gl-race-track-reward-row"><span>金币</span><strong>+2400</strong></div>
              <div class="gl-race-track-reward-row"><span>经验</span><strong>+1200</strong></div>
            </div>
          ` : ''}
          <button type="button" class="gl-race-track-start primary">${esc(blueprint.stage.cta || '开始比赛')}</button>
          <p class="gl-race-track-foot">${esc(blueprint.stage.playerGoal)}</p>
        </aside>
      </div>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewRacingDashHud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('scoreboard')) renderedIds.push('scoreboard')
  if (show('level-counter')) renderedIds.push('level-counter')
  if (show('minimap')) renderedIds.push('minimap')
  if (show('resource-tracker')) renderedIds.push('resource-tracker')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  return `
    <div class="upv-hud upv-hud--racing">
      <div class="gl-race-dash-vignette" aria-hidden="true"></div>
      <div class="gl-race-dash-left">
        ${show('minimap') ? `
          <div class="gl-race-dash-radar">
            <div class="gl-race-dash-radar-grid"></div>
            <span class="gl-race-dash-radar-player"></span>
            <span class="gl-race-dash-radar-rival"></span>
            <span class="gl-race-dash-radar-n">N</span>
          </div>
        ` : ''}
        ${show('scoreboard') ? `
          <div class="gl-race-dash-pos">
            <span class="gl-race-dash-pos-label">名次</span>
            <strong class="gl-race-dash-pos-num">3</strong>
            <em class="gl-race-dash-pos-total">/ 12</em>
          </div>
        ` : ''}
      </div>
      ${show('level-counter') ? `
        <header class="gl-race-dash-top">
          <div class="gl-race-dash-lap">
            <span class="gl-race-dash-lap-kicker">LAP</span>
            <strong>2</strong><span>/ 3</span>
          </div>
          <div class="gl-race-dash-timer">
            <span class="gl-race-dash-timer-label">单圈</span>
            <strong>1:42.08</strong>
            <span class="gl-race-dash-timer-delta">+0.24</span>
          </div>
        </header>
      ` : ''}
      ${show('resource-tracker') ? `
        <div class="gl-race-dash-cluster">
          <div class="gl-race-dash-speed">
            <span class="gl-race-dash-speed-val">218</span>
            <em class="gl-race-dash-speed-unit">km/h</em>
          </div>
          <div class="gl-race-dash-gear">4</div>
          <div class="gl-race-dash-meters">
            <div class="gl-race-dash-meter">
              <span>燃油</span>
              <div class="gl-race-dash-meter-bar"><i style="width:68%"></i></div>
            </div>
            <div class="gl-race-dash-meter nitro">
              <span>氮气</span>
              <div class="gl-race-dash-meter-bar"><i style="width:42%"></i></div>
            </div>
          </div>
        </div>
      ` : ''}
      ${show('interaction-hints') ? `
        <div class="gl-race-dash-hint">
          <kbd>R</kbd><span>手刹漂移</span>
          <kbd>E</kbd><span>${esc(blueprint.stage.cta)}</span>
        </div>
      ` : ''}
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

// ─── Puzzle (existing) ──────────────────────────────────────────────────────

export function previewCasualHomeHub(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, genreLabel, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = ['currency', 'resource-tracker', 'main-nav', 'shop-panel'].filter(id => show(id))
  return `
    <div class="upv-start upv-start--puzzle">
      <div class="gl-puzzle-vignette" aria-hidden="true"></div>
      <header class="gl-puzzle-topbar">
        <div class="gl-puzzle-topbar-left">
          <div class="gl-puzzle-chip gl-puzzle-chip--lives">
            <span class="gl-puzzle-chip-label">生命</span>
            <strong>5/5</strong>
          </div>
          ${show('currency') ? `
            <div class="gl-puzzle-chip gl-puzzle-chip--gold">
              <span class="gl-puzzle-chip-label">金币</span>
              <strong>12,480</strong>
            </div>
          ` : ''}
          ${show('resource-tracker') ? `
            <div class="gl-puzzle-chip gl-puzzle-chip--gems">
              <span class="gl-puzzle-chip-label">宝石</span>
              <strong>38</strong>
            </div>
          ` : ''}
        </div>
        <div class="gl-puzzle-topbar-right">
          <button type="button" class="gl-puzzle-side-btn">限时活动</button>
          <button type="button" class="gl-puzzle-side-btn">每日签到</button>
        </div>
      </header>
      <div class="gl-puzzle-home-body">
        <div class="gl-puzzle-hero-card">
          <div class="gl-puzzle-hero-art uid-live-icon-0" aria-hidden="true">
            <span>关卡插画</span>
          </div>
          <div class="gl-puzzle-hero-inner">
            <span class="gl-puzzle-level-pill">第 12 关 · 糖果海岸</span>
            <h1 class="gl-puzzle-title">${esc(genreLabel)}</h1>
            <p class="gl-puzzle-tagline">${esc(startTagline(ctx))}</p>
            <div class="gl-puzzle-cta-row">
              <button type="button" class="gl-puzzle-cta primary upv-start-item">开始游戏</button>
              <button type="button" class="gl-puzzle-cta secondary upv-start-item">关卡选择</button>
            </div>
            <p class="gl-puzzle-goal">${esc(blueprint.stage.playerGoal)}</p>
          </div>
        </div>
      </div>
      <nav class="gl-puzzle-dock" aria-label="主导航">
        ${show('shop-panel') ? '<button type="button" class="gl-puzzle-dock-btn">商店</button>' : ''}
        <button type="button" class="gl-puzzle-dock-btn">排行榜</button>
        <button type="button" class="gl-puzzle-dock-btn active">首页</button>
        ${show('main-nav') ? '<button type="button" class="gl-puzzle-dock-btn">任务</button>' : ''}
        <button type="button" class="gl-puzzle-dock-btn">设置</button>
      </nav>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function previewCasualStageMap(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const stageNodes = [
    { num: 9, stars: '★★★', state: 'done' },
    { num: 10, stars: '★★☆', state: 'done' },
    { num: 11, stars: '★★★', state: 'done' },
    { num: 12, stars: '▶', state: 'current' },
    { num: 13, stars: '🔒', state: 'locked' },
  ]
  return `
    <div class="upv-levelsel upv-levelsel--puzzle">
      <header class="upv-puzzle-stage-head">
        <div class="upv-puzzle-chapter-pill">章节 2 · 糖果海岸</div>
        <div class="upv-puzzle-stage-progress">已通关 11 / 20</div>
      </header>
      <div class="upv-puzzle-stage-path">
        ${stageNodes.map((node, i) => `
          <div class="upv-puzzle-stage-node ${node.state} ${i % 2 === 0 ? 'left' : 'right'}">
            <div class="upv-puzzle-stage-num">${node.num}</div>
            <div class="upv-puzzle-stage-stars">${node.stars}</div>
          </div>
        `).join('')}
        ${show('reward-summary') ? '<div class="upv-puzzle-stage-chest"><span>🎁</span><em>章节宝箱</em></div>' : ''}
      </div>
      <footer class="upv-puzzle-stage-foot">${esc(blueprint.stage.cta)} · 下一目标 ${esc(blueprint.stage.playerGoal)}</footer>
      ${renderModuleFeedback([
        ...(show('level-select') ? ['level-select'] : []),
        ...(show('reward-summary') ? ['reward-summary'] : []),
      ])}
    </div>
  `
}

export function previewMatch3Hud(ctx: LayoutPreviewScreenContext): string {
  const { spec, hasModule, esc, blueprint, renderModuleFeedback } = ctx
  const show = (id: string) => showModule(spec, hasModule, id)
  const renderedIds: string[] = []
  if (show('game-board')) renderedIds.push('game-board')
  if (show('score-display')) renderedIds.push('score-display')
  if (show('level-counter')) renderedIds.push('level-counter')
  if (show('step-counter')) renderedIds.push('step-counter')
  if (show('item-slot')) renderedIds.push('item-slot')
  if (show('interaction-hints')) renderedIds.push('interaction-hints')
  if (show('endless-mode')) renderedIds.push('endless-mode')
  const boosters = [
    { id: 'bomb', label: '炸弹', count: 3 },
    { id: 'hammer', label: '锤子', count: 2 },
    { id: 'rainbow', label: '彩虹', count: 1 },
  ]
  return `
    <div class="upv-hud upv-hud--puzzle">
      <div class="gl-puzzle-hud-vignette" aria-hidden="true"></div>
      <header class="gl-puzzle-hud-topbar">
        ${show('level-counter') ? `
          <div class="gl-puzzle-hud-pill gl-puzzle-hud-pill--level">
            <span>关卡</span><strong>12</strong>
          </div>
        ` : ''}
        ${show('score-display') ? `
          <div class="gl-puzzle-hud-score">
            <span class="gl-puzzle-hud-score-label">目标得分</span>
            <strong>12,000</strong>
            <em>当前 12,480</em>
          </div>
        ` : ''}
        ${show('step-counter') ? `
          <div class="gl-puzzle-hud-pill gl-puzzle-hud-pill--moves">
            <span>剩余步数</span><strong>18</strong>
          </div>
        ` : ''}
        ${show('endless-mode') ? '<div class="gl-puzzle-hud-pill gl-puzzle-hud-pill--endless"><span>无尽</span><strong>ON</strong></div>' : ''}
      </header>
      <div class="gl-puzzle-hud-stage">
        <aside class="gl-puzzle-hud-goals">
          <div class="gl-puzzle-hud-goals-title">过关目标</div>
          <ul class="gl-puzzle-hud-goals-list">
            <li class="done">得分 ≥ 12,000</li>
            <li>收集 ◆ × 24</li>
            <li class="done">剩余步数 ≥ 1</li>
          </ul>
          <div class="gl-puzzle-hud-stars">★★☆</div>
        </aside>
        ${show('game-board') ? `
          <div class="gl-puzzle-hud-board-wrap">
            <div class="upv-puzzle-board gl-puzzle-board" style="--puzzle-cols:8;--puzzle-rows:8">${renderPuzzleBoardCells(8, 8)}</div>
          </div>
        ` : ''}
      </div>
      <footer class="gl-puzzle-hud-footer">
        ${show('item-slot') ? `
          <div class="gl-puzzle-boosters">
            ${boosters.map((b, i) => `
              <button type="button" class="gl-puzzle-booster uid-live-icon-${i}">
                <span class="gl-puzzle-booster-label">${b.label}</span>
                <span class="gl-puzzle-booster-count">${b.count}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        ${show('interaction-hints') ? `
          <div class="gl-puzzle-hud-hint">
            <span>滑动相邻方块交换</span>
            <kbd>E</kbd><span>${esc(blueprint.stage.cta)}</span>
          </div>
        ` : ''}
      </footer>
      ${renderModuleFeedback(renderedIds)}
    </div>
  `
}

export function renderGenrePreviewByTemplate(ctx: LayoutPreviewScreenContext): string | null {
  switch (ctx.spec.template) {
    case 'open-world-cinematic-start': return previewOpenWorldCinematicStart(ctx)
    case 'open-world-explore-hud': return previewOpenWorldExploreHud(ctx)
    case 'open-world-inventory': return previewOpenWorldInventory(ctx)
    case 'open-world-npc-dialog': return previewOpenWorldNpcDialog(ctx)
    case 'open-world-character-sheet': return previewOpenWorldCharacterSheet(ctx)
    case 'arpg-hero-start': return previewArpgHeroStart(ctx)
    case 'arpg-combat-hud': return previewArpgCombatHud(ctx)
    case 'arpg-inventory': return previewArpgInventory(ctx)
    case 'arpg-character-sheet': return previewArpgCharacterSheet(ctx)
    case 'arpg-story-dialog': return previewArpgStoryDialog(ctx)
    case 'arpg-battle-results': return previewArpgBattleResults(ctx)
    case 'arpg-system-pause': return previewArpgSystemPause(ctx)
    case 'fps-lobby-start': return previewFpsLobbyStart(ctx)
    case 'fps-weapon-select': return previewFpsWeaponSelect(ctx)
    case 'fps-combat-hud': return previewFpsCombatHud(ctx)
    case 'survival-camp-start': return previewSurvivalCampStart(ctx)
    case 'survival-vitals-hud': return previewSurvivalVitalsHud(ctx)
    case 'mmo-login-start': return previewMmoLoginStart(ctx)
    case 'mmo-raid-hud': return previewMmoRaidHud(ctx)
    case 'mmo-character-sheet': return previewMmoCharacterSheet(ctx)
    case 'mmo-social-dialog': return previewMmoSocialDialog(ctx)
    case 'lifesim-cozy-start': return previewLifesimCozyStart(ctx)
    case 'lifesim-day-hud': return previewLifesimDayHud(ctx)
    case 'racing-garage-start': return previewRacingGarageStart(ctx)
    case 'racing-track-select': return previewRacingTrackSelect(ctx)
    case 'racing-dash-hud': return previewRacingDashHud(ctx)
    case 'casual-home-hub': return previewCasualHomeHub(ctx)
    case 'casual-stage-map': return previewCasualStageMap(ctx)
    case 'match3-centered': return previewMatch3Hud(ctx)
    default: return null
  }
}

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/** Wrap layout markup in the same shell used by prototype iframe */
export function wrapGenreLayoutShell(html: string, shellDataAttrs = ''): string {
  return `<div class="gl-proto-genre-shell"${shellDataAttrs}>${html}</div>`
}

/**
 * Shared scene body: background img + genre shell + optional hints.
 * Used by workbench layout preview and prototype `.screen-body` for pixel parity.
 */
export function renderLayoutSceneBody(options: {
  bgSrc?: string
  markup: string
  shellDataAttrs?: string
  bgHintHtml?: string
}): string {
  const bg = options.bgSrc
    ? `<img class="screen-bg-img" src="${escAttr(options.bgSrc)}" alt="" aria-hidden="true">`
    : ''
  const shell = wrapGenreLayoutShell(options.markup, options.shellDataAttrs ?? '')
  return `${bg}${shell}${options.bgHintHtml ?? ''}`
}

/** Prototype reuses preview markup — genre CSS is injected into prototype iframe */
export function renderGenrePrototypeByTemplate(ctx: LayoutPrototypeScreenContext): string | null {
  const previewCtx: LayoutPreviewScreenContext = {
    spec: ctx.spec,
    hasModule: ctx.hasModule,
    esc: (v) => v,
    genreLabel: ctx.genreLabel,
    playerFantasy: ctx.playerFantasy,
    blueprint: {
      stage: {
        label: ctx.screenLabel,
        playerGoal: ctx.blueprint.stage.playerGoal,
        cta: ctx.blueprint.stage.cta,
      },
    },
    renderModuleFeedback: () => '',
  }
  const html = renderGenrePreviewByTemplate(previewCtx)
  if (!html) return null
  const nextAttr = ctx.nextScreen ? ` data-next-screen="${ctx.nextScreen.kind}"` : ''
  return wrapGenreLayoutShell(html, nextAttr)
}

/** Client-side wiring for genre layout buttons in prototype iframe */
export const GENRE_PROTO_WIRE_SCRIPT = `
function wireGenrePrototype() {
  const primaryNavSelectors = [
    '.upv-start-item.primary',
    '.upv-puzzle-play',
    '.gl-puzzle-cta.primary',
    '.gl-arpg-enter',
    '.gl-mmo-enter',
    '.gl-fps-match-btn',
    '.gl-fps-loadout-confirm',
    '.gl-life-continue',
    '.upv-results-btn.primary',
    '.upv-results--arpg .upv-results-btn.primary',
    '.upv-pause-item.primary',
    '.upv-dialog--arpg .upv-dialog-opt.primary',
    '.upv-bag-action:not(.craft)',
    '.gl-arpg-bag-action.primary',
    '.upv-shop-buy',
  ].join(', ')
  document.querySelectorAll('.gl-proto-genre-shell[data-next-screen]').forEach(shell => {
    const next = shell.dataset.nextScreen
    if (!next) return
    shell.querySelectorAll(primaryNavSelectors).forEach(btn => {
      btn.addEventListener('click', () => go(next))
    })
    shell.querySelectorAll('.gl-arpg-hero').forEach(el => {
      el.style.cursor = 'pointer'
      el.addEventListener('click', () => go(next))
    })
  })
  document.querySelectorAll('.gl-proto-genre-shell').forEach(shell => {
    shell.querySelectorAll('.gl-arpg-tabs, .gl-fps-topnav, .gl-surv-topnav').forEach(nav => {
      nav.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          nav.querySelectorAll('button').forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
        })
      })
    })
    shell.querySelectorAll('.gl-fps-modes .gl-fps-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        shell.querySelectorAll('.gl-fps-mode').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
    shell.querySelectorAll('.gl-fps-loadout-tabs, .gl-fps-loadout-list').forEach(nav => {
      nav.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          nav.querySelectorAll('button').forEach(b => b.classList.remove('active'))
          btn.classList.add('active')
        })
      })
    })
    shell.querySelectorAll('.gl-life-saves, .gl-life-nav').forEach(nav => {
      nav.querySelectorAll('.gl-life-save, button').forEach(btn => {
        btn.addEventListener('click', () => {
          if (nav.classList.contains('gl-life-saves')) {
            nav.querySelectorAll('.gl-life-save').forEach(b => b.classList.remove('active'))
            btn.classList.add('active')
          } else {
            nav.querySelectorAll('button').forEach(b => b.classList.remove('active'))
            btn.classList.add('active')
          }
        })
      })
    })
    shell.querySelectorAll('button.upv-start-item:not(.primary)').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.add('proto-tap')
        setTimeout(() => btn.classList.remove('proto-tap'), 180)
      })
    })
  })
}
wireGenrePrototype()
`

/** Scene layer CSS shared by workbench preview and prototype iframe */
export const LAYOUT_SCENE_BODY_CSS = `
.uid-preview-scene,
.screen-body {
  flex: 1;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  min-height: 0;
}
.uid-preview-scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.uid-preview-scene::before,
.screen-body::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 20%, color-mix(in srgb, var(--uid-accent, var(--accent, #ffb24a)) 22%, transparent), transparent 26%),
    radial-gradient(circle at 82% 72%, color-mix(in srgb, var(--uid-accent, var(--accent, #ffb24a)) 16%, transparent), transparent 30%),
    linear-gradient(135deg, color-mix(in srgb, var(--bg, #090b0e) 76%, #fff 24%), var(--bg, #090b0e) 48%, color-mix(in srgb, var(--bg, #090b0e) 84%, #000 16%));
}
.uid-preview-scene::after,
.screen-body::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 42px 42px;
  opacity: .35;
}
.uid-preview-scene .screen-bg-img,
.screen-body .screen-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
  opacity: .82;
  filter: saturate(.92) contrast(.92);
  pointer-events: none;
}
.uid-preview-scene .uid-preview-bg-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 12;
  pointer-events: none;
}
.uid-preview-scene:has(.upv-start--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-bag--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-dialog--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-pause--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-results--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--open-world) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-bag--open-world) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-char--open-world) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-char--arpg) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-dialog--open-world) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--fps) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-weaponwheel--fps) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--survival) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--lifesim) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--racing) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-levelsel--racing) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-hud--racing) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-start--puzzle) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-hud--puzzle) .uid-preview-bg-hint,
.uid-preview-scene:has(.upv-dialog--mmo) .uid-preview-bg-hint {
  bottom: auto;
  top: 14px;
}
`

export const SHARED_LAYOUT_SHELL_CSS = `
.uid-preview-stage > .gl-proto-genre-shell,
.uid-preview-stage > .uid-preview-scene > .gl-proto-genre-shell,
.uid-preview-scene > .gl-proto-genre-shell,
.screen-body > .gl-proto-genre-shell {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2;
  box-sizing: border-box;
}
.gl-proto-genre-shell .upv-start,
.gl-proto-genre-shell .upv-hud,
.gl-proto-genre-shell .upv-levelsel,
.gl-proto-genre-shell .upv-bag:not(.upv-bag--open-world):not(.upv-bag--arpg),
.gl-proto-genre-shell .upv-dialog,
.gl-proto-genre-shell .upv-shop,
.gl-proto-genre-shell .upv-map,
.gl-proto-genre-shell .upv-pause,
.gl-proto-genre-shell .upv-results,
.gl-proto-genre-shell .upv-weaponwheel {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}
.gl-proto-genre-shell .upv-bag.upv-bag--open-world,
.gl-proto-genre-shell .upv-bag.upv-bag--arpg {
  display: grid;
  flex-direction: unset;
  padding: 0;
  gap: 0;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.gl-proto-genre-shell .upv-char.upv-char--open-world,
.gl-proto-genre-shell .upv-char.upv-char--arpg {
  display: grid;
  flex-direction: unset;
  padding: 0;
  gap: 0;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.gl-proto-genre-shell .upv-pause.upv-pause--arpg {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.gl-proto-genre-shell .upv-results.upv-results--arpg {
  display: grid;
  flex-direction: unset;
  align-items: unset;
  justify-content: unset;
  padding: clamp(16px, 3vh, 28px) clamp(20px, 4vw, 40px);
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.gl-proto-genre-shell .upv-dialog.upv-dialog--open-world,
.gl-proto-genre-shell .upv-dialog.upv-dialog--arpg {
  display: flex;
  flex-direction: column;
  padding: 0;
  gap: 0;
}
`

/** High-specificity genre start anchors — must match prototype iframe */
export const GENRE_START_LAYOUT_PARITY_CSS = `
.gl-proto-genre-shell .upv-start.upv-start--open-world {
  align-items: flex-start;
  justify-content: flex-end;
  padding: 32px 36px 44px 40px;
  text-align: left;
  gap: 0;
}
.gl-proto-genre-shell .upv-start.upv-start--arpg {
  display: block;
  padding: 0;
}
.gl-proto-genre-shell .upv-start.upv-start--fps {
  align-items: stretch;
  justify-content: flex-start;
  padding: 16px 22px 20px;
  gap: 16px;
}
.gl-proto-genre-shell .upv-start.upv-start--survival {
  display: block;
  padding: 0;
}
.gl-proto-genre-shell .upv-start.upv-start--mmo {
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 28px 24px;
}
.gl-proto-genre-shell .upv-start.upv-start--lifesim {
  display: block;
  padding: 0;
}
.gl-proto-genre-shell .upv-start.upv-start--racing {
  display: block;
  padding: 0;
}
.gl-proto-genre-shell .upv-start.upv-start--puzzle {
  display: grid;
  align-items: stretch;
  justify-content: stretch;
  padding: 0;
  gap: 0;
}
`

/** Override generic .upv-bag 3-column template after previewScreenStyles */
export const ARPG_BAG_LAYOUT_PARITY_CSS = `
.upv-bag.upv-bag--arpg {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 32vw) !important;
  grid-template-rows: minmax(0, 1fr) !important;
  gap: 0 !important;
  padding: 0 !important;
  height: 100% !important;
  min-height: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box;
}
.upv-bag--arpg > .gl-arpg-bag-main {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  z-index: 1;
}
.upv-bag--arpg > .gl-arpg-bag-detail {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  z-index: 1;
}
.upv-bag--arpg > .upv-supplemental-layer {
  display: none !important;
}
`

/** 可交互原型 iframe 内的统一 UI 规范：布局填满、卡片/按钮职责分离、主 CTA 最小触控尺寸 */
export const PROTO_UI_SPEC_CSS = `
.gl-proto-genre-shell .screen-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.gl-proto-genre-shell .gl-layout-scene,
.gl-proto-genre-shell .upv-start,
.gl-proto-genre-shell .upv-hud,
.gl-proto-genre-shell .upv-bag,
.gl-proto-genre-shell .upv-weaponwheel,
.gl-proto-genre-shell .upv-dialog,
.gl-proto-genre-shell .upv-pause,
.gl-proto-genre-shell .upv-results,
.gl-proto-genre-shell .upv-map,
.gl-proto-genre-shell .upv-shop,
.gl-proto-genre-shell .upv-levelsel {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}
/* 选择卡/模式卡只用面板样式，禁止套按钮贴图 */
.gl-proto-genre-shell .gl-fps-mode,
.gl-proto-genre-shell .gl-mmo-slot,
.gl-proto-genre-shell .gl-race-track-card,
.gl-proto-genre-shell .gl-fps-loadout-card {
  background-image: none !important;
}
.gl-proto-genre-shell .gl-fps-mode.active,
.gl-proto-genre-shell .gl-mmo-slot.active,
.gl-proto-genre-shell .gl-race-track-card.active,
.gl-proto-genre-shell .gl-fps-loadout-card.active {
  background-image: none !important;
}
/* 主 CTA 统一最小尺寸 */
.gl-proto-genre-shell .gl-fps-match-btn,
.gl-proto-genre-shell .gl-fps-loadout-confirm,
.gl-proto-genre-shell .gl-arpg-enter,
.gl-proto-genre-shell .gl-mmo-enter,
.gl-proto-genre-shell .gl-race-track-start,
.gl-proto-genre-shell .gl-puzzle-cta.primary,
.gl-proto-genre-shell .cta-btn.primary {
  min-width: 200px !important;
  min-height: 52px !important;
  font-size: 16px !important;
  font-weight: 800 !important;
}
/* 无 layout spec 的 fallback 屏（地图/对话/暂停/结算）字号兜底 */
.gl-proto-genre-shell .upv-dialog-opt,
.gl-proto-genre-shell .upv-pause-item,
.gl-proto-genre-shell .upv-results-btn,
.gl-proto-genre-shell .panel-nav-item,
.gl-proto-genre-shell .nav-btn {
  font-size: 14px !important;
  min-height: 44px !important;
}
`

/** Workbench layout preview + prototype iframe — keep in sync */
export const WORKBENCH_LAYOUT_SCENE_CSS = `
${genreLayoutStyles}
${previewScreenStyles}
${ARPG_BAG_LAYOUT_PARITY_CSS}
${LAYOUT_SCENE_BODY_CSS}
${SHARED_LAYOUT_SHELL_CSS}
${GENRE_START_LAYOUT_PARITY_CSS}
`

export const GENRE_LAYOUT_PROTO_CSS = `
${WORKBENCH_LAYOUT_SCENE_CSS}
${PROTO_UI_SPEC_CSS}
.gl-proto-genre-shell button {
  cursor: pointer;
  transition: opacity .15s, transform .15s;
}
.gl-proto-genre-shell button:hover { opacity: .88; }
.gl-proto-genre-shell button:active { transform: scale(.98); }
.gl-proto-genre-shell button.proto-tap { opacity: .72; }
.gl-arpg-hero { cursor: pointer; }
`
