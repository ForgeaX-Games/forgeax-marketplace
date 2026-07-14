import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { useSceneImageCache } from '../../media/sceneImageCache'
import { createImageProvider } from '../../llm/providers/GptImageProvider'
import type { ImageClient } from '../../llm/config/types'
import { getAuthoringHint } from '../../llm/config/visualStylePresets'
import type {
  TreeJumpScope,
  TreeNavMode,
  TreeThemePreset,
  UIAssetRole,
} from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'
import { makeUIAsset, generateUIAsset } from './uiAssetArt'
import {
  TREE_THEME_PRESETS,
  makeTreeThemeForPreset,
  treeBackgroundPrompt,
  treeNodeFramePrompt,
} from './treeThemePresets'
import { BranchTreeReadonly } from '../../player/BranchTreeReadonly'

/**
 * TreeThemeEditor —— 游戏内剧情树 per-scenario 主题 + 章节/关卡选择导航配置(v10)。
 *
 * 左栏:预设 + 背景/节点框生成(走 UI 部件管线) + 连线/方向/缩略图/导航/跳转范围。
 * 右栏:实时预览 —— 直接内嵌 player 的 BranchTreeReadonly(读同一 scenario.treeTheme),
 *      作者所见即玩家所得。
 */

const PRESET_OPTIONS: { id: TreeThemePreset; label: string }[] = [
  { id: 'default', label: TREE_THEME_PRESETS.default.label },
  { id: 'chinese', label: TREE_THEME_PRESETS.chinese.label },
  { id: 'cartoon', label: TREE_THEME_PRESETS.cartoon.label },
  { id: 'scifi', label: TREE_THEME_PRESETS.scifi.label },
  { id: 'custom', label: '自定义' },
]

const NAV_LABELS: Record<TreeNavMode, string> = {
  map: '自由地图',
  linear: '线性关卡(预留)',
}

const JUMP_LABELS: Record<TreeJumpScope, string> = {
  none: '只读(不可跳)',
  visited: '已访问 + 可达分支',
  all: '任意节点自由跳',
}

export function TreeThemeEditor() {
  const scenario = useScenarioStore((s) => s.scenario)
  const theme = scenario.treeTheme
  const setTreeTheme = useScenarioStore((s) => s.setTreeTheme)
  const updateTreeTheme = useScenarioStore((s) => s.updateTreeTheme)
  const upsertUIAsset = useScenarioStore((s) => s.upsertUIAsset)
  const updateUIAsset = useScenarioStore((s) => s.updateUIAsset)
  const uiAssets = scenario.uiAssets

  const synopsis = scenario.synopsis
  const visualStyle = scenario.visualStyle
  const filmLook = scenario.filmLook
  const uiStylePrompt = scenario.uiStyle?.prompt

  const client = useMemo<ImageClient>(() => createImageProvider(), [])
  const [busy, setBusy] = useState<null | 'bg' | 'frame'>(null)
  const [err, setErr] = useState<string | null>(null)

  // 预览用:打开时把磁盘缓存缩略图灌进 sceneImageCache(不发网络请求)。
  useEffect(() => {
    const loader = useSceneImageCache.getState().loadFromDisk
    for (const id of Object.keys(scenario.scenes)) loader(id)
  }, [scenario.scenes])

  const bgAsset = theme?.backgroundAssetId ? uiAssets?.[theme.backgroundAssetId] : undefined
  const frameAsset = theme?.nodeFrameAssetId ? uiAssets?.[theme.nodeFrameAssetId] : undefined
  const bgUrl = useMediaStore((s) => (bgAsset?.mediaId ? s.entries[bgAsset.mediaId]?.url : undefined))
  const frameUrl = useMediaStore((s) =>
    frameAsset?.mediaId ? s.entries[frameAsset.mediaId]?.url : undefined,
  )

  const previewScene = scenario.rootSceneId

  async function genPart(kind: 'bg' | 'frame'): Promise<void> {
    const preset = theme?.preset ?? 'default'
    const role: UIAssetRole = kind === 'bg' ? 'tree-background' : 'tree-node-frame'
    const prompt = kind === 'bg' ? treeBackgroundPrompt(preset) : treeNodeFramePrompt(preset)
    const field = kind === 'bg' ? 'backgroundAssetId' : 'nodeFrameAssetId'
    setBusy(kind)
    setErr(null)
    try {
      // 复用已有 asset id(重生)或新建。
      const existingId = kind === 'bg' ? theme?.backgroundAssetId : theme?.nodeFrameAssetId
      const id = existingId ?? `ui_tree_${kind}_${Date.now().toString(36)}`
      const asset = makeUIAsset({
        id,
        role,
        name: kind === 'bg' ? '剧情树背景' : '剧情树节点框',
        prompt,
      })
      upsertUIAsset(asset)
      const { mediaId, effectiveMatte, effectiveBlendMode } = await generateUIAsset({
        asset,
        client,
        ctx: {
          worldSynopsis: synopsis,
          styleHint: getAuthoringHint(visualStyle, filmLook) || undefined,
          uiStylePrompt,
        },
      })
      updateUIAsset(id, { mediaId, matte: effectiveMatte, blendMode: effectiveBlendMode })
      updateTreeTheme({ [field]: id })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(null)
    }
  }

  function pickExisting(kind: 'bg' | 'frame', assetId: string): void {
    const field = kind === 'bg' ? 'backgroundAssetId' : 'nodeFrameAssetId'
    updateTreeTheme({ [field]: assetId || undefined })
  }

  const bgChoices = useMemo(
    () => Object.values(uiAssets ?? {}).filter((a) => a.role === 'tree-background' && a.mediaId),
    [uiAssets],
  )
  const frameChoices = useMemo(
    () => Object.values(uiAssets ?? {}).filter((a) => a.role === 'tree-node-frame' && a.mediaId),
    [uiAssets],
  )

  if (!theme) {
    return (
      <div className="ks-treeth-root">
        <div className="ks-treeth-empty">
          <div className="ks-treeth-empty-title">游戏内剧情树主题</div>
          <p className="ks-treeth-empty-desc">
            默认玩家看到的剧情树用内置深色样式。启用后可按剧本定制节点框 / 背景 /
            连线风格(中式 / 卡通 / 科幻),并把它变成「章节 / 关卡选择」式可玩导航页。
          </p>
          <button
            type="button"
            className="ks-treeth-enable"
            onClick={() => setTreeTheme(makeTreeThemeForPreset('default'))}
          >
            启用自定义主题
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ks-treeth-root">
      <aside className="ks-treeth-panel">
        <div className="ks-treeth-panel-head">
          <span>剧情树主题</span>
          <button
            type="button"
            className="ks-treeth-clear"
            onClick={() => setTreeTheme(undefined)}
            title="清除主题,恢复内置样式"
          >
            恢复默认
          </button>
        </div>

        <label className="ks-treeth-field">
          <span>风格预设</span>
          <select
            value={theme.preset}
            onChange={(e) =>
              setTreeTheme(makeTreeThemeForPreset(e.target.value as TreeThemePreset, theme))
            }
          >
            {PRESET_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {/* 背景图 */}
        <div className="ks-treeth-asset">
          <div className="ks-treeth-asset-head">
            <span>全屏背景</span>
            <button type="button" onClick={() => genPart('bg')} disabled={busy !== null}>
              {busy === 'bg' ? '生成中…' : bgAsset ? '重生' : '生成'}
            </button>
          </div>
          <div className="ks-treeth-thumb">
            {bgUrl ? <img src={bgUrl} alt="剧情树背景" /> : <span className="ks-treeth-noimg">未生成</span>}
          </div>
          {bgChoices.length > 0 && (
            <select
              className="ks-treeth-pick"
              value={theme.backgroundAssetId ?? ''}
              onChange={(e) => pickExisting('bg', e.target.value)}
            >
              <option value="">— 选择已有背景部件 —</option>
              {bgChoices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 节点框 */}
        <div className="ks-treeth-asset">
          <div className="ks-treeth-asset-head">
            <span>节点框</span>
            <button type="button" onClick={() => genPart('frame')} disabled={busy !== null}>
              {busy === 'frame' ? '生成中…' : frameAsset ? '重生' : '生成'}
            </button>
          </div>
          <div className="ks-treeth-thumb ks-treeth-thumb-frame">
            {frameUrl ? (
              <img src={frameUrl} alt="剧情树节点框" />
            ) : (
              <span className="ks-treeth-noimg">未生成</span>
            )}
          </div>
          {frameChoices.length > 0 && (
            <select
              className="ks-treeth-pick"
              value={theme.nodeFrameAssetId ?? ''}
              onChange={(e) => pickExisting('frame', e.target.value)}
            >
              <option value="">— 选择已有节点框部件 —</option>
              {frameChoices.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {err && <div className="ks-treeth-err">{err}</div>}

        {/* 连线 */}
        <div className="ks-treeth-field-row">
          <label className="ks-treeth-field ks-treeth-field-sm">
            <span>连线色</span>
            <input
              type="color"
              value={theme.edge?.color ?? '#ffb347'}
              onChange={(e) => updateTreeTheme({ edge: { ...theme.edge, color: e.target.value } })}
            />
          </label>
          <label className="ks-treeth-field ks-treeth-field-sm">
            <span>线宽</span>
            <input
              type="number"
              min={1}
              max={8}
              step={0.2}
              value={theme.edge?.width ?? 2.2}
              onChange={(e) =>
                updateTreeTheme({ edge: { ...theme.edge, width: Number(e.target.value) } })
              }
            />
          </label>
          <label className="ks-treeth-check">
            <input
              type="checkbox"
              checked={theme.edge?.dashed ?? false}
              onChange={(e) => updateTreeTheme({ edge: { ...theme.edge, dashed: e.target.checked } })}
            />
            <span>虚线</span>
          </label>
        </div>

        {/* 布局方向 + 缩略图 */}
        <div className="ks-treeth-field-row">
          <label className="ks-treeth-field ks-treeth-field-sm">
            <span>方向</span>
            <select
              value={theme.direction ?? 'TB'}
              onChange={(e) => updateTreeTheme({ direction: e.target.value as 'TB' | 'LR' })}
            >
              <option value="TB">自上而下</option>
              <option value="LR">自左向右</option>
            </select>
          </label>
          <label className="ks-treeth-check">
            <input
              type="checkbox"
              checked={theme.showThumbnails ?? true}
              onChange={(e) => updateTreeTheme({ showThumbnails: e.target.checked })}
            />
            <span>显示缩略图</span>
          </label>
        </div>

        {/* 导航 + 跳转范围 */}
        <label className="ks-treeth-field">
          <span>导航模式</span>
          <select
            value={theme.navMode ?? 'map'}
            onChange={(e) => updateTreeTheme({ navMode: e.target.value as TreeNavMode })}
          >
            {(Object.keys(NAV_LABELS) as TreeNavMode[]).map((k) => (
              <option key={k} value={k}>
                {NAV_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="ks-treeth-field">
          <span>玩家可跳转范围</span>
          <select
            value={theme.jumpScope ?? 'visited'}
            onChange={(e) => updateTreeTheme({ jumpScope: e.target.value as TreeJumpScope })}
          >
            {(Object.keys(JUMP_LABELS) as TreeJumpScope[]).map((k) => (
              <option key={k} value={k}>
                {JUMP_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="ks-treeth-field">
          <span>关卡选择页标题</span>
          <input
            type="text"
            value={theme.title ?? ''}
            placeholder={scenario.title || '(默认用剧本名)'}
            onChange={(e) => updateTreeTheme({ title: e.target.value || undefined })}
          />
        </label>
      </aside>

      <div className="ks-treeth-preview">
        <div className="ks-treeth-preview-label">实时预览 · 玩家所见</div>
        <div className="ks-treeth-preview-stage">
          <BranchTreeReadonly
            currentSceneId={previewScene}
            visitedSceneIds={[previewScene]}
            onJump={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

const css = `
.ks-treeth-root { display: flex; width: 100%; height: 100%; min-height: 0; }
.ks-treeth-panel {
  flex: 0 0 320px; overflow-y: auto; padding: 14px 16px;
  border-right: 1px solid var(--color-border-default); display: flex; flex-direction: column; gap: 14px;
}
.ks-treeth-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; font-weight: 600; color: var(--color-text-primary);
}
.ks-treeth-clear, .ks-treeth-enable {
  font-size: 11.5px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  border: 1px solid var(--color-border-subtle); background: transparent; color: var(--color-text-secondary);
}
.ks-treeth-clear:hover { color: var(--color-text-primary); border-color: var(--color-border-default); }
.ks-treeth-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--color-text-secondary); }
.ks-treeth-field select, .ks-treeth-field input[type=text], .ks-treeth-field input[type=number] {
  padding: 6px 8px; border-radius: 8px; border: 1px solid var(--color-border-subtle);
  background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12.5px;
}
.ks-treeth-field-row { display: flex; align-items: flex-end; gap: 10px; }
.ks-treeth-field-sm { flex: 1 1 0; }
.ks-treeth-field-sm input[type=color] { width: 100%; height: 30px; padding: 0; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: transparent; }
.ks-treeth-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; padding-bottom: 6px; }
.ks-treeth-asset { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--color-border-subtle); border-radius: 10px; }
.ks-treeth-asset-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.ks-treeth-asset-head button {
  font-size: 11.5px; padding: 4px 12px; border-radius: 999px; cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent); color: var(--color-brand-primary);
}
.ks-treeth-asset-head button:disabled { opacity: 0.5; cursor: default; }
.ks-treeth-thumb {
  width: 100%; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%) 0 / 16px 16px, #111;
}
.ks-treeth-thumb-frame { aspect-ratio: 1 / 1; max-height: 130px; }
.ks-treeth-thumb img { width: 100%; height: 100%; object-fit: contain; }
.ks-treeth-noimg { font-size: 11px; color: var(--color-text-tertiary); }
.ks-treeth-pick { padding: 5px 8px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12px; }
.ks-treeth-err { font-size: 12px; color: var(--color-status-error, #f87171); }
.ks-treeth-empty { max-width: 460px; margin: 48px auto; text-align: center; display: flex; flex-direction: column; gap: 14px; align-items: center; }
.ks-treeth-empty-title { font-size: 16px; font-weight: 700; color: var(--color-text-primary); }
.ks-treeth-empty-desc { font-size: 13px; line-height: 1.7; color: var(--color-text-secondary); }
.ks-treeth-enable {
  padding: 8px 20px; font-size: 13px; font-weight: 600;
  color: var(--color-brand-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
}
.ks-treeth-preview { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.ks-treeth-preview-label { flex: 0 0 auto; padding: 8px 14px; font-size: 11.5px; letter-spacing: 0.06em; color: var(--color-text-tertiary); border-bottom: 1px solid var(--color-border-default); }
.ks-treeth-preview-stage { flex: 1 1 0; min-height: 0; position: relative; background: #05070c; }
`
injectStyleOnce('tree-theme-editor', css)
