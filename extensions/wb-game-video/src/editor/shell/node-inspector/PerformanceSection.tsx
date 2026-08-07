/**
 * 演出分区 —— 吸顶操作条 + 可编辑节点标题 + 视频 / 播放模式 / 嵌套 / 子流程入口 / 子蓝图包。
 * 视觉取自 Figma 15635:83251（Frame 2147231119），控件写图的入口与迁出前完全一致。
 */
import type { GameGraph, GameNode, GameNodeData, SubFlowPack, SubFlowPackDef, SubProcess } from '../../../runtime/schema/graph-schema'
import { authoringOptionLabel } from '../../authoring-option-label'
import { removeNode, type NodeDataPatch } from '../../../graph/edit/graph-edit'
import { injectStyleOnce } from '../../../styles/injectStyle'
import { NiAddButton, NiField, NiIcon, NiPillButton, NiSegmented, NiSelect } from '../ni-ui'
import type { VideoOption } from './shared'

const PERF_CSS = `
/* 稿子把操作条画在分区内，但它必须留在 .ni-root 直下：sticky 的定位上界是父盒，
   放进分区就只能吸到分区底部，滚过演出区就掉了。分区改为 padding-top: 0，由操作条
   自己出 16px 顶距和 12px 底距，像素与稿子的单个 16px 内边距框一致。 */
.ni-root .ni-section.ni-perf { gap: 12px; padding-top: 0; }

/* 配置项很长，滚到底部时仍要能点「从此试玩」/「删除节点」；吸顶时要盖住下方滚过的
   内容，故需不透明底色。 */
.ni-root .ni-perf-actions {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: var(--ni-section-pad) var(--ni-section-pad) 12px;
  background: var(--ni-panel);
  border-bottom: 1px solid var(--ni-w-10);
}

/* 节点标题：橙条 + 直接可编辑的名称 + 铅笔提示。 */
.ni-root .ni-perf-title {
  display: flex;
  align-items: center;
  gap: 7.331px;
  width: 100%;
  min-width: 0;
}
.ni-root .ni-perf-title::before {
  content: '';
  flex: none;
  width: 2.749px;
  height: 10.996px;
  border-radius: 1.833px;
  background: var(--ni-accent);
}
/*
 * 铅笔要紧贴名字右侧（稿子 15635:83268 就跟在文本块后面），所以输入框得按内容自适应宽度，
 * 不能 flex:1 撑满。用「inline-grid + ::after 镜像同一段文字」把宽度撑到文字宽度，
 * 纯 CSS、不用测量；名字过长时 max-width 封顶、输入框内部滚动。
 */
.ni-root .ni-perf-title-field {
  display: inline-grid;
  align-items: center;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.ni-root .ni-perf-title-field::after {
  content: attr(data-value);
  grid-area: 1 / 1;
  visibility: hidden;
  white-space: pre;
  font-family: inherit;
  font-size: var(--ni-fs-label);
  line-height: 1.5;
  /* 给光标留一线，否则输到最后一个字时光标被裁掉。 */
  padding-right: 2px;
}
/* 选择器要压过 ni-ui 里那条把 .ni-root 内所有 input 拉成深色输入壳的归一规则。 */
.ni-root .ni-section.ni-perf .ni-perf-title input.ni-perf-title-input {
  grid-area: 1 / 1;
  width: 100%;
  /* size=1 + min-width:0 让 input 的固有宽度不参与网格列定宽，列宽只由 ::after 的镜像文字决定。 */
  min-width: 0;
  height: auto;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  color: var(--ni-w-100);
  font-family: inherit;
  font-size: var(--ni-fs-label);
  line-height: 1.5;
}
.ni-root .ni-section.ni-perf .ni-perf-title input.ni-perf-title-input:focus-visible {
  outline: 1px solid var(--ni-accent);
  outline-offset: 2px;
  border-radius: 2px;
}

.ni-root .ni-perf-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 8px;
  min-width: 0;
}
.ni-root .ni-perf-fields .ni-perf-video-field .ni-field { gap: 6px; }

/* 只读值（子流程入口）：与 NiSelect 同一只壳，靠字色说明它不可编辑。 */
.ni-root .ni-perf-readonly {
  box-sizing: border-box;
  display: block;
  flex: 1;
  min-width: 0;
  height: var(--ni-control-h);
  padding: 5.498px 9.163px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-60);
  line-height: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`

/** 已知时长 → `15s`；未知时不占位（稿子里没有 `--` 之类的空态）。 */
function durationHint(videoOptions: VideoOption[], selectedVideoValue: string): string | null {
  const ms = videoOptions.find((option) => option.id === selectedVideoValue)?.durationMs
  if (ms == null || !Number.isFinite(ms)) return null
  return `${Math.round(ms / 1000)}s`
}

export function PerformanceSection({
  graph,
  node,
  d,
  patchData,
  onChange,
  onJump,
  canConfigurePerformance,
  selectedVideoValue,
  videoOptions,
  nestMode,
  setNestMode,
  nestProcess,
  nestPack,
  packKey,
  packs,
  eligiblePacks,
  packLabel,
  isRefAllowed,
  setPackModeUnbound,
  createAndAttachPack,
  onPacksChange,
}: {
  graph: GameGraph
  node: GameNode
  d: GameNodeData
  patchData: (p: NodeDataPatch) => void
  onChange: (g: GameGraph) => void
  onJump?: (id: string) => void
  canConfigurePerformance: boolean
  selectedVideoValue: string
  videoOptions: VideoOption[]
  nestMode: 'none' | 'process' | 'pack'
  setNestMode: (mode: 'none' | 'process' | 'pack') => void
  nestProcess: SubProcess | undefined
  nestPack: SubFlowPack | undefined
  packKey: string
  packs: readonly SubFlowPackDef[]
  eligiblePacks: readonly SubFlowPackDef[]
  packLabel: (p: SubFlowPackDef) => string
  isRefAllowed?: (packId: string) => boolean
  setPackModeUnbound: (unbound: boolean) => void
  createAndAttachPack: () => void
  onPacksChange?: (packs: SubFlowPackDef[]) => void
}): JSX.Element {
  // ni-ui 的规则先于本文件注入（NodeInspector 渲染自身时就调了 ensureNiUiStyle），
  // 这里再补一份分区私有样式，同权重时以本文件为准。
  injectStyleOnce('ni-performance', PERF_CSS)
  const hint = durationHint(videoOptions, selectedVideoValue)
  return (
    <>
      <div className="ni-perf-actions">
        {/* 图标换成了矢量的，但 aria-label 保留原来的 `▶ …` / `🗑 …`：多处测试与无障碍读屏
            都按这两个名字定位这两颗按钮。 */}
        <NiPillButton
          icon="play"
          label="从此试玩"
          ariaLabel="▶ 从此试玩"
          title="从此节点试玩；浮层重开回到该节点（不改图、不设为起点）"
          onClick={() => onJump?.(node.id)}
        />
        <NiPillButton
          icon="trash"
          label="删除节点"
          ariaLabel="🗑 删除节点"
          danger
          onClick={() => {
            if (confirm(`删除节点「${node.data.name}」及其相关连线？`)) onChange(removeNode(graph, node.id))
          }}
        />
      </div>

      <section className="ni-section ni-perf">
        {/* 整行是 label：点铅笔（装饰性图标）也会聚焦到名称输入框，不留死点击区。 */}
        <label className="ni-perf-title">
          <span className="ni-perf-title-field" data-value={d.name}>
            <input
              className="ni-perf-title-input"
              aria-label="节点名称"
              title={`节点 ${node.id}`}
              size={1}
              value={d.name}
              onChange={(e) => patchData({ name: e.target.value })}
            />
          </span>
          <NiIcon name="pencil" size={14} />
        </label>

        <div className="ni-perf-fields">
          {canConfigurePerformance && (
            <div className="ni-perf-video-field">
              <NiField label="演出视频" hint={hint}>
                <NiSelect
                  value={selectedVideoValue}
                  onChange={(value) => patchData({ media: value ? { kind: 'VIDEO', ref: value } : undefined })}
                  title="选择该演出节点播放的视频（与视频素材库一致，仅显示 Kino 接口资源）"
                >
                  {selectedVideoValue === '__unavailable__' ? (
                    <option value="__unavailable__" disabled>（当前视频不在素材库）</option>
                  ) : null}
                  <option value="">（无演出）</option>
                  {videoOptions.map((option) => (
                    <option key={option.id} value={option.id}>{authoringOptionLabel(option.label, option.id)}</option>
                  ))}
                </NiSelect>
                <NiSegmented
                  ariaLabel="播放模式"
                  value={d.mediaPlayMode ?? 'once'}
                  options={[
                    { value: 'once', label: '单次', title: '播放一次' },
                    { value: 'loop', label: '循环', title: '循环播放' },
                  ]}
                  onChange={(value) => patchData({ mediaPlayMode: value })}
                  style={{ width: 100 }}
                />
              </NiField>
            </div>
          )}

          <NiField label="嵌套">
            <NiSelect
              value={nestMode}
              onChange={(value) => setNestMode(value as 'none' | 'process' | 'pack')}
              title="无 / 私有内嵌子流程 / 外部子蓝图（互斥）"
            >
              <option value="none">无</option>
              <option value="process">内嵌子流程</option>
              <option value="pack">子蓝图</option>
            </NiSelect>
          </NiField>

          {nestMode === 'process' && (
            <NiField label="子流程入口">
              <span className="ni-perf-readonly" title="入口属于容器私有子图，不可跨层连接">
                {nestProcess?.entry ?? '（未绑定）'}
              </span>
            </NiField>
          )}

          {nestMode === 'pack' && (
            <>
              <NiField label="子蓝图包">
                <NiSelect
                  value={packKey}
                  onChange={(value) => {
                    if (!value) {
                      setPackModeUnbound(true)
                      patchData({ subFlowPack: undefined })
                      return
                    }
                    const pack = packs.find((p) => `${p.id}@${p.version}` === value || p.id === value)
                    if (!pack) return
                    if (isRefAllowed && pack.id !== nestPack?.id && !isRefAllowed(pack.id)) {
                      alert(`不能引用「${pack.title ?? pack.id}」：会造成蓝图引用环（自身或间接引用回本蓝图）。`)
                      return
                    }
                    setPackModeUnbound(false)
                    patchData({ subProcess: undefined, subFlowPack: { id: pack.id, version: pack.version } })
                  }}
                  title="引用蓝图库中的子蓝图；双击容器跳到该蓝图编辑"
                >
                  <option value="">无</option>
                  {eligiblePacks.map((p) => (
                    <option key={`${p.id}@${p.version}`} value={`${p.id}@${p.version}`}>{packLabel(p)}</option>
                  ))}
                </NiSelect>
              </NiField>
              <NiAddButton
                label="新建子蓝图"
                onClick={createAndAttachPack}
                disabled={!onPacksChange}
                title="新建空子蓝图并挂到本节点"
              />
            </>
          )}
        </div>
      </section>
    </>
  )
}
