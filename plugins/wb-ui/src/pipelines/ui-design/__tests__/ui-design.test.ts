import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import pipeline from '../index'
import { renderScreenPreviewMarkup } from '../layout-templates/screen-preview'
import {
  STORAGE_KEY,
  RUNTIME_STORAGE_KEY,
  buildBlueprint,
  createDefaultState,
  FEATURE_MODULES,
  hydrateState,
  stageEssentialFeatures,
  // New
  GENRE_PRESETS,
  STYLE_RECOMMENDATIONS,
  PC_LAYOUT_RULES,
  detectConflicts,
  defaultStyleBoardPrompt,
  ASSET_KIND_LABELS,
  COMPONENT_VERIFICATION_STEPS,
  GENRE_COMPONENT_KITS,
  getScreenFlow,
  getScreenModules,
  getGenreComponentKit,
  getStyleBoardPreviewScreens,
  getStyleBoardSections,
  buildComponentLibrarySteps,
  buildModuleAssetSpecs,
  iconLabelsFromModuleSpecs,
  resolveIconSlotCount,
  resolveStyleBoardSectionsForLayout,
  getActiveStyleBoardSectionIds,
  recommendedStyles,
  sceneSuggestions,
} from '../model'

const INDEX_SOURCE = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const SCREEN_PREVIEW_SOURCE = readFileSync(new URL('../layout-templates/screen-preview.ts', import.meta.url), 'utf8')
const GENRE_SCREENS_SOURCE = readFileSync(new URL('../layout-templates/genre-screens.ts', import.meta.url), 'utf8')
const GENRE_LAYOUT_CSS_SOURCE = readFileSync(new URL('../genre-layout-styles.css', import.meta.url), 'utf8')
const PREVIEW_SCREEN_CSS_SOURCE = readFileSync(new URL('../preview-screen-styles.css', import.meta.url), 'utf8')
const API_PLUGIN_SOURCE = readFileSync(new URL('../../../../server/api-plugin.ts', import.meta.url), 'utf8')

function renderLayoutStepPreview(
  genrePreset: ReturnType<typeof createDefaultState>['genrePreset'],
  screen: Parameters<typeof renderScreenPreviewMarkup>[2],
  selectedFeatures: string[],
): string {
  const state = hydrateState({
    genrePreset,
    selectedFeatures,
    workflowStep: 'layout',
  })
  return renderScreenPreviewMarkup(state, buildBlueprint(state), screen, { includeSupplemental: true })
}

// ────── 管线元数据 ──────────────────────────────────────────────────
describe('ui-design pipeline', () => {
  it('registers with the stable pipeline meta', () => {
    expect(pipeline.meta.id).toBe('ui-design')
    expect(pipeline.meta.name).toBe('UI设计')
    expect(pipeline.meta.icon).toBeTruthy()
  })

  it('切换工作台后应恢复 localStorage 工作流与运行时素材快照', () => {
    expect(INDEX_SOURCE).toContain('private restorePersistedSession(): void')
    expect(INDEX_SOURCE).toContain('loadState()')
    expect(INDEX_SOURCE).toContain('saveRuntimeSnapshot')
    expect(INDEX_SOURCE).toContain('ui-design:request-sync')
  })

  it('硬刷新时应清空整段 UI 工坊会话而非仅跳过生成物', () => {
    expect(INDEX_SOURCE).toContain('shouldStartFreshSession')
    expect(INDEX_SOURCE).toContain('beginFreshSession')
    expect(INDEX_SOURCE).toContain('wipePersistedSession')
    expect(INDEX_SOURCE).toContain('acceptPersistedSessionOnThisLoad')
  })

  it('uses the stable storage key and safe default state', () => {
    const state = createDefaultState()
    expect(STORAGE_KEY).toBe('character-editor:ui-design-state')
    expect(RUNTIME_STORAGE_KEY).toBe('character-editor:ui-design-runtime')
    expect(state.genrePreset).toBe('open-world')
    expect(state.workflowStep).toBe('genre')
    expect(state.styleBoardPrompt).toContain('开放世界')
    expect(state.selectedFeatures.length).toBeGreaterThan(0)
  })

  it('hydrates partial saved state without dropping defaults', () => {
    const state = hydrateState({ genrePreset: 'action-rpg', notes: '高沉浸', workflowStep: 'component-refine' })
    expect(state.genrePreset).toBe('action-rpg')
    expect(state.notes).toBe('高沉浸')
    expect(state.workflowStep).toBe('component-preview')
    expect(state.previewMode).toBe('hud')
  })

  it('migrates legacy workflowStep style-board / prompt-library / component-refine to component-preview', () => {
    expect(hydrateState({ workflowStep: 'style-board' as never }).workflowStep).toBe('component-preview')
    expect(hydrateState({ workflowStep: 'prompt-library' as never }).workflowStep).toBe('component-preview')
    expect(hydrateState({ workflowStep: 'component-refine' as never }).workflowStep).toBe('component-preview')
  })

  it('hydrates asset history cards with preview thumbnails', () => {
    const state = hydrateState({
      assetHistory: [{
        id: 'pack-1',
        label: '开放世界 · 现代暗色',
        genrePreset: 'open-world',
        style: 'modern-dark',
        sceneDesc: '雨夜街区',
        confirmedAt: 123,
        preview: {
          buttonPrimary: 'data:image/png;base64,AAA',
          titleDeco: 'data:image/png;base64,BBB',
          icon: 'data:image/png;base64,CCC',
        },
      }],
    })
    expect(state.assetHistory).toHaveLength(1)
    expect(state.assetHistory[0]?.preview?.buttonPrimary).toContain('data:image/png')
  })

  it('hydrates lock state and compare target for visual library workflow', () => {
    const state = hydrateState({
      lockedAssetKinds: ['buttonPrimary', 'icons'],
      compareHistoryPackId: 'pack-1',
    })
    expect(state.lockedAssetKinds).toEqual(['buttonPrimary', 'icons'])
    expect(state.compareHistoryPackId).toBe('pack-1')
  })

  it('asset kind labels stay stable for lock summary UI', () => {
    expect(ASSET_KIND_LABELS.buttonPrimary).toBe('主按钮')
    expect(ASSET_KIND_LABELS.panelTexture).toBe('面板纹理')
    expect(ASSET_KIND_LABELS.icons).toBe('图标组')
  })

  it('进入组件预览步骤不能自动开始生成，必须由左侧按钮显式触发', () => {
    expect(INDEX_SOURCE).toContain('renderComponentLibraryIdleCenter')
    expect(INDEX_SOURCE).toContain('等待生成 UI 组件素材')
    expect(INDEX_SOURCE).not.toMatch(/componentLibraryAutoRequestKey\s*=\s*this\.componentVisualRequestKey\(\)[\s\S]*?void this\.loadComponentLibrary\(\)/)
    expect(INDEX_SOURCE).toMatch(/data-uid-action="generate-component-preview"[\s\S]*?restartComponentGeneration/)
  })

  it('可交互原型生成时立即同步 loading 到中央预览（双 iframe）', () => {
    expect(INDEX_SOURCE).toContain('prototypeGenerating')
    expect(INDEX_SOURCE).toContain('renderPrototypeGeneratingCenter')
    expect(INDEX_SOURCE).toContain('beginPrototypeGeneration')
    expect(INDEX_SOURCE).toMatch(/prototypeGenerating[\s\S]*broadcastState/)
  })

  it('可交互原型 iframe 内统一 UI 规范（PROTO_UI_SPEC_CSS）', () => {
    expect(INDEX_SOURCE).toContain('PROTO_UI_SPEC_CSS')
    expect(INDEX_SOURCE).toContain('gl-fps-match-btn')
    expect(INDEX_SOURCE).toContain('background-image: none !important')
  })

  it('布局步骤从第一页开始，且需逐页确认后才能确认布局', () => {
    expect(INDEX_SOURCE).toContain("private activeScreen: ScreenKind = 'start'")
    expect(INDEX_SOURCE).toContain('layoutReviewedScreens')
    expect(INDEX_SOURCE).toContain('ensureLayoutScreenFocus')
    expect(INDEX_SOURCE).toContain('confirmCurrentLayoutScreen')
    expect(INDEX_SOURCE).toContain('data-uid-action="confirm-layout-screen"')
    expect(INDEX_SOURCE).toMatch(/allLayoutScreensReviewed[\s\S]*confirmLayout/)
    expect(INDEX_SOURCE).toContain('已确认')
  })
})

// ────── 界面流（PDF 第一步） ─────────────────────────────────────────
describe('getScreenFlow', () => {
  it('RPG 包含: 开始界面 / HUD游玩 / 背包 / 对话 / 角色属性 / 结算', () => {
    const flow = getScreenFlow('action-rpg')
    const kinds = flow.map(s => s.kind)
    expect(kinds).toEqual(expect.arrayContaining(['start', 'hud', 'bag', 'dialog', 'character', 'results']))
  })

  it('FPS 包含: 开始界面 / 武器选择 / HUD游玩 / 结算', () => {
    const flow = getScreenFlow('fps')
    const kinds = flow.map(s => s.kind)
    expect(kinds).toEqual(expect.arrayContaining(['start', 'weapon-select', 'hud', 'results']))
    expect(kinds).not.toContain('bag')
  })

  it('puzzle (三消) 包含: 开始界面 / 关卡选择 / HUD游玩 / 结束界面', () => {
    const flow = getScreenFlow('puzzle')
    const kinds = flow.map(s => s.kind)
    expect(kinds).toEqual(expect.arrayContaining(['start', 'level-select', 'hud', 'end']))
    expect(kinds).not.toContain('character')
  })

  it('open-world 包含: 开始界面 / HUD游玩 / 暂停 / 结算', () => {
    const flow = getScreenFlow('open-world')
    const kinds = flow.map(s => s.kind)
    expect(kinds).toEqual(expect.arrayContaining(['start', 'hud', 'pause', 'results']))
  })

  it('每种游戏类型都至少有 start 和 hud', () => {
    for (const genre of GENRE_PRESETS) {
      const kinds = getScreenFlow(genre.id as any).map(s => s.kind)
      expect(kinds, `${genre.id} 缺少 start`).toContain('start')
      expect(kinds, `${genre.id} 缺少 hud`).toContain('hud')
    }
  })
})

// ────── 模块优先级（PDF 第二步：必/荐/选） ───────────────────────────
describe('getScreenModules', () => {
  it('RPG HUD 中 HP/MP 和技能栏是必选模块', () => {
    const { required } = getScreenModules('action-rpg', 'hud')
    const ids = required.map(m => m.id)
    expect(ids).toEqual(expect.arrayContaining(['health-status', 'skill-bar']))
  })

  it('FPS HUD 中准星、弹药、小地图是必选，比分与交互是推荐', () => {
    const { required, recommended } = getScreenModules('fps', 'hud')
    expect(required.map(m => m.id)).toEqual(expect.arrayContaining(['ammo-counter', 'reticle', 'minimap']))
    expect(recommended.map(m => m.id)).toEqual(expect.arrayContaining(['scoreboard', 'interaction-hints']))
  })

  it('三消 HUD 中棋盘和当前得分是必选', () => {
    const { required } = getScreenModules('puzzle', 'hud')
    expect(required.map(m => m.id)).toEqual(expect.arrayContaining(['game-board', 'score-display']))
  })

  it('RPG 背包界面：道具格子、道具详情是必选', () => {
    const { required } = getScreenModules('action-rpg', 'bag')
    const ids = required.map(m => m.id)
    expect(ids).toEqual(expect.arrayContaining(['inventory-grid', 'item-detail']))
  })

  it('必选模块不能被用户移除（isRequired 标记为 true）', () => {
    const { required } = getScreenModules('action-rpg', 'hud')
    for (const m of required) {
      expect(m.isRequired).toBe(true)
    }
  })

  it('推荐模块默认选中，可选模块默认不选', () => {
    const { recommended, optional } = getScreenModules('fps', 'hud')
    for (const m of recommended) expect(m.defaultOn).toBe(true)
    for (const m of optional) expect(m.defaultOn).toBe(false)
  })
})

describe('layout preview module rendering coverage', () => {
  it('可交互原型与布局预览共用场景壳（renderLayoutSceneBody + gl-proto-genre-shell）', () => {
    expect(INDEX_SOURCE).toContain('renderScreenPreviewMarkup(state, blueprint, screen.kind')
    expect(INDEX_SOURCE).toContain('renderLayoutSceneBody')
    expect(INDEX_SOURCE).toContain('collectPrototypeAssets')
    expect(INDEX_SOURCE).toContain('buildPrototypeChromeCss')
    expect(INDEX_SOURCE).toContain('uid-preview-scene')
    expect(INDEX_SOURCE).toContain('WORKBENCH_LAYOUT_SCENE_CSS')
    expect(GENRE_SCREENS_SOURCE).toContain('GENRE_START_LAYOUT_PARITY_CSS')
    expect(GENRE_SCREENS_SOURCE).toContain('uid-preview-scene > .gl-proto-genre-shell')
    expect(GENRE_SCREENS_SOURCE).toContain('wrapGenreLayoutShell')
    expect(GENRE_SCREENS_SOURCE).toContain('gl-proto-genre-shell')
    expect(GENRE_SCREENS_SOURCE).toContain('GENRE_LAYOUT_PROTO_CSS')
  })

  it('每个 FEATURE_MODULES 模块都有补充预览渲染分支，避免已选模块只显示标签或消失', () => {
    for (const module of FEATURE_MODULES) {
      expect(
        SCREEN_PREVIEW_SOURCE.includes(`id === '${module.id}'`),
        `${module.id} (${module.label}) 缺少 renderSupplementalModule 分支`,
      ).toBe(true)
    }
  })

  it('类型专属布局不能隐藏 supplemental layer，否则可选模块点击后没有预览反馈', () => {
    expect(GENRE_LAYOUT_CSS_SOURCE).not.toMatch(/upv-supplemental-layer\s*\{\s*display:\s*none/)
    expect(GENRE_LAYOUT_CSS_SOURCE).not.toMatch(/upv-supplemental-layer\s*\{[^}]*display:\s*none/)
  })

  it('各类型布局中未内建的可选模块会通过 supplemental 兜底显示', () => {
    const cases: Array<{
      genre: ReturnType<typeof createDefaultState>['genrePreset']
      screen: Parameters<typeof renderScreenPreviewMarkup>[2]
      selected: string[]
      expectedSupplemental: string[]
    }> = [
      { genre: 'action-rpg', screen: 'hud', selected: ['chat-panel', 'shop-panel'], expectedSupplemental: ['chat-panel', 'shop-panel'] },
      { genre: 'fps', screen: 'hud', selected: ['chat-panel', 'reward-summary'], expectedSupplemental: ['chat-panel', 'reward-summary'] },
      { genre: 'fps', screen: 'weapon-select', selected: ['main-nav'], expectedSupplemental: ['main-nav'] },
      { genre: 'survival', screen: 'hud', selected: ['weapon-hud', 'ammo-counter'], expectedSupplemental: ['weapon-hud', 'ammo-counter'] },
      { genre: 'mmo', screen: 'hud', selected: ['shop-panel', 'map-screen', 'reward-summary', 'resource-tracker'], expectedSupplemental: ['shop-panel', 'map-screen', 'reward-summary', 'resource-tracker'] },
      { genre: 'mmo', screen: 'character', selected: ['character-panel', 'resource-tracker', 'inventory-grid', 'item-detail'], expectedSupplemental: ['inventory-grid'] },
      { genre: 'life-sim', screen: 'hud', selected: ['quest-tracker', 'main-nav'], expectedSupplemental: ['quest-tracker', 'main-nav'] },
      { genre: 'racing', screen: 'hud', selected: ['chat-panel', 'map-screen', 'weapon-select'], expectedSupplemental: ['chat-panel', 'map-screen', 'weapon-select'] },
      { genre: 'puzzle', screen: 'hud', selected: ['reward-summary', 'pause-menu'], expectedSupplemental: ['reward-summary', 'pause-menu'] },
      { genre: 'puzzle', screen: 'level-select', selected: ['main-nav', 'resource-tracker'], expectedSupplemental: ['main-nav', 'resource-tracker'] },
      { genre: 'action-rpg', screen: 'results', selected: ['main-nav'], expectedSupplemental: ['main-nav'] },
    ]

    for (const item of cases) {
      const html = renderLayoutStepPreview(item.genre, item.screen, item.selected)
      for (const moduleId of item.expectedSupplemental) {
        expect(
          html,
          `${item.genre}/${item.screen} 点选 ${moduleId} 后没有 supplemental 预览`,
        ).toContain(`upv-supplemental-${moduleId}`)
      }
    }
  })

  it('主导航兜底预览固定在右上角，不占用顶部中心信息区', () => {
    expect(PREVIEW_SCREEN_CSS_SOURCE).toContain('.upv-supplemental-main-nav { right: 14px; top: 14px;')
    expect(PREVIEW_SCREEN_CSS_SOURCE).not.toContain('.upv-supplemental-main-nav { left: 50%;')
    expect(INDEX_SOURCE).toContain("if (moduleId === 'main-nav') return 'anchor-right-top'")
  })
})

// ────── 风格推荐矩阵（PDF 第三步） ───────────────────────────────────
describe('recommendedStyles', () => {
  it('三消推荐"可爱卡通"或"清新田园"', () => {
    const styles = recommendedStyles('puzzle')
    const ids = styles.map(s => s.id)
    expect(ids.some(id => ['cute-cartoon', 'fresh-pastoral'].includes(id))).toBe(true)
  })

  it('FPS 推荐"科幻未来"或"写实军事"', () => {
    const styles = recommendedStyles('fps')
    const ids = styles.map(s => s.id)
    expect(ids.some(id => ['sci-fi', 'realistic-military'].includes(id))).toBe(true)
  })

  it('RPG 推荐"奇幻魔法"或"极简现代"', () => {
    const styles = recommendedStyles('action-rpg')
    const ids = styles.map(s => s.id)
    expect(ids.some(id => ['fantasy', 'modern-minimal'].includes(id))).toBe(true)
  })

  it('每种类型推荐 2-3 个风格', () => {
    for (const genre of GENRE_PRESETS) {
      const styles = recommendedStyles(genre.id as any)
      expect(styles.length, `${genre.id} 风格推荐数量异常`).toBeGreaterThanOrEqual(2)
      expect(styles.length, `${genre.id} 风格推荐数量过多`).toBeLessThanOrEqual(3)
    }
  })

  it('STYLE_RECOMMENDATIONS 包含所有 genre id', () => {
    for (const genre of GENRE_PRESETS) {
      expect(
        STYLE_RECOMMENDATIONS[genre.id as keyof typeof STYLE_RECOMMENDATIONS],
        `${genre.id} 缺少风格推荐`,
      ).toBeDefined()
    }
  })
})

describe('style board workflow', () => {
  it('默认风格拆解提示词包含类型与风格语义', () => {
    const prompt = defaultStyleBoardPrompt({
      genrePreset: 'open-world',
      style: 'modern-dark',
      sceneDesc: '雨夜街区',
    })
    expect(prompt).toContain('开放世界')
    expect(prompt).toContain('现代暗色')
    expect(prompt).toContain('雨夜街区')
  })

  it('风格拆解提示词强制输出游戏类型组件语言而不是通用 UI', () => {
    const prompt = defaultStyleBoardPrompt({
      genrePreset: 'fps',
      style: 'realistic-military',
      sceneDesc: '夜间突入',
    })
    expect(prompt).toContain('游戏类型组件语言')
    expect(prompt).toContain('信息密度')
    expect(prompt).toContain('图标隐喻')
    expect(prompt).toContain('禁止输出通用 Web/SaaS/Dashboard UI')
  })

  it('风格拆解板至少包含按钮/面板/icon/提示四大类', () => {
    const sections = getStyleBoardSections('open-world')
    const ids = sections.map(section => section.id)
    expect(ids).toEqual(expect.arrayContaining(['buttons', 'panels', 'icons', 'notifications']))
  })

  it('FPS 风格拆解板会突出武器与命中反馈相关模块', () => {
    const bars = getStyleBoardSections('fps').find(section => section.id === 'bars')
    const icons = getStyleBoardSections('fps').find(section => section.id === 'icons')
    expect(bars?.items).toEqual(expect.arrayContaining(['弹药条', '命中反馈']))
    expect(icons?.items).toEqual(expect.arrayContaining(['武器图标']))
  })

  it('每个游戏类型都有组件语义 Kit 和类型级 class', () => {
    for (const genre of GENRE_PRESETS) {
      const kit = GENRE_COMPONENT_KITS[genre.id]
      expect(kit, `${genre.id} 缺少组件 Kit`).toBeDefined()
      expect(kit.className).toBe(`uid-genre-${genre.id}`)
      expect(kit.tabs.primary.length).toBeGreaterThanOrEqual(3)
      expect(kit.bars.length).toBeGreaterThanOrEqual(3)
      expect(kit.lists.length).toBeGreaterThanOrEqual(3)
      expect(kit.promptGuidance.join(' ')).toContain('components')
    }
  })

  it('不同游戏类型的 Kit 不只是换文案，还改变密度、形状与组件结构', () => {
    const fps = getGenreComponentKit('fps')
    const puzzle = getGenreComponentKit('puzzle')
    const racing = getGenreComponentKit('racing')

    expect(fps.tokens.density).not.toBe(puzzle.tokens.density)
    expect(fps.tokens.shape).not.toBe(puzzle.tokens.shape)
    expect(fps.tabs.primary).not.toEqual(puzzle.tabs.primary)
    expect(fps.bars.map(item => item.meta)).not.toEqual(racing.bars.map(item => item.meta))
    expect(puzzle.notifications.badge.label).toContain('星级')
    expect(racing.notifications.notice.label).toContain('超车')
  })

  it('组件预览源码必须消费 genre kit 并输出类型 class', () => {
    expect(INDEX_SOURCE).toContain('getGenreComponentKit(this.state.genrePreset)')
    expect(INDEX_SOURCE).toContain('uid-clib-genre-preview')
    expect(INDEX_SOURCE).toContain('data-genre-kit')
    expect(INDEX_SOURCE).toContain('uid-genre-fps')
    expect(INDEX_SOURCE).toContain('uid-genre-puzzle')
    expect(INDEX_SOURCE).toContain('uid-genre-racing')
  })

  it('动态组件展开预览复用小图卡片结构，避免样式和底图不一致', () => {
    expect(INDEX_SOURCE).toContain('uid-clib-extra-card uid-asset-section-zoom')
    expect(INDEX_SOURCE).toContain("return this.renderDynamicSectionPreview(section)")
    expect(INDEX_SOURCE).toContain('uid-asset-lightbox-html')
    expect(INDEX_SOURCE).toContain("cls('uid-asset-lightbox-canvas', htmlMode && 'uid-preview-stage')")
    expect(INDEX_SOURCE).toContain('.uid-asset-lightbox-html .uid-asset-lightbox-canvas')
    expect(INDEX_SOURCE).toContain('.uid-preview-stage .uid-clib-segment span')
    expect(INDEX_SOURCE).toContain('.uid-preview-stage .uid-clib-pager button')
    expect(INDEX_SOURCE).toContain('.uid-preview-stage .uid-clib-notify-preview .uid-clib-notice.prompt button')
    expect(INDEX_SOURCE).not.toContain('transform: scale(1.18)')
  })

  it('放大预览支持在同一组素材内左右切换，无需反复关闭重开', () => {
    expect(INDEX_SOURCE).toContain('private buildAssetLightboxGallery()')
    expect(INDEX_SOURCE).toContain('private buildSectionLightboxGallery()')
    expect(INDEX_SOURCE).toContain('private stepComponentAssetLightbox(delta: -1 | 1)')
    expect(INDEX_SOURCE).toContain('data-uid-action="prev-component-asset-view"')
    expect(INDEX_SOURCE).toContain('data-uid-action="next-component-asset-view"')
    expect(INDEX_SOURCE).toContain("event.key === 'ArrowLeft'")
    expect(INDEX_SOURCE).toContain("event.key === 'ArrowRight'")
    expect(INDEX_SOURCE).toContain('uid-asset-lightbox-counter')
  })

  it('已有组件后重新生成必须强制启动流程，并先保留当前结果到历史记录', () => {
    expect(INDEX_SOURCE).toContain('private preserveCurrentComponentPack(): void')
    expect(INDEX_SOURCE).toContain('this.preserveCurrentComponentPack()')
    expect(INDEX_SOURCE).not.toContain('await this.preserveCurrentComponentPack()')
    expect(INDEX_SOURCE).toContain('private async restartComponentGeneration()')
    expect(INDEX_SOURCE).toContain('void this.restartComponentGeneration()')
    expect(INDEX_SOURCE).toContain('compactAssetHistoryForStorage')
    expect(INDEX_SOURCE).toContain('liveAssets: this.getLivePreviewAssets()')
    expect(INDEX_SOURCE).toContain('this.renderHistoryPreviewMarkup(item.preview ?? item.assets)')
  })

  it('编辑微调提示词不能直接清空当前 liveAssets，否则旧结果无法归档', () => {
    const invalidateStart = INDEX_SOURCE.indexOf('private invalidateComponentVisualCache(): void')
    const invalidateEnd = INDEX_SOURCE.indexOf('private resetGeneratedWorkflowRuntime(): void')
    const invalidateBody = INDEX_SOURCE.slice(invalidateStart, invalidateEnd)
    expect(invalidateBody).not.toContain('this.liveAssets = { icons: [] }')
  })

  it('服务端素材提示词复用 genre kit，避免只生成通用组件皮肤', () => {
    expect(API_PLUGIN_SOURCE).toContain('GENRE_COMPONENT_KITS')
    expect(API_PLUGIN_SOURCE).toContain('getGenreComponentKit')
    expect(API_PLUGIN_SOURCE).toContain('GENRE COMPONENT LANGUAGE')
    expect(API_PLUGIN_SOURCE).toContain('Do not produce generic Web UI')
  })

  it('切换游戏类型必须重置后续生成流程，不能沿用上一个类型的素材记录', () => {
    expect(INDEX_SOURCE).toContain('resetGeneratedWorkflowRuntime()')
    expect(INDEX_SOURCE).toContain('assetHistory: []')
    expect(INDEX_SOURCE).toContain('lockedAssetKinds: []')
    expect(INDEX_SOURCE).toContain("compareHistoryPackId: ''")
    expect(INDEX_SOURCE).toContain("confirmedStylePackId: ''")
    expect(INDEX_SOURCE).toContain("assetPromptNotes: ''")
  })

  it('sceneSuggestions 对未匹配 style 时仍会返回 default 场景', () => {
    const list = sceneSuggestions('open-world', 'modern-dark')
    expect(list.length).toBeGreaterThan(0)
  })

  it('风格拆解预览必须覆盖开始/游玩/菜单/结算四段流程', () => {
    const screens = getStyleBoardPreviewScreens('open-world')
    expect(screens.map(screen => screen.screen)).toEqual(['start', 'hud', 'bag', 'results'])
  })

  it('FPS 风格拆解预览会优先展示武器选择而不是背包类菜单', () => {
    const screens = getStyleBoardPreviewScreens('fps')
    expect(screens.map(screen => screen.screen)).toEqual(['start', 'hud', 'weapon-select', 'results'])
  })

  it('组件核验步骤必须覆盖链路、清理、尺寸压缩与预览验收', () => {
    const ids = COMPONENT_VERIFICATION_STEPS.map(step => step.id)
    expect(ids).toEqual(['chain', 'purity', 'consistency', 'size-compression', 'preview'])
    expect(COMPONENT_VERIFICATION_STEPS[0]?.label).toContain('链路')
    expect(COMPONENT_VERIFICATION_STEPS[3]?.items).toEqual(expect.arrayContaining(['统一尺寸', '压缩完成']))
  })
})

// ────── PC 布局规则（PDF 第四步） ────────────────────────────────────
describe('PC_LAYOUT_RULES', () => {
  it('基准分辨率为 1920x1080', () => {
    expect(PC_LAYOUT_RULES.designWidth).toBe(1920)
    expect(PC_LAYOUT_RULES.designHeight).toBe(1080)
  })

  it('最低兼容分辨率为 1280x720', () => {
    expect(PC_LAYOUT_RULES.minWidth).toBe(1280)
    expect(PC_LAYOUT_RULES.minHeight).toBe(720)
  })

  it('安全边距 >= 24px，重要信息边距 >= 40px', () => {
    expect(PC_LAYOUT_RULES.safeMargin).toBeGreaterThanOrEqual(24)
    expect(PC_LAYOUT_RULES.importantMargin).toBeGreaterThanOrEqual(40)
  })

  it('鼠标最小热区 >= 32px，高频操作 >= 48px', () => {
    expect(PC_LAYOUT_RULES.minClickTarget).toBeGreaterThanOrEqual(32)
    expect(PC_LAYOUT_RULES.freqClickTarget).toBeGreaterThanOrEqual(48)
  })

  it('顶栏 <= 64px，底栏 <= 80px', () => {
    expect(PC_LAYOUT_RULES.maxTopbarHeight).toBeLessThanOrEqual(64)
    expect(PC_LAYOUT_RULES.maxBottombarHeight).toBeLessThanOrEqual(80)
  })

  it('侧栏宽度在 240-320px 范围内', () => {
    expect(PC_LAYOUT_RULES.sidebarMinWidth).toBeGreaterThanOrEqual(240)
    expect(PC_LAYOUT_RULES.sidebarMaxWidth).toBeLessThanOrEqual(320)
  })
})

// ────── 冲突检测（PDF AI冲突检测规则） ───────────────────────────────
describe('detectConflicts — enhanced', () => {
  it('三消选了写实军事风格，触发"风格冲突"警告', () => {
    const state = hydrateState({ genrePreset: 'puzzle', style: 'realistic-military' })
    const conflicts = detectConflicts(state)
    expect(conflicts.some(c => c.type === 'style-mismatch')).toBe(true)
  })

  it('有道具栏但没有货币系统，触发"依赖缺失"警告', () => {
    const state = hydrateState({
      genrePreset: 'puzzle',
      selectedFeatures: ['item-slot'],
    })
    const conflicts = detectConflicts(state)
    expect(conflicts.some(c => c.type === 'dependency-missing')).toBe(true)
  })

  it('"剩余步数"和"无限步数模式"同时选中，触发"互斥模块"警告', () => {
    const state = hydrateState({
      genrePreset: 'puzzle',
      selectedFeatures: ['step-counter', 'endless-mode'],
    })
    const conflicts = detectConflicts(state)
    expect(conflicts.some(c => c.type === 'mutual-exclusive')).toBe(true)
  })

  it('三消加了科技树，触发"体量不匹配"警告', () => {
    const state = hydrateState({
      genrePreset: 'puzzle',
      selectedFeatures: ['tech-tree'],
    })
    const conflicts = detectConflicts(state)
    expect(conflicts.some(c => c.type === 'scope-mismatch')).toBe(true)
  })

  it('无冲突时返回空数组', () => {
    const state = createDefaultState()
    const conflicts = detectConflicts(state)
    // open-world 默认配置不应触发冲突
    const hard = conflicts.filter(c => c.severity === 'error')
    expect(hard).toHaveLength(0)
  })
})

// ────── 第二步布局模块 → 第三步组件生成联调 ───────────────────────────
describe('layout modules drive component generation', () => {
  it('三消选中棋盘/得分/货币后，会生成图标步骤且图标主题来自模块标签', () => {
    const selected = ['game-board', 'score-display', 'currency', 'level-counter']
    const specs = buildModuleAssetSpecs('puzzle', selected)
    const steps = buildComponentLibrarySteps('puzzle', selected)
    expect(steps.some(step => step.kind === 'icons')).toBe(true)
    expect(iconLabelsFromModuleSpecs(specs)).toEqual(expect.arrayContaining(['游戏棋盘', '当前得分', '货币显示']))
    expect(resolveIconSlotCount(specs)).toBeGreaterThanOrEqual(4)
  })

  it('FPS 选中商店/背包后，会包含按钮与面板步骤', () => {
    const selected = ['shop-panel', 'inventory-grid', 'currency', 'pause-menu']
    const steps = buildComponentLibrarySteps('fps', selected)
    expect(steps.map(step => step.kind)).toEqual(expect.arrayContaining(['buttonPrimary', 'buttonNormal', 'panelTexture']))
  })

  it('动态风格板分区只展示第二步已选模块对应的 8 类组件', () => {
    const selected = ['quest-tracker', 'shop-panel', 'health-status']
    const active = getActiveStyleBoardSectionIds('action-rpg', selected)
    expect(active).toEqual(expect.arrayContaining(['bars', 'lists', 'cards']))
    const sections = resolveStyleBoardSectionsForLayout('action-rpg', selected)
    const lists = sections.find(section => section.id === 'lists')
    expect(lists?.items.includes('任务追踪')).toBe(true)
    expect(lists?.moduleIds).toContain('quest-tracker')
    expect(sections.some(section => section.id === 'cards' && section.items.includes('商店面板'))).toBe(true)
  })

  it('chrome 组件素材以受控并发单独请求，功能图标按槽位并行拉取', () => {
    expect(INDEX_SOURCE).toContain('PARALLEL_CHROME_ASSET_KINDS')
    expect(INDEX_SOURCE).toContain('CHROME_GENERATION_CONCURRENCY')
    expect(INDEX_SOURCE).toContain('ICON_GENERATION_CONCURRENCY')
    expect(INDEX_SOURCE).toContain('runAssetKindTasksWithConcurrency')
    expect(INDEX_SOURCE).toContain('runIconSlotsWithConcurrency')
    expect(INDEX_SOURCE).toContain('iconIndex')
    expect(INDEX_SOURCE).toContain('parseGenerateAssetsResponse')
    expect(INDEX_SOURCE).not.toContain('fetchComponentAssetKinds')
    expect(INDEX_SOURCE).toMatch(/remainingSteps[\s\S]*runIconSlotsWithConcurrency/)
    expect(INDEX_SOURCE).toContain('getComponentGenerationUnitTotal')
    expect(INDEX_SOURCE).toContain('completedUnits')
    expect(INDEX_SOURCE).toContain('formatProgressPercentLabel')
    expect(INDEX_SOURCE).toContain('displayProgressPercent(fromPct + (capPct - fromPct) * eased)')
    expect(INDEX_SOURCE).not.toContain('floorPct')
    expect(INDEX_SOURCE).not.toContain('chromePulseIndex')
  })
})

// ────── 蓝图生成（兼容旧测试） ────────────────────────────────────────
describe('buildBlueprint — stage essentials preserved', () => {
  it('injects stage essentials into the generated blueprint', () => {
    const state = hydrateState({ genrePreset: 'action-rpg', stage: 'combat' })
    const essentials = stageEssentialFeatures(state.stage)
    const blueprint = buildBlueprint(state)
    expect(essentials).toEqual(expect.arrayContaining(['health-status', 'skill-bar', 'quest-tracker']))
    expect(blueprint.features).toEqual(expect.arrayContaining(essentials))
    expect(blueprint.summary).toContain('动作角色扮演')
  })
})
