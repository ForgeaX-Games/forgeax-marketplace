import { useEffect, useMemo, useState } from 'react'
import type { GameGraph, GameNode, GameScenario } from '../../runtime/schema/graph-schema'
import type { MediaAsset, StyleAxes } from '../assets/registry-types'
import {
  getGameStyleAxes,
  importCharacterRefs,
  importSceneRefs,
  listRegistryAssets,
  requestGenerateKeyframe,
  requestGenerateVideo,
  setGameStyleAxes,
} from './media'
import { bindVideoGraph, setNodePromptGraph } from '../video/graphMaterialOps'
import { GraphVideoGenerationPanel } from './GraphVideoGenerationPanel'
import { injectStyleOnce } from '../../styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import { GRAPH_VIDEO_VIEW_CSS } from './graphVideoViewStyles'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { buildNodeReferencePill } from './node-agent-context'

interface NodeAgentVideoActionsProps {
  game: string
  blueprintId: string
  blueprintTitle?: string
  graphPath: Array<{ id: string; name: string }>
  graph: GameGraph
  scenario: GameScenario
  node: GameNode
  videoGenerationEnabled: boolean
  onEditScenario: (edit: (scenario: GameScenario, node: GameNode) => GameScenario) => void
}

const ACTIONS_CSS = `
.gv-node-actions{--gc-panel:#1b1713;--gc-panel2:#252019;--gc-line:#403830;--gc-line-soft:#2e2924;--gc-text:#f6f1e9;--gc-muted:#b8aea0;--gc-faint:#8c8377;--gc-accent:#f08840;--gc-accent-soft:rgba(240,136,64,.16);--gc-accent-line:rgba(240,136,64,.42);flex:none;border-bottom:1px solid #2e2924;background:#171411}
.gv-node-actions-bar{display:flex;align-items:center;gap:6px;padding:6px}
.gv-node-actions-bar button{border:1px solid #403830;border-radius:7px;background:#252019;color:#f6f1e9;padding:5px 8px;font-size:11px;cursor:pointer}
.gv-node-actions-bar button:hover{border-color:#f08840;background:#2f2923}
.gv-node-actions-bar button.is-on{border-color:#f08840;color:#f5bd75}
.gv-node-actions-bar button:disabled{opacity:.45;cursor:default}
.gv-node-actions-status{min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9aa2b1;font-size:10px}
.gv-node-actions-status.is-error{color:#ff8f8f}
.gv-node-generation{box-sizing:border-box;max-height:min(52vh,560px);padding:8px;overflow:auto;background:#1b1713;color:#f6f1e9}
.gv-node-generation .gvv-config-panels{overflow:visible}
.gv-node-generation-notice{display:block;margin-top:7px;color:#7ed6a5;font-size:11px}
`

export function NodeAgentVideoActions({
  game,
  blueprintId,
  blueprintTitle,
  graphPath,
  graph,
  scenario,
  node,
  videoGenerationEnabled,
  onEditScenario,
}: NodeAgentVideoActionsProps): JSX.Element {
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  injectStyleOnce('graph-video-view', GRAPH_VIDEO_VIEW_CSS)
  injectStyleOnce('node-agent-video-actions', ACTIONS_CSS)

  const [generationOpen, setGenerationOpen] = useState(false)
  const [registryAssets, setRegistryAssets] = useState<MediaAsset[]>([])
  const [styleAxes, setStyleAxes] = useState<StyleAxes>({})
  const [generationBusy, setGenerationBusy] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generationNotice, setGenerationNotice] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<{ text: string; error: boolean } | null>(null)

  const characterRefs = useMemo(
    () => registryAssets.filter((asset) => asset.productionType === 'character_ref'),
    [registryAssets],
  )
  const sceneRefs = useMemo(
    () => registryAssets.filter((asset) => asset.productionType === 'scene_ref'),
    [registryAssets],
  )

  async function refreshAssets(): Promise<void> {
    setRegistryAssets(await listRegistryAssets(game))
  }

  useEffect(() => {
    if (!generationOpen) return
    let alive = true
    void Promise.all([listRegistryAssets(game), getGameStyleAxes(game)]).then(([assets, axes]) => {
      if (!alive) return
      setRegistryAssets(assets)
      if (axes) setStyleAxes(axes)
    })
    return () => { alive = false }
  }, [game, generationOpen])

  useEffect(() => {
    setGenerationError(null)
    setGenerationNotice(null)
    setAgentStatus(null)
  }, [node.id])

  useEffect(() => {
    if (!videoGenerationEnabled) setGenerationOpen(false)
  }, [videoGenerationEnabled])

  function referenceNode(): void {
    if (!forgeaxHost.available) {
      setAgentStatus({ text: '请在 Studio 中打开后使用侧边 Chat', error: true })
      return
    }
    forgeaxHost.composer.insert(buildNodeReferencePill({
      gameId: game,
      blueprintId,
      blueprintTitle,
      graphPath,
      graph,
      node,
      scenario,
    }))
    setAgentStatus({ text: '已引用到侧边 Chat，可继续输入调整指令', error: false })
  }

  function updateStyleAxis(axis: keyof StyleAxes, value: string): void {
    const next: StyleAxes = { ...styleAxes, [axis]: value || undefined }
    setStyleAxes(next)
    void setGameStyleAxes(game, { [axis]: value || undefined } as StyleAxes).then((saved) => {
      if (!saved) setGenerationError('风格设置保存失败')
    })
  }

  async function importRefs(kind: 'character' | 'scene'): Promise<void> {
    setGenerationError(null)
    setGenerationNotice(null)
    const result = kind === 'character'
      ? await importCharacterRefs(game)
      : await importSceneRefs(game)
    if (result.error && result.refs.length === 0) {
      setGenerationError(`导入${kind === 'character' ? '角色' : '场景'}参考图失败：${result.error}`)
    }
    await refreshAssets()
  }

  async function generateVideo(): Promise<void> {
    if (generationBusy) return
    setGenerationError(null)
    setGenerationNotice(null)
    if (characterRefs.length === 0 || sceneRefs.length === 0) {
      setGenerationError('缺参考图：需至少 1 张角色参考图和 1 张场景参考图。')
      return
    }
    setGenerationBusy(true)
    try {
      const result = await requestGenerateVideo(game, {
        sceneNodeId: node.id,
        nodeName: node.data.name || node.id,
        storyText: node.data.media?.prompt ?? node.data.name ?? '',
        durationSeconds: Math.min(15, Math.max(4, Math.round((node.data.durationMs ?? 8_000) / 1_000))),
        characterRefIds: characterRefs.map((asset) => asset.id),
        sceneRefIds: sceneRefs.map((asset) => asset.id),
        label: `视频 · ${node.data.name || node.id}`,
        styleAxes,
      })
      if (result.error || !result.asset) {
        setGenerationError(result.error ?? '视频生成失败')
        return
      }
      const asset = result.asset
      onEditScenario((current, currentNode) => bindVideoGraph(current, currentNode, asset.id, asset.durationMs))
      await refreshAssets()
      setGenerationNotice(`已生成并绑定：${asset.label ?? asset.id}`)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '视频生成失败')
    } finally {
      setGenerationBusy(false)
    }
  }

  async function generateStoryboard(): Promise<void> {
    if (generationBusy) return
    setGenerationError(null)
    setGenerationNotice(null)
    setGenerationBusy(true)
    try {
      const result = await requestGenerateKeyframe(game, {
        sceneNodeId: node.id,
        nodeName: node.data.name || node.id,
        beat: node.data.media?.prompt ?? node.data.name ?? '',
        refAssetIds: [...characterRefs, ...sceneRefs].map((asset) => asset.id),
        label: `分镜故事板 · ${node.data.name || node.id}`,
        styleAxes,
        mode: 'grid_storyboard',
      })
      if (result.error || !result.asset) {
        setGenerationError(result.error ?? '故事板生成失败')
        return
      }
      await refreshAssets()
      setGenerationNotice(`故事板已生成：${result.asset.label ?? result.asset.id}`)
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : '故事板生成失败')
    } finally {
      setGenerationBusy(false)
    }
  }

  return (
    <div className="gv-node-actions">
      <div className="gv-node-actions-bar">
        <button type="button" onClick={referenceNode} title="把当前节点引用插入 Studio 侧边 Chat 输入区">
          🔗 引用
        </button>
        <button
          type="button"
          className={generationOpen ? 'is-on' : undefined}
          aria-expanded={generationOpen}
          disabled={!videoGenerationEnabled}
          onClick={() => setGenerationOpen((open) => !open)}
          title={videoGenerationEnabled ? '为当前蓝图节点生成视频并自动绑定' : '子流程容器不承载演出视频'}
        >
          🎬 生成视频
        </button>
        {agentStatus ? (
          <span className={`gv-node-actions-status${agentStatus.error ? ' is-error' : ''}`} title={agentStatus.text}>
            {agentStatus.text}
          </span>
        ) : null}
      </div>
      {generationOpen ? (
        <div className="gv-node-generation">
          <GraphVideoGenerationPanel
            game={game}
            enabled={videoGenerationEnabled}
            prompt={node.data.media?.prompt ?? ''}
            styleAxes={styleAxes}
            characterRefs={characterRefs}
            sceneRefs={sceneRefs}
            generationBusy={generationBusy}
            generationError={generationError}
            onPromptChange={(prompt) => onEditScenario((current, currentNode) => setNodePromptGraph(current, currentNode, prompt))}
            onStyleAxisChange={updateStyleAxis}
            onImportRefs={importRefs}
            onAssetsChanged={refreshAssets}
            onAssetDeleted={(assetId) => setRegistryAssets((assets) => assets.filter((asset) => asset.id !== assetId))}
            onGenerateVideo={generateVideo}
            onGenerateStoryboard={generateStoryboard}
          />
          {generationNotice ? <span className="gv-node-generation-notice">{generationNotice}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
