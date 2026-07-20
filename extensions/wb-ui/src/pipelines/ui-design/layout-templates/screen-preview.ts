import {
  FEATURE_MODULES,
  getScreenModules,
  type ScreenKind,
  type UIDesignState,
} from '../model'
import type { buildBlueprint } from '../model'
import { getLayoutSpec } from '../layout-engine'
import { renderGenrePreviewByTemplate } from './genre-screens'

const defaultEsc = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/"/g, '&quot;')

export function renderScreenPreviewMarkup(
  state: UIDesignState,
  blueprint: ReturnType<typeof buildBlueprint>,
  screenKind: ScreenKind,
  options: { includeSupplemental?: boolean; esc?: (value: string) => string } = {},
): string {
    const esc = options.esc ?? defaultEsc
    const screen = screenKind
    const genre = state.genrePreset
    const moduleRule = getScreenModules(genre, screen)
    const requiredIds = new Set(moduleRule.required.map(m => m.id))
    const allowedIds = new Set([
      ...moduleRule.required.map(m => m.id),
      ...moduleRule.recommended.map(m => m.id),
      ...moduleRule.optional.map(m => m.id),
    ])
    const enabled = new Set<string>(requiredIds)
    state.selectedFeatures.forEach((id) => {
      if (allowedIds.has(id)) enabled.add(id)
    })
    const hasModule = (id: string) => enabled.has(id)
    const moduleLabel = (id: string) => FEATURE_MODULES.find(m => m.id === id)?.label ?? id
    const renderSupplementalModule = (id: string): string => {
      const label = moduleLabel(id)
      const common = `upv-supplemental upv-supplemental-${id}`
      if (id === 'chat-panel') {
        return `
          <div class="${common}">
            <div class="upv-sup-head">聊天频道</div>
            <div class="upv-sup-chat-line"><b>队伍</b><span>准备进入目标区域</span></div>
            <div class="upv-sup-chat-line"><b>系统</b><span>任务目标已更新</span></div>
            <div class="upv-sup-chat-input">输入消息...</div>
          </div>
        `
      }
      if (id === 'quest-tracker') {
        return `
          <div class="${common}">
            <div class="upv-sup-head">任务追踪</div>
            <div class="upv-sup-title">${esc(blueprint.stage.playerGoal)}</div>
            <div class="upv-sup-progress"><i style="width:68%"></i></div>
          </div>
        `
      }
      if (id === 'interaction-hints') {
        return `<div class="${common}"><b>E</b><span>${esc(blueprint.stage.cta)}</span></div>`
      }
      if (id === 'health-status') {
        return `
          <div class="${common}">
            <div class="upv-sup-head">生命状态</div>
            <div class="upv-sup-bars"><span>HP</span><i style="width:72%"></i></div>
            <div class="upv-sup-bars mana"><span>STA</span><i style="width:55%"></i></div>
          </div>
        `
      }
      if (id === 'skill-bar') {
        return `<div class="${common}">${['Q', 'W', 'E', 'R'].map(k => `<button>${k}</button>`).join('')}</div>`
      }
      if (id === 'weapon-hud') {
        return `<div class="${common}"><div class="upv-sup-head">武器</div><strong>MK-II</strong><span>突击步枪</span></div>`
      }
      if (id === 'ammo-counter') {
        return `<div class="${common}"><strong>30</strong><span>/ 90</span></div>`
      }
      if (id === 'reticle') {
        return `<div class="${common}">+</div>`
      }
      if (id === 'scoreboard') {
        return `<div class="${common}"><div class="upv-sup-head">排名/比分</div><strong>02</strong><span> / 12</span></div>`
      }
      if (id === 'score-display') {
        return `<div class="${common}"><div class="upv-sup-head">当前得分</div><strong>12,480</strong></div>`
      }
      if (id === 'level-counter') {
        return `<div class="${common}"><div class="upv-sup-head">关卡/阶段</div><strong>12</strong></div>`
      }
      if (id === 'step-counter') {
        return `<div class="${common}"><div class="upv-sup-head">剩余步数</div><strong>18</strong></div>`
      }
      if (id === 'endless-mode') {
        return `<div class="${common}"><div class="upv-sup-head">无限模式</div><span>轻松游玩</span></div>`
      }
      if (id === 'resource-tracker' || id === 'currency') {
        return `<div class="${common}"><span>${id === 'currency' ? '💰' : '资源'}</span><strong>${id === 'currency' ? '4,200' : '木材 36 · 金属 12'}</strong></div>`
      }
      if (id === 'minimap') {
        return `<div class="${common}"><div class="upv-sup-minimap-grid"></div><i></i></div>`
      }
      if (id === 'item-slot') {
        return `<div class="${common}">${['1', '2', '3', '4'].map((n, i) => `<button class="${i === 0 ? 'active' : ''}">${n}</button>`).join('')}</div>`
      }
      if (id === 'dialog-box') {
        return `<div class="${common}"><div class="upv-sup-head">对话</div><p>「继续推进当前目标。」</p><button>回应</button></div>`
      }
      if (id === 'modal-dialog') {
        return `<div class="${common}"><strong>确认操作</strong><span>是否继续？</span><button>确认</button></div>`
      }
      if (id === 'pause-menu') {
        return `<div class="${common}"><strong>暂停菜单</strong><button>继续</button><button>设置</button><button>退出</button></div>`
      }
      if (id === 'settings-panel') {
        return `<div class="${common}"><strong>设置</strong><span>音量 80%</span><span>画质 高</span></div>`
      }
      if (id === 'main-nav') {
        return `<div class="${common}">${['开始', '任务', '背包', '设置'].map((item, i) => `<button class="${i === 0 ? 'active' : ''}">${item}</button>`).join('')}</div>`
      }
      if (id === 'inventory-grid') {
        return `<div class="${common}">${Array.from({ length: 9 }, (_, i) => `<span>${i === 0 ? '⚔' : ''}</span>`).join('')}</div>`
      }
      if (id === 'item-detail') {
        return `<div class="${common}"><div class="upv-sup-head">道具详情</div><strong>精良装备</strong><span>攻击 +24</span><button>装备</button></div>`
      }
      if (id === 'character-panel') {
        return `<div class="${common}"><div class="upv-sup-head">角色属性</div><span>攻击 248</span><span>防御 190</span><span>速度 122</span></div>`
      }
      if (id === 'crafting-panel') {
        return `<div class="${common}"><div class="upv-sup-head">制作面板</div><span>木材 12/8</span><span>铁矿 5/3</span><button>制作</button></div>`
      }
      if (id === 'shop-panel') {
        return `<div class="${common}"><div class="upv-sup-head">商店</div><span>补给包</span><span>¥ 480</span><button>购买</button></div>`
      }
      if (id === 'reward-summary') {
        return `<div class="${common}"><strong>奖励结算</strong><span>金币 +2400</span><span>经验 +1200</span><button>继续</button></div>`
      }
      if (id === 'map-screen') {
        return `<div class="${common}"><div class="upv-sup-map-grid"></div><span class="pin a">▲</span><span class="pin b">!</span></div>`
      }
      if (id === 'game-board') {
        return `<div class="${common}">${Array.from({ length: 25 }, (_, i) => `<span>${['◆', '●', '★', '■'][i % 4]}</span>`).join('')}</div>`
      }
      if (id === 'tech-tree') {
        return `<div class="${common}"><strong>科技树</strong><div><span>采集</span><i></i><span>建造</span><i></i><span>强化</span></div></div>`
      }
      if (id === 'level-select') {
        return `<div class="${common}">${Array.from({ length: 5 }, (_, i) => `<button class="${i === 1 ? 'active' : ''}">${i + 1}</button>`).join('')}</div>`
      }
      if (id === 'weapon-select') {
        return `<div class="${common}">${['手枪', '步枪', '狙击'].map((w, i) => `<button class="${i === 1 ? 'active' : ''}">${w}</button>`).join('')}</div>`
      }
      return `<div class="${common}"><div class="upv-sup-head">${esc(label)}</div><span>模块预览</span></div>`
    }
    const renderSupplementalModules = (renderedIds: string[]): string => {
      const missing = Array.from(enabled).filter(id => !renderedIds.includes(id))
      if (missing.length === 0) return ''
      return `
        <div class="upv-supplemental-layer">
          ${missing.map(id => renderSupplementalModule(id)).join('')}
        </div>
      `
    }
    const renderModuleFeedback = (renderedIds: string[]): string => `
      ${options.includeSupplemental ? renderSupplementalModules(renderedIds) : ''}
    `
    const genreLabel = blueprint.genre.label

    const layoutSpec = getLayoutSpec(genre, screen)
    if (layoutSpec) {
      const layoutDriven = renderGenrePreviewByTemplate({
        spec: layoutSpec,
        hasModule,
        esc,
        genreLabel,
        playerFantasy: blueprint.genre.playerFantasy,
        blueprint,
        renderModuleFeedback,
      })
      if (layoutDriven) return layoutDriven
    }

    // ── 开始屏 ───────────────────────────────────────────
    if (screen === 'start') {
      const menuItems = genre === 'fps'
        ? ['开始游戏', '多人对战', '武器库', '战绩', '设置']
        : genre === 'action-rpg'
        ? ['新游戏', '继续', '章节选择', '存档', '设置']
        : genre === 'puzzle'
        ? ['开始', '关卡选择', '排行榜', '设置']
        : ['开始游戏', '继续', '任务', '商店', '设置']
      const renderedIds: string[] = []
      if (hasModule('main-nav')) renderedIds.push('main-nav')
      return `
        <div class="upv-start">
          <div class="upv-start-logo">${esc(genreLabel)}</div>
          <div class="upv-start-sub">${esc(blueprint.stage.playerGoal)}</div>
          <nav class="upv-start-menu">
            ${menuItems.map((item, i) => `<button class="upv-start-item${i === 0 ? ' primary' : ''}">${item}</button>`).join('')}
          </nav>
          <div class="upv-start-foot">版本 1.0.0 &nbsp;·&nbsp; ${esc(genreLabel)}</div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── HUD 战斗/游玩屏 ──────────────────────────────────
    if (screen === 'hud') {
      const isFPS = genre === 'fps'
      const isRPG = genre === 'action-rpg'
      const isPuzzle = genre === 'puzzle'
      const renderedIds: string[] = []
      if (hasModule('minimap')) renderedIds.push('minimap')
      if (hasModule('quest-tracker')) renderedIds.push('quest-tracker')
      if (isFPS && hasModule('ammo-counter')) renderedIds.push('ammo-counter')
      if (isFPS && hasModule('reticle')) renderedIds.push('reticle')
      if (hasModule('health-status')) renderedIds.push('health-status')
      if (hasModule('skill-bar')) renderedIds.push('skill-bar')
      if (hasModule('score-display')) renderedIds.push('score-display')
      if (hasModule('currency')) renderedIds.push('currency')
      if (hasModule('interaction-hints')) renderedIds.push('interaction-hints')
      if (isFPS && hasModule('weapon-hud')) renderedIds.push('weapon-hud')
      if (isPuzzle && hasModule('level-counter')) renderedIds.push('level-counter')
      return `
        <div class="upv-hud">
          ${hasModule('minimap') ? `<div class="upv-hud-minimap"><div class="upv-hud-minimap-dot"></div></div>` : ''}
          ${hasModule('quest-tracker') ? `<div class="upv-hud-quest"><div class="upv-hud-label">当前目标</div><div class="upv-hud-quest-text">${esc(blueprint.stage.playerGoal)}</div></div>` : ''}
          ${(isFPS && hasModule('ammo-counter')) ? `<div class="upv-hud-ammo"><span class="upv-hud-num">30</span><span class="upv-hud-sep">/</span><span class="upv-hud-num dim">90</span></div>` : ''}
          ${(isFPS && hasModule('reticle')) ? `<div class="upv-hud-reticle">+</div>` : ''}
          ${hasModule('health-status') ? `<div class="upv-hud-health"><div class="upv-hud-label">HP</div><div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:72%"></div></div></div>` : ''}
          ${hasModule('health-status') ? `<div class="upv-hud-stamina"><div class="upv-hud-label">状态</div><div class="upv-hud-bar"><div class="upv-hud-bar-fill sta" style="width:55%"></div></div></div>` : ''}
          ${hasModule('skill-bar') ? `<div class="upv-hud-skills">${['Q','W','E','R'].map((k,i)=>`<div class="upv-hud-skill uid-live-icon-${i}" style="background-size:60%;background-repeat:no-repeat;background-position:40% 35%"><span class="upv-hud-skill-key">${k}</span></div>`).join('')}</div>` : ''}
          ${hasModule('score-display') ? `<div class="upv-hud-score"><div class="upv-hud-label">得分</div><div class="upv-hud-num large">12480</div></div>` : ''}
          ${hasModule('currency') ? `<div class="upv-hud-currency">💰 4,200</div>` : ''}
          ${hasModule('interaction-hints') ? `<div class="upv-hud-center-hint">按 E 交互 · ${esc(blueprint.stage.cta)}</div>` : ''}
          ${(isFPS && hasModule('weapon-hud')) ? `<div class="upv-hud-quest" style="top:auto;bottom:80px;right:14px;"><div class="upv-hud-label">武器</div><div class="upv-hud-quest-text">突击步枪 MK-II</div></div>` : ''}
          ${(isPuzzle && hasModule('level-counter')) ? `<div class="upv-hud-quest" style="right:auto;left:50%;top:14px;transform:translateX(-50%);"><div class="upv-hud-label">关卡</div><div class="upv-hud-quest-text">第 12 关</div></div>` : ''}
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 背包/角色屏 ──────────────────────────────────────
    if (screen === 'bag' || screen === 'character') {
      const isFoodBag = genre === 'life-sim'
      const isCraftBag = genre === 'survival'
      const showCraftingDetail = isCraftBag || hasModule('crafting-panel')
      const tabs = screen === 'character'
        ? ['角色', '武器', '圣遗物', '天赋']
        : isFoodBag
        ? ['料理', '材料', '药剂', '收藏']
        : isCraftBag
        ? ['蓝图', '材料', '工具', '陷阱']
        : ['武器', '装备', '消耗品', '材料']
      const categoryIcons = screen === 'character'
        ? ['人', '刃', '星', '卷', '包', '设']
        : isFoodBag
        ? ['锅', '刀', '鱼', '菜', '瓶', '包']
        : isCraftBag
        ? ['图', '锤', '木', '车', '药', '箱']
        : ['包', '剑', '盾', '晶', '书', '币']
      const itemNames = screen === 'character'
        ? ['飞雷之弦振', '天空之翼', '祭礼弓', '终末弓', '黑剑', '西风剑', '风鹰剑', '匣里龙吟', '讨龙书', '流浪乐章', '祭礼残章', '白影剑', '试作斩岩', '西风长枪', '渔获']
        : isFoodBag
        ? ['虾球', '煎蛋', '烤蘑菇', '薄荷汤', '鱼肉卷', '肉排', '蔬菜汤', '饭团', '煎饼', '甜甜花酿鸡', '松茸酿肉卷', '奶油蟹', '火火肉酱面', '莲子禽蛋羹', '树莓水']
        : isCraftBag
        ? ['尖刺陷阱', '砍刀', '缝纫台', '越野车', '撬棍', '毛线帽', '厚夹克', '牛仔裤', '工作靴', '工作台', '无线电塔', '钉板', '落地灯', '氏族旗帜', '盆栽']
        : ['精铁剑', '治疗药水', '魔法卷轴', '皮革甲', '守护戒指', '迅捷靴', '火焰符石', '冰霜碎片', '远古钥匙', '宝石袋', '强化石', '任务信物', '银币包', '地图碎片', '神秘盒']
      const detailTitle = itemNames[2] ?? itemNames[0] ?? '道具详情'
      const detailKind = screen === 'character' ? '弓' : isFoodBag ? '恢复料理' : showCraftingDetail ? '制造蓝图' : '稀有道具'
      const detailDesc = screen === 'character'
        ? '暴击伤害 66.2%，基础攻击力 608。命中后提升队伍战斗节奏。'
        : isFoodBag
        ? '恢复选中角色生命值，并在短时间内提供额外体力回复。'
        : showCraftingDetail
        ? '用于搭建核心工作设施，解锁布料加工与装备升级流程。'
        : '可装备或使用的核心物品，影响角色成长与战斗表现。'
      const renderedIds: string[] = []
      if (hasModule('inventory-grid')) renderedIds.push('inventory-grid')
      if (hasModule('item-detail')) renderedIds.push('item-detail')
      if (hasModule('crafting-panel')) renderedIds.push('crafting-panel')
      if (screen === 'character' && hasModule('character-panel')) renderedIds.push('character-panel')
      if (hasModule('currency')) renderedIds.push('currency')
      if (hasModule('resource-tracker')) renderedIds.push('resource-tracker')
      return `
        <div class="upv-bag upv-bag-rich">
          <aside class="upv-bag-rail">
            ${categoryIcons.map((icon, i) => `
              <button class="upv-bag-rail-btn${i === 1 ? ' active' : ''}${i === 2 ? ' notify' : ''}">
                <span>${esc(icon)}</span>
              </button>
            `).join('')}
          </aside>
          <section class="upv-bag-main">
            <header class="upv-bag-header">
              <div>
                <div class="upv-bag-title">${screen === 'character' ? '背包 / 武器' : isCraftBag ? '蓝图 / 全部' : isFoodBag ? '料理 / 全部' : '背包 / 道具'}</div>
                <div class="upv-bag-sub">${esc(blueprint.stage.playerGoal)}</div>
              </div>
              ${(hasModule('currency') || hasModule('resource-tracker')) ? `
                <div class="upv-bag-wallet">
                  ${hasModule('currency') ? '<span>金币 7100908</span>' : ''}
                  ${hasModule('resource-tracker') ? '<span>容量 50/2000</span>' : ''}
                </div>
              ` : ''}
            </header>
            <div class="upv-bag-tabs">${tabs.map((t,i)=>`<button class="upv-bag-tab${i===0?' active':''}">${esc(t)}</button>`).join('')}</div>
            ${hasModule('inventory-grid') ? `
            <div class="upv-bag-grid">
              ${itemNames.map((name, i) => `
                <button class="upv-bag-slot${i === 2 ? ' selected' : ''}${i % 5 === 0 ? ' rare' : ''}">
                  <span class="upv-bag-item-icon uid-live-icon-${i % 4}">${isFoodBag ? '◉' : isCraftBag ? '▰' : '✦'}</span>
                  <span class="upv-bag-item-name">${esc(name)}</span>
                  <span class="upv-bag-item-meta">${screen === 'character' ? `Lv.${[90,80,70,60,50][i % 5]}` : isCraftBag ? `${i % 3 === 0 ? '!' : ''}` : '★★★'}</span>
                </button>
              `).join('')}
            </div>
            ` : ''}
            <footer class="upv-bag-footer">
              <button class="upv-bag-filter">筛选 / 全部</button>
              <button class="upv-bag-sort">品质顺序</button>
            </footer>
          </section>
          <aside class="upv-bag-detail">
            <div class="upv-bag-detail-card">
              <div class="upv-bag-detail-art uid-live-icon-2">${isFoodBag ? '◉' : isCraftBag ? '▰' : '✦'}</div>
              <div class="upv-bag-detail-title">${esc(detailTitle)}</div>
              <div class="upv-bag-detail-kind">${esc(detailKind)}</div>
              <div class="upv-bag-detail-stars">★★★★★</div>
              <p>${esc(detailDesc)}</p>
              ${showCraftingDetail ? `
                <div class="upv-bag-craft-section">
                  <div class="upv-bag-craft-title">制作需求</div>
                  <div class="upv-bag-materials">
                  ${['木材 0/20', '铁锭 0/15', '线圈 0/5'].map(item => `<span>${esc(item)}</span>`).join('')}
                  </div>
                  <div class="upv-bag-craft-note">材料不足时按钮保持禁用视觉，结构仍保留在详情栏。</div>
                </div>
              ` : `
                <div class="upv-bag-detail-stats">
                  <span>等级 <b>${screen === 'character' ? '90/90' : '8/15'}</b></span>
                  <span>${isFoodBag ? '恢复' : '评分'} <b>${isFoodBag ? '900-1500' : '608'}</b></span>
                </div>
              `}
              <button class="upv-bag-action${showCraftingDetail ? ' craft' : ''}">${showCraftingDetail ? '制作' : screen === 'character' ? '装备' : '使用'}</button>
            </div>
          </aside>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 对话屏 ───────────────────────────────────────────
    if (screen === 'dialog') {
      const options = genre === 'action-rpg'
        ? ['我愿意接受任务', '告诉我更多', '以后再说', '[离开]']
        : ['继续', '追问细节', '[关闭]']
      const renderedIds: string[] = []
      if (hasModule('dialog-box')) renderedIds.push('dialog-box')
      return `
        <div class="upv-dialog">
          <div class="upv-dialog-scene">
            <div class="upv-dialog-npc-placeholder">NPC</div>
          </div>
          <div class="upv-dialog-box">
            <div class="upv-dialog-name">神秘商人</div>
            <div class="upv-dialog-text">「${esc(blueprint.stage.playerGoal)}……你看起来正是我需要的人。」</div>
            <div class="upv-dialog-options">
              ${options.map(o=>`<button class="upv-dialog-opt">${o}</button>`).join('')}
            </div>
          </div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 商店屏 ───────────────────────────────────────────
    if (screen === 'shop') {
      const items = genre === 'fps'
        ? ['突击步枪', '手雷×3', '防弹背心', '医疗包']
        : genre === 'action-rpg'
        ? ['治疗药水', '魔法卷轴', '精铁剑', '皮革甲']
        : ['道具包', '升级石', '皮肤碎片', '体力罐']
      const renderedIds: string[] = []
      if (hasModule('shop-panel')) renderedIds.push('shop-panel')
      if (hasModule('currency')) renderedIds.push('currency')
      return `
        <div class="upv-shop">
          <div class="upv-shop-header">
            <span class="upv-shop-title">商店</span>
            ${hasModule('currency') ? `<span class="upv-shop-gold">💰 4,200</span>` : ''}
          </div>
          <div class="upv-shop-tabs"><button class="active">推荐</button><button>武器</button><button>防具</button><button>消耗</button></div>
          <div class="upv-shop-grid">
            ${items.map((name,i)=>`
              <div class="upv-shop-item">
                <div class="upv-shop-icon uid-live-icon-${i}" style="width:40px;height:40px;background-size:contain;background-repeat:no-repeat;background-position:center">📦</div>
                <div class="upv-shop-name">${name}</div>
                <div class="upv-shop-price">¥ 480</div>
                <button class="upv-shop-buy">购买</button>
              </div>
            `).join('')}
          </div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 关卡选择屏 ───────────────────────────────────────
    if (screen === 'level-select') {
      const renderedIds: string[] = []
      if (hasModule('level-select')) renderedIds.push('level-select')
      return `
        <div class="upv-levelsel">
          <div class="upv-levelsel-header">选择关卡</div>
          <div class="upv-levelsel-grid">
            ${Array.from({length:9},(_,i)=>`
              <div class="upv-levelsel-node${i<3?' done':i===3?' current':i===4?' locked':' locked'}">
                <div class="upv-levelsel-num">${i+1}</div>
                <div class="upv-levelsel-stars">${i<3?'★★★':i===3?'★★☆':'☆☆☆'}</div>
              </div>
            `).join('')}
          </div>
          <div class="upv-levelsel-foot">已解锁 3/9 · 最高 ${esc(blueprint.stage.cta)}</div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 武器选择/轮盘屏 ─────────────────────────────────
    if (screen === 'weapon-select') {
      const weapons = genre === 'fps'
        ? ['手枪','突击步枪','狙击枪','霰弹枪','手雷','刀']
        : ['长剑','法杖','弓','匕首','盾','魔法书']
      const renderedIds: string[] = []
      if (hasModule('weapon-select')) renderedIds.push('weapon-select')
      if (hasModule('weapon-hud')) renderedIds.push('weapon-hud')
      return `
        <div class="upv-weaponwheel">
          <div class="upv-ww-ring">
            ${weapons.map((w,i)=>`
              <div class="upv-ww-slot" style="--i:${i};--n:${weapons.length}">
                <div class="upv-ww-slot-inner${i===1?' active':''}">
                  <div class="upv-ww-icon uid-live-icon-${i % 4}" style="width:28px;height:28px;background-size:contain;background-repeat:no-repeat;background-position:center">⚔</div>
                  <div class="upv-ww-name">${w}</div>
                </div>
              </div>
            `).join('')}
            <div class="upv-ww-center">切换</div>
          </div>
          <div class="upv-ww-info">当前：${weapons[1]} &nbsp;·&nbsp; 弹药 30/90</div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 地图屏 ───────────────────────────────────────────
    if (screen === 'map') {
      const renderedIds: string[] = []
      if (hasModule('map-screen')) renderedIds.push('map-screen')
      return `
        <div class="upv-map">
          <div class="upv-map-canvas">
            <div class="upv-map-grid"></div>
            <div class="upv-map-pin player" style="left:48%;top:52%">▲</div>
            <div class="upv-map-pin quest" style="left:62%;top:38%">!</div>
            <div class="upv-map-pin quest" style="left:30%;top:61%">!</div>
          </div>
          <div class="upv-map-legend">
            <div class="upv-map-legend-row"><span class="pin player">▲</span> 玩家位置</div>
            <div class="upv-map-legend-row"><span class="pin quest">!</span> 任务地点</div>
          </div>
          <div class="upv-map-filter">
            <button class="active">全部</button><button>主线</button><button>支线</button><button>商店</button>
          </div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 暂停屏 ───────────────────────────────────────────
    if (screen === 'pause') {
      const renderedIds: string[] = []
      if (hasModule('pause-menu')) renderedIds.push('pause-menu')
      return `
        <div class="upv-pause">
          <div class="upv-pause-overlay"></div>
          <div class="upv-pause-panel">
            <div class="upv-pause-title">游戏暂停</div>
            <div class="upv-pause-info">${esc(genreLabel)} · ${esc(blueprint.stage.label)}</div>
            <nav class="upv-pause-menu">
              ${['继续游戏','任务日志','设置','存档','返回主菜单'].map((item,i)=>`
                <button class="upv-pause-item${i===0?' primary':''}">${item}</button>
              `).join('')}
            </nav>
          </div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 结算/结尾屏 ─────────────────────────────────────
    if (screen === 'results' || screen === 'end') {
      const isPerfect = true
      const renderedIds: string[] = []
      if (hasModule('reward-summary')) renderedIds.push('reward-summary')
      return `
        <div class="upv-results">
          <div class="upv-results-header">
            <div class="upv-results-badge ${isPerfect ? 'gold' : 'silver'}">${isPerfect ? 'S+' : 'A'}</div>
            <div class="upv-results-title">${screen === 'end' ? '游戏通关' : '任务完成'}</div>
          </div>
          <div class="upv-results-stats">
            <div class="upv-results-row"><span>完成时间</span><b>12:34</b></div>
            <div class="upv-results-row"><span>完成度</span><b>93%</b></div>
            <div class="upv-results-row"><span>奖励</span><b class="accent">+2400 💰</b></div>
            ${genre === 'fps' ? `<div class="upv-results-row"><span>击杀数</span><b>18</b></div>` : ''}
            ${genre === 'action-rpg' ? `<div class="upv-results-row"><span>经验值</span><b>+1200 EXP</b></div>` : ''}
          </div>
          <div class="upv-results-actions">
            <button class="upv-results-btn primary">${esc(blueprint.stage.cta)}</button>
            <button class="upv-results-btn">返回主菜单</button>
          </div>
          ${renderModuleFeedback(renderedIds)}
        </div>
      `
    }

    // ── 通用 HUD fallback ────────────────────────────────
    return `
      <div class="upv-hud">
        ${hasModule('minimap') ? `<div class="upv-hud-minimap"><div class="upv-hud-minimap-dot"></div></div>` : ''}
        ${hasModule('health-status') ? `<div class="upv-hud-health"><div class="upv-hud-label">HP</div><div class="upv-hud-bar"><div class="upv-hud-bar-fill hp" style="width:72%"></div></div></div>` : ''}
        ${(hasModule('currency') || hasModule('resource-tracker')) ? `<div class="upv-hud-currency">💰 4,200</div>` : ''}
        <div class="upv-hud-center-hint">${esc(blueprint.genre.playerFantasy)}</div>
        ${renderModuleFeedback([])}
      </div>
    `
  }
